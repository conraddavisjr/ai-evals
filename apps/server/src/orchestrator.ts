import { runAgent } from '@cafe/agents'
import type { CafeStore } from '@cafe/db'
import {
  judgeTransaction,
  type Outcome,
  reviewTransaction,
  runMetrics,
  scenariosFor,
  TRIAGE_QUESTIONS,
  transactionMetrics,
} from '@cafe/evals'
import { createChaos, Gateway } from '@cafe/mcp-gateway'
import { costUsd, ModelRegistry } from '@cafe/models'
import type { RunConfig, Scenario, TransactionMetrics } from '@cafe/protocol'
import { experimental_evaluate as evaluate } from 'ai'
import { ulid } from 'ulid'
import type { EventBus } from './event-bus.js'
import { type StaffMember, StaffPool } from './staff.js'

const MAX_ORDER_ATTEMPTS = 3

export interface OrchestratorDeps {
  store: CafeStore
  bus: EventBus
  config: RunConfig
  registry?: ModelRegistry
  now?: () => number
  /** Test hook: skip real waiting between arrivals. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve()
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })

/**
 * Runs one shift: customers arrive on a schedule, cashiers take them in FIFO order,
 * tickets land on the rail, baristas pull them FIFO, the judge scores each visit,
 * and metrics are rolled up at close. Deterministic glue; the models only live
 * inside runAgent and the triage/judge evaluate() calls.
 */
export class ShiftOrchestrator {
  readonly runId: string
  private readonly store: CafeStore
  private readonly bus: EventBus
  private readonly config: RunConfig
  private readonly registry: ModelRegistry
  private readonly now: () => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly abort = new AbortController()
  private readonly gateway: Gateway
  private readonly staff: StaffPool
  private readonly chaos
  private spentUsd = 0
  private claimedOrders = 0
  private readonly txMetrics: TransactionMetrics[] = []
  private baristaLoops: Promise<void>[] = []
  private customersDone = false

  constructor(deps: OrchestratorDeps) {
    this.store = deps.store
    this.bus = deps.bus
    this.runId = deps.bus.runId
    this.config = deps.config
    this.now = deps.now ?? (() => Date.now())
    this.sleep = deps.sleep ?? defaultSleep
    this.registry =
      deps.registry ??
      new ModelRegistry({
        mockPacing: deps.config.mockPacing,
        mockSeed: deps.config.chaos.seed,
        mockBeforeStep: async ({ persona, step }) => {
          // Make the Nth barista pickup hang right after it claims the ticket.
          if (
            persona.startsWith('barista') &&
            step === 2 &&
            this.config.mockPacing.hangOrders.includes(this.claimedOrders - 1)
          ) {
            await this.sleep(this.config.mockPacing.hangMs, this.abort.signal)
          }
        },
      })
    this.chaos = createChaos(deps.config.chaos)
    this.staff = new StaffPool(this.bus, deps.config.roles)
    this.gateway = new Gateway({
      store: this.store,
      emit: this.bus.emit,
      chaos: deps.config.chaos,
      now: this.now,
      services: { staffing: this.staff },
    })
    this.bus.subscribe((e) => {
      if (e.type === 'model.usage') this.spentUsd += e.costUsd
      if (e.type === 'order.claimed') this.claimedOrders += 1
    })
  }

  cancel(): void {
    this.abort.abort()
  }

  private overBudget = () => this.spentUsd >= this.config.budget.maxUsdPerRun

