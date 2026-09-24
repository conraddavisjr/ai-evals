import { runAgent } from '@cafe/agents'
import type { CafeStore } from '@cafe/db'
import { BUILTIN_SCENARIOS, type DomainPack, domainPack } from '@cafe/domains'
import { type Outcome, runMetrics } from '@cafe/evals'
import {
  type ActionGuard,
  connectRemoteTools,
  createChaos,
  Gateway,
  type RemoteToolSource,
} from '@cafe/mcp-gateway'
import { ModelRegistry } from '@cafe/models'
import type { RunConfig, Scenario, TransactionMetrics } from '@cafe/protocol'
import {
  ATTR,
  type Context,
  markOk,
  recordError,
  type Span,
  startSpan,
  withSpan,
} from '@cafe/telemetry'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { experimental_evaluate as evaluate } from 'ai'
import { ulid } from 'ulid'
import type { EventBus } from './event-bus.js'
import { closeVisit, recordUsage } from './orchestrators/visit-pipeline.js'
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
  /** OpenTelemetry parent for the run span (a suite span, when the run is part of one). */
  parentContext?: Context | Span | null | undefined
  /** Resolved scenarios in config order (built-ins + dataset items); defaults to built-ins only. */
  scenarios?: Scenario[] | undefined
  /** When the run is one variant of a suite: tags the run span so spans can be grouped per variant. */
  suite?: { suiteId: string; variant: string } | undefined
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
 * Runs one shift: cases arrive on a schedule, agent 1 (intake) takes them in FIFO
 * order, work items land on the queue, agent 2 (fulfilment) pulls them FIFO, the
 * orchestrator reviews and the judge scores each case, and metrics are rolled up at
 * close. The run's domain pack supplies the tools, prompts, triage and judge
 * wording; this engine is the same for every business. Deterministic glue; the
 * models only live inside runAgent and the triage/review/judge evaluate() calls.
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
  private gateway: Gateway
  private remoteTools: RemoteToolSource | null = null
  private readonly staff: StaffPool
  private readonly chaos
  private spentUsd = 0
  private claimedOrders = 0
  private readonly txMetrics: TransactionMetrics[] = []
  private baristaLoops: Promise<void>[] = []
  private customersDone = false
  private readonly parentContext: Context | Span | null
  private runSpan: Span | null = null
  private visitIndex = 0
  private readonly scenarios: Scenario[]
  private readonly suite: { suiteId: string; variant: string } | null
  private readonly pack: DomainPack
  /** The case behind each txId, for the action gate's view of who is asking. */
  private readonly cases = new Map<string, { scenario: Scenario; utterance: string }>()

  constructor(deps: OrchestratorDeps) {
    this.parentContext = deps.parentContext ?? null
    this.pack = domainPack(deps.config.domain)
    this.scenarios =
      deps.scenarios ??
      deps.config.scenarioIds.map((id) => {
        const s = BUILTIN_SCENARIOS.get(id)
        if (!s) throw new Error(`Unknown scenario id: ${id}`)
        return s
      })
    this.suite = deps.suite ?? null
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
          // Make the Nth fulfilment pickup hang right after it claims the work item.
          if (
            this.config.roles.barista === `mock:${persona}` &&
            step === 2 &&
            this.config.mockPacing.hangOrders.includes(this.claimedOrders - 1)
          ) {
            await this.sleep(this.config.mockPacing.hangMs, this.abort.signal)
          }
        },
      })
    this.chaos = createChaos(deps.config.chaos)
    this.staff = new StaffPool(this.bus, deps.config.roles, this.pack.staff)
    this.gateway = new Gateway({
      store: this.store,
      emit: this.bus.emit,
      chaos: deps.config.chaos,
      now: this.now,
      services: { staffing: this.staff },
      tools: this.pack.tools,
      roleScopes: this.pack.roleScopes,
      guard: this.actionGuard(),
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

  /**
   * Swap the gateway's catalogue for a remote MCP server's before the shift
   * starts. Each remote tool's scope is `tool:<name>`; a role holds the scopes of
   * the tools the config lists for it.
   */
  private async attachToolSource(): Promise<void> {
    const src = this.config.tools
    if (src.kind !== 'mcp') return
    const transport = new StreamableHTTPClientTransport(new URL(src.url), {
      requestInit: { headers: src.headers },
    })
    this.remoteTools = await connectRemoteTools({
      // the SDK's transport classes declare optional fields without `undefined`; the cast bridges exactOptionalPropertyTypes
      transport: transport as unknown as Parameters<typeof connectRemoteTools>[0]['transport'],
      scopeOf: (name) => `tool:${name}`,
    })
    const roleScopes = Object.fromEntries(
      Object.entries(src.roleTools).map(([role, tools]) => [role, tools.map((t) => `tool:${t}`)]),
    )
    this.gateway = new Gateway({
      store: this.store,
      emit: this.bus.emit,
      chaos: this.config.chaos,
      now: this.now,
      services: { staffing: this.staff },
      tools: this.remoteTools.tools,
      roleScopes,
      guard: this.actionGuard(),
    })
  }

  async run(): Promise<void> {
    const scenarios = this.scenarios
    await this.attachToolSource()
    this.runSpan = startSpan(
      'run',
      `run ${this.config.name}`,
      {
        [ATTR.RUN_ID]: this.runId,
        ...(this.suite
          ? { [ATTR.SUITE_ID]: this.suite.suiteId, [ATTR.VARIANT]: this.suite.variant }
          : {}),
        'cafe.scenarios': scenarios.length,
        'cafe.domain': this.pack.id,
        'cafe.roles.cashier': this.config.roles.cashier,
        'cafe.roles.barista': this.config.roles.barista,
        'cafe.roles.manager': this.config.roles.manager,
        'cafe.roles.judge': this.config.roles.judge,
      },
      this.parentContext,
    )
    await this.store.runs.setStatus(this.runId, 'running', { startedAt: this.now() })
    await this.pack.initForRun?.(this.store, this.runId)
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
      this.runSpan.setAttributes({
        [ATTR.OUTCOME]: this.abort.signal.aborted ? 'cancelled' : 'finished',
        [ATTR.COST_USD]: metrics.costUsd,
        'cafe.task_success_rate': metrics.taskSuccessRate,
      })
      markOk(this.runSpan)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.bus.emit({ type: 'run.failed', error: message })
      await this.store.runs.setStatus(this.runId, 'failed', {
        finishedAt: this.now(),
        error: message,
      })
      recordError(this.runSpan, err, 'run')
      throw err
    } finally {
      this.customersDone = true
      this.runSpan.end()
      await this.remoteTools?.close().catch(() => {})
      await this.bus.flush()
    }
  }

  // ---------- customers ----------

  private customerVisit(scenario: Scenario): Promise<void> {
    const txId = ulid()
    const index = this.visitIndex++
    return withSpan(
      'visit',
      `visit ${scenario.id}`,
      {
        [ATTR.RUN_ID]: this.runId,
        [ATTR.TX_ID]: txId,
        [ATTR.SCENARIO_ID]: scenario.id,
        [ATTR.VISIT_INDEX]: index,
        'cafe.tags': scenario.tags.join(','),
      },
      (span) => this.visit(span, txId, scenario),
      this.runSpan,
    )
  }

  private async visit(visitSpan: Span, txId: string, scenario: Scenario): Promise<void> {
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
      title: scenario.title,
      sprite: scenario.customer.sprite,
      utterance,
      expected: {
        outcome:
          scenario.expected.expectedOutcome ??
          (scenario.expected.shouldRefuse ? 'refused' : 'served'),
        cashierTools: scenario.expected.cashierTools,
        baristaTools: scenario.expected.baristaTools,
        tags: scenario.tags,
        items: scenario.expected.items,
        ...(scenario.expected.totalCents !== undefined
          ? { totalCents: scenario.expected.totalCents }
          : {}),
        shouldRefuse: scenario.expected.shouldRefuse,
        ...(scenario.expected.rubric ? { rubric: scenario.expected.rubric } : {}),
      },
    })
    emit({ type: 'customer.moved', txId, customerId, to: 'waiting' })

    this.cases.set(txId, { scenario, utterance })
    const routed = this.config.triageEnabled
      ? await this.triage(txId, customerId, utterance).catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          console.warn('[triage] skipped:', message)
          emit({
            type: 'agent.error',
            txId,
            agentId: 'manager-1',
            role: 'manager',
            kind: 'model',
            message: `triage: ${message}`,
            retryable: false,
          })
          return false
        })
      : false

    // triage routing: the decision model turned the case away at the door; agent 1 never runs
    if (routed)
      emit({
        type: 'order.refused',
        txId,
        customerId,
        cashierId: 'manager-1',
        reason: 'Declined at triage: the request reads as an attempt to manipulate the agents',
      })
    const cashierResult = routed
      ? null
      : await this.intake(visitSpan, txId, customerId, scenario, utterance)

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
        const reason =
          cashierResult?.error ??
          `${this.pack.vocabulary.roles.cashier} stopped with the ${this.pack.vocabulary.workItem} ${order.status}`
        await this.store.orders.fail(order.id, reason)
        emit({ type: 'order.failed', txId, orderId: order.id, reason })
        outcome = 'failed'
      } else outcome = cashierResult?.outcome === 'completed' ? 'refused' : 'abandoned'
    }

    emit({ type: 'customer.moved', txId, customerId, to: 'door' })
    emit({ type: 'customer.left', txId, customerId, outcome })
    visitSpan.setAttribute(ATTR.OUTCOME, outcome)

    order = await this.store.orders.byTx(this.runId, txId)
    const mine = await closeVisit(this.pipeline, {
      txId,
      customerId,
      scenario,
      order,
      outcome,
      parent: visitSpan,
    })
    this.txMetrics.push(mine)
    visitSpan.setAttributes({
      [ATTR.COST_USD]: mine.costUsd,
      'cafe.task_success': mine.taskSuccess,
      'cafe.errors': mine.errors,
    })
  }

  /** Agent 1 takes the case: the domain's intake with its tools, ending in a queued work item or a decline. */
  private async intake(
    visitSpan: Span,
    txId: string,
    customerId: string,
    scenario: Scenario,
    utterance: string,
  ): Promise<Awaited<ReturnType<typeof runAgent>>> {
    const emit = this.bus.emit
    const cashier = await this.staff.acquire('cashier')
    try {
      emit({ type: 'customer.moved', txId, customerId, to: cashier.station })
      emit({ type: 'customer.spoke', txId, customerId, text: utterance })
      return await runAgent({
        agent: cashier.spec,
        task: utterance,
        context: { ...this.pack.intakeContext(scenario, customerId), txId },
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
        parentContext: visitSpan,
      })
    } finally {
      this.staff.release(cashier)
    }
  }

  /** The shared post-visit pipeline (review, judge, metrics), bound to this run. */
  private get pipeline() {
    return {
      store: this.store,
      bus: this.bus,
      config: this.config,
      registry: this.registry,
      now: this.now,
      overBudget: this.overBudget,
      questions: { judge: this.pack.judgeQuestions, review: this.pack.reviewQuestions },
    }
  }

  /**
   * The action gate: when the run turns it on and the domain names gated tools,
   * a decision model approves or blocks each such call before it executes. Fails
   * closed: a gate that cannot answer blocks, because the calls it guards move money.
   */
  private actionGuard(): ActionGuard | undefined {
    const gate = this.pack.gate
    if (!this.config.gate.enabled || !gate) return undefined
    const spec = this.config.gate.modelSpec ?? this.config.roles.manager
    const threshold = this.config.gate.threshold
    return async ({ cap, tool, args }) => {
      if (!gate.tools.includes(tool)) return null
      const c = cap.txId ? this.cases.get(cap.txId) : undefined
      const started = this.now()
      try {
        const raw = await gate.state({
          store: this.store,
          runId: this.runId,
          customerSaid: c?.utterance ?? '',
          requester: {
            name: c?.scenario.customer.name ?? 'unknown',
            accountId: c?.scenario.customer.loyaltyId,
          },
          tool,
          args,
        })
        const res = await withSpan('gate', `gate ${tool}`, { [ATTR.MODEL_SPEC]: spec }, () =>
          evaluate({
            model: this.registry.evaluationModel(spec),
            // evaluate() takes strictly JSON state: the round trip drops undefined fields
            state: JSON.parse(JSON.stringify(raw)) as Parameters<typeof evaluate>[0]['state'],
            questions: { approve: { type: 'boolean', instructions: gate.instructions } },
          }),
        )
        const p = res.answers.approve.probability
        const latencyMs = this.now() - started
        const allowed = p >= threshold
        this.bus.emit({
          type: 'guard.decided',
          txId: cap.txId,
          agentId: cap.agentId,
          tool,
          args,
          approveProbability: p,
          allowed,
          modelSpec: spec,
          latencyMs,
        })
        if (cap.txId)
          recordUsage(this.pipeline, {
            txId: cap.txId,
            agentId: 'manager-1',
            role: 'manager',
            modelSpec: spec,
            step: 1,
            inputTokens: res.usage.inputTokens ?? 0,
            outputTokens: res.usage.outputTokens ?? 0,
            latencyMs,
          })
        return {
          allow: allowed,
          reason: allowed
            ? 'approved'
            : `the reviewer put the chance this is appropriate at ${Math.round(p * 100)}%. Do not retry it; tell the customer what you can do instead.`,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.bus.emit({
          type: 'agent.error',
          txId: cap.txId,
          agentId: 'manager-1',
          role: 'manager',
          kind: 'model',
          message: `gate: ${message}`,
          retryable: false,
        })
        return { allow: false, reason: 'the approval check is unavailable right now' }
      }
    }
  }

  /** Door triage; true when routing is on and the case was turned away. */
  private async triage(txId: string, customerId: string, utterance: string): Promise<boolean> {
    const modelSpec = this.config.roles.manager
    const model = this.registry.evaluationModel(modelSpec)
    const started = this.now()
    const res = await withSpan(
      'triage',
      'triage',
      { [ATTR.MODEL_SPEC]: modelSpec },
      async (span) => {
        const r = await evaluate({
          model,
          state: this.pack.triage.state(utterance),
          questions: this.pack.triage.questions,
        })
        span.setAttributes({
          [ATTR.INPUT_TOKENS]: r.usage.inputTokens ?? 0,
          [ATTR.OUTPUT_TOKENS]: r.usage.outputTokens ?? 0,
          [ATTR.LATENCY_MS]: this.now() - started,
          'cafe.intent': r.answers.intent.choice,
        })
        return r
      },
    )
    const latencyMs = this.now() - started
    const routed = this.config.triageRoutes && res.answers.intent.choice === 'adversarial'
    this.bus.emit({
      type: 'triage.decided',
      txId,
      customerId,
      intent: res.answers.intent.choice,
      escalate: res.answers.escalate.probability >= 0.5,
      escalateProbability: res.answers.escalate.probability,
      modelSpec,
      latencyMs,
      ...(routed ? { routed } : {}),
    })
    const inTok = res.usage.inputTokens ?? 0
    const outTok = res.usage.outputTokens ?? 0
    recordUsage(this.pipeline, {
      txId,
      agentId: 'manager-1',
      role: 'manager',
      modelSpec,
      step: 1,
      inputTokens: inTok,
      outputTokens: outTok,
      latencyMs,
    })
    return routed
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
        task: this.pack.fulfilTask,
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
        parentContext: this.runSpan,
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
      if (result.toolCalls.some((t) => t.tool === this.pack.handoffTool && t.ok))
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