  async run(): Promise<void> {
    const scenarios = scenariosFor(this.config.scenarioIds)
    await this.store.runs.setStatus(this.runId, 'running', { startedAt: this.now() })
    await this.store.inventory.initForRun(this.runId)
    this.bus.emit({ type: 'run.started', config: this.config })
    this.staff.hire(this.config.staffing)
    this.staff.whenSpawned((m) => {
      if (m.spec.role === 'barista') this.baristaLoops.push(this.baristaLoop(m))
    })
    for (const b of this.staff.byRole('barista')) this.baristaLoops.push(this.baristaLoop(b))

    try {
      const visits: Promise<void>[] = []
      for (const [i, scenario] of scenarios.entries()) {
        if (this.abort.signal.aborted) break
        if (i > 0) await this.sleep(this.config.arrivalGapMs, this.abort.signal).catch(() => {})
        visits.push(this.customerVisit(scenario))
      }
      await Promise.allSettled(visits)
      this.customersDone = true
      await Promise.allSettled(this.baristaLoops)

      const events = this.bus.buffer
      const metrics = runMetrics(
        this.runId,
        events,
        this.txMetrics,
        new Map(scenarios.map((s) => [s.id, s])),
      )
      await this.store.metrics.save(this.runId, metrics, this.now())
      this.bus.emit({
        type: 'run.finished',
        summary: {
          transactions: metrics.transactions,
          succeeded: this.txMetrics.filter((t) => t.taskSuccess).length,
          failed: this.txMetrics.filter((t) => !t.taskSuccess).length,
          costUsd: metrics.costUsd,
        },
      })
      await this.store.runs.setStatus(
        this.runId,
        this.abort.signal.aborted ? 'cancelled' : 'finished',
        { finishedAt: this.now() },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.bus.emit({ type: 'run.failed', error: message })
      await this.store.runs.setStatus(this.runId, 'failed', {
        finishedAt: this.now(),
        error: message,
      })
      throw err
    } finally {
      this.customersDone = true
      await this.bus.flush()
    }
  }

  // ---------- customers ----------

  private async customerVisit(scenario: Scenario): Promise<void> {
    const txId = ulid()
    const customerId = `cust-${txId.slice(-6).toLowerCase()}`
    const utterance = scenario.customer.utterances[0] ?? ''
    const emit = this.bus.emit
    let outcome: Outcome = 'abandoned'

    emit({
      type: 'customer.arrived',
      txId,
      customerId,
      name: scenario.customer.name,
      scenarioId: scenario.id,
      sprite: scenario.customer.sprite,
      utterance,
    })
    emit({ type: 'customer.moved', txId, customerId, to: 'waiting' })

    if (this.config.triageEnabled)
      await this.triage(txId, customerId, utterance).catch((err) =>
        console.warn('[triage] skipped:', err instanceof Error ? err.message : err),
      )

    const cashier = await this.staff.acquire('cashier')
    let cashierResult: Awaited<ReturnType<typeof runAgent>> | null = null
    try {
      emit({ type: 'customer.moved', txId, customerId, to: cashier.station })
      emit({ type: 'customer.spoke', txId, customerId, text: utterance })
      cashierResult = await runAgent({
        agent: cashier.spec,
        task: utterance,
        context: {
          customerId,
          customerName: scenario.customer.name,
          ...(scenario.customer.loyaltyId ? { loyaltyId: scenario.customer.loyaltyId } : {}),
          txId,
        },
        runId: this.runId,
        txId,
        gateway: this.gateway,
        registry: this.registry,
        store: this.store,
        emit,
        budget: this.config.budget,
        chaos: this.chaos,
        overBudget: this.overBudget,
        now: this.now,
      })
    } finally {
      this.staff.release(cashier)
    }

    const refused = this.bus.buffer.some((e) => e.txId === txId && e.type === 'order.refused')
    let order = await this.store.orders.byTx(this.runId, txId)

    if (refused) {
      outcome = 'refused'
      if (order && (order.status === 'open' || order.status === 'paid')) {
        await this.store.orders.setStatus(order.id, 'refused', {
          failReason: 'refused at the register',
        })
      }
    } else if (
      order?.status === 'queued' ||
      order?.status === 'claimed' ||
      order?.status === 'ready' ||
      order?.status === 'delivered'
    ) {
      emit({ type: 'customer.moved', txId, customerId, to: 'waiting' })
      const done = await this.bus
        .waitFor(
          (e) => e.txId === txId && (e.type === 'order.delivered' || e.type === 'order.failed'),
          {
            includeBuffered: true,
            signal: this.abort.signal,
          },
        )
        .catch(() => null)
      if (done?.type === 'order.delivered') {
        emit({ type: 'customer.moved', txId, customerId, to: 'pickup' })
        outcome = 'served'
      } else outcome = 'failed'
    } else {
      // Cashier never got the ticket onto the rail: crash, timeout, budget, or gave up.
      if (order && order.status !== 'failed' && order.status !== 'refused') {
        const reason = cashierResult?.error ?? `cashier stopped with order ${order.status}`
        await this.store.orders.fail(order.id, reason)
        emit({ type: 'order.failed', txId, orderId: order.id, reason })
        outcome = 'failed'
      } else outcome = cashierResult?.outcome === 'completed' ? 'refused' : 'abandoned'
    }

    emit({ type: 'customer.moved', txId, customerId, to: 'door' })
    emit({ type: 'customer.left', txId, customerId, outcome })

    order = await this.store.orders.byTx(this.runId, txId)
    const review = await this.review(txId, customerId, scenario, order, outcome)
    await this.judge(txId, scenario, order, outcome, review)
  }

  private async triage(txId: string, customerId: string, utterance: string): Promise<void> {
    const modelSpec = this.config.roles.manager
    const model = this.registry.evaluationModel(modelSpec)
    const started = this.now()
    const res = await evaluate({
      model,
      state: `Customer at the door said: ${JSON.stringify(utterance)}`,
      questions: TRIAGE_QUESTIONS,
    })
    const latencyMs = this.now() - started
    this.bus.emit({
      type: 'triage.decided',
      txId,
      customerId,
      intent: res.answers.intent.choice,
      escalate: res.answers.escalate.probability >= 0.5,
      escalateProbability: res.answers.escalate.probability,
      modelSpec,
      latencyMs,
    })
    const inTok = res.usage.inputTokens ?? 0
    const outTok = res.usage.outputTokens ?? 0
    this.recordUsage({
      txId,
      agentId: 'manager-1',
      role: 'manager',
      modelSpec,
      step: 1,
      inputTokens: inTok,
      outputTokens: outTok,
      latencyMs,
    })
  }

  /** Emit a model.usage event and persist the matching row (triage, review and judge share this). */
  private recordUsage(u: {
    txId: string
    agentId: string
    role: 'manager' | 'judge'
    modelSpec: string
    step: number
    inputTokens: number
    outputTokens: number
    latencyMs: number
  }): void {
    const cost = costUsd(u.modelSpec, u.inputTokens, u.outputTokens)
    this.bus.emit({ type: 'model.usage', ...u, costUsd: cost })
    void this.store.usage
      .record({ runId: this.runId, ...u, costUsd: cost, now: this.now() })
      .catch((err) => console.warn('[usage] record failed:', err))
  }

  /**
   * The orchestration layer reasoning over its sub-agents: the manager reads the
   * visit's tool trail and transcript and files it as ok, concern or escalate.
   */
  private async review(
    txId: string,
    customerId: string,
    scenario: Scenario,
    order: Awaited<ReturnType<CafeStore['orders']['byTx']>>,
    outcome: Outcome,
  ): Promise<TransactionMetrics['review']> {
    if (!this.config.reviewEnabled || this.overBudget()) return null
    const modelSpec = this.config.roles.manager
    try {
      const res = await reviewTransaction({
        registry: this.registry,
        reviewerSpec: modelSpec,
        events: this.bus.buffer.filter((e) => e.txId === txId),
        scenario,
        order,
        outcome,
        now: this.now,
      })
      this.bus.emit({
        type: 'manager.reviewed',
        txId,
        customerId,
        orderId: order?.id ?? null,
        modelSpec,
        verdict: res.verdict,
        issues: res.issues,
        summary: res.summary,
        latencyMs: res.latencyMs,
      })
      this.recordUsage({
        txId,
        agentId: 'manager-1',
        role: 'manager',
        modelSpec,
        step: 2,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        latencyMs: res.latencyMs,
      })
      await this.store.reviews.record({
        runId: this.runId,
        txId,
        orderId: order?.id ?? null,
        reviewerSpec: modelSpec,
        verdict: res.verdict,
        issues: res.issues,
        summary: res.summary,
        brief: res.brief,
        latencyMs: res.latencyMs,
        now: this.now(),
      })
      return { verdict: res.verdict, issues: res.issues }
    } catch (err) {
      console.warn('[review] failed:', err instanceof Error ? err.message : err)
      return null
    }
  }

  private async judge(
    txId: string,
    scenario: Scenario,
    order: Awaited<ReturnType<CafeStore['orders']['byTx']>>,
    outcome: Outcome,
    review: TransactionMetrics['review'] = null,
  ): Promise<void> {
    const events = this.bus.buffer.filter((e) => e.txId === txId)
    let verdict: Awaited<ReturnType<typeof judgeTransaction>> | null = null
    if (this.config.judgeEnabled && !this.overBudget()) {
      try {
        verdict = await judgeTransaction({
          registry: this.registry,
          judgeSpec: this.config.roles.judge,
          events,
          scenario,
          order,
          outcome,
          now: this.now,
        })
        this.bus.emit({
          type: 'judge.verdict',
          txId,
          orderId: order?.id ?? null,
          judgeSpec: this.config.roles.judge,
          answers: verdict.answers,
          latencyMs: verdict.latencyMs,
        })
        this.recordUsage({
          txId,
          agentId: 'judge-1',
          role: 'judge',
          modelSpec: this.config.roles.judge,
          step: 1,
          inputTokens: verdict.inputTokens,
          outputTokens: verdict.outputTokens,
          latencyMs: verdict.latencyMs,
        })
        await this.store.judgements.record({
          runId: this.runId,
          txId,
          orderId: order?.id ?? null,
          judgeSpec: this.config.roles.judge,
          answers: verdict.answers,
          blindedTranscript: verdict.blindedTranscript,
          latencyMs: verdict.latencyMs,
          now: this.now(),
        })
      } catch (err) {
        console.warn('[judge] failed:', err instanceof Error ? err.message : err)
      }
    }
    this.txMetrics.push(
      transactionMetrics({
        txId,
        events: this.bus.buffer,
        scenario,
        order,
        outcome,
        judge: verdict?.answers ?? null,
        judgeLatencyMs: verdict?.latencyMs ?? null,
        review,
      }),
    )
  }

  // ---------- baristas ----------

  private async baristaLoop(barista: StaffMember): Promise<void> {
    const home = barista.spec.station
    while (!this.abort.signal.aborted) {
      const queue = await this.store.orders.queue(this.runId)
      if (queue.length === 0) {
        if (this.customersDone && (await this.inFlightOrders()) === 0) return
        // Wake on a new ticket (or a requeue), with a real-time fallback so a missed event cannot hang the loop.
        await Promise.race([
          this.bus
            .waitFor((e) => e.type === 'order.queued' || e.type === 'order.requeued', {
              signal: this.abort.signal,
            })
            .catch(() => {}),
          new Promise<void>((r) => setTimeout(r, 750)),
        ])
        continue
      }
      if (this.overBudget()) {
        for (const o of queue) {
          await this.store.orders.fail(o.id, 'run budget exhausted')
          this.bus.emit({
            type: 'order.failed',
            txId: o.txId,
            orderId: o.id,
            reason: 'run budget exhausted',
          })
        }
        continue
      }
      barista.busy = true
      this.staff.moveTo(barista, home)
      const result = await runAgent({
        agent: barista.spec,
        task: 'There is a ticket on the rail. Make it and call it out.',
        context: { station: home },
        runId: this.runId,
        gateway: this.gateway,
        registry: this.registry,
        store: this.store,
        emit: this.bus.emit,
        budget: this.config.budget,
        chaos: this.chaos,
        overBudget: this.overBudget,
        now: this.now,
      })
      // Whatever this barista claimed but did not deliver needs a decision.
      const mine = (await this.store.orders.listByRun(this.runId)).filter(
        (o) =>
          o.baristaId === barista.spec.agentId && (o.status === 'claimed' || o.status === 'ready'),
      )
      for (const o of mine) {
        if (o.status === 'ready') {
          this.staff.moveTo(barista, 'pickup', o.txId)
          const reason = 'drink was ready but never called out'
          await this.store.orders.fail(o.id, reason)
          this.bus.emit({ type: 'order.failed', txId: o.txId, orderId: o.id, reason })
        } else if (
          (result.outcome === 'crashed' || result.outcome === 'timeout') &&
          o.attempts < MAX_ORDER_ATTEMPTS
        ) {
          await this.store.orders.requeue(o.id, result.error ?? result.outcome)
          this.bus.emit({
            type: 'order.requeued',
            txId: o.txId,
            orderId: o.id,
            reason: result.error ?? result.outcome,
          })
        } else {
          const reason = result.error ?? result.text ?? 'barista could not complete the order'
          await this.store.orders.fail(o.id, reason)
          this.bus.emit({ type: 'order.failed', txId: o.txId, orderId: o.id, reason })
        }
      }
      // call_out already walked them to the counter; bring them back to the machine.
      if (result.toolCalls.some((t) => t.tool === 'orders.call_out' && t.ok))
        barista.station = 'pickup'
      this.staff.moveTo(barista, home)
      barista.busy = false
      this.bus.emit({ type: 'agent.idle', agentId: barista.spec.agentId, role: 'barista' })
    }
  }

  /** Orders a barista could still be asked to touch. Open/paid tickets belong to a cashier, who is done once customersDone. */
  private async inFlightOrders(): Promise<number> {
    const all = await this.store.orders.listByRun(this.runId)
    return all.filter(
      (o) => o.status === 'queued' || o.status === 'claimed' || o.status === 'ready',
    ).length
  }
}
