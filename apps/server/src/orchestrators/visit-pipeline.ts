import type { CafeStore } from '@cafe/db'
import { judgeTransaction, type Outcome, reviewTransaction, transactionMetrics } from '@cafe/evals'
import { costUsd, type ModelRegistry } from '@cafe/models'
import type { RunConfig, Scenario, TransactionMetrics } from '@cafe/protocol'
import type { Span } from '@cafe/telemetry'
import type { EventBus } from '../event-bus.js'

export interface VisitPipelineDeps {
  store: CafeStore
  bus: EventBus
  config: RunConfig
  registry: ModelRegistry
  now: () => number
  /** True once the run has spent its USD budget; review and judge are skipped past it. */
  overBudget: () => boolean
}

export interface ClosedVisit {
  txId: string
  customerId: string
  scenario: Scenario
  order: Awaited<ReturnType<CafeStore['orders']['byTx']>>
  outcome: Outcome
  /** OpenTelemetry parent (the visit span). */
  parent?: Span | null | undefined
}

/**
 * Everything that happens after a customer leaves, shared by every orchestration
 * engine: the manager's review, the judge's verdict, usage bookkeeping and the
 * visit's metrics. An engine only has to run the staff and produce the visit's
 * events; calling closeVisit() gives it the same evaluation as the built-in one.
 */
export async function closeVisit(
  deps: VisitPipelineDeps,
  visit: ClosedVisit,
): Promise<TransactionMetrics> {
  const review = await review_(deps, visit)
  return judge_(deps, visit, review)
}

/** Emit a model.usage event and persist the matching row (triage, review and judge share this). */
export function recordUsage(
  deps: Pick<VisitPipelineDeps, 'store' | 'bus' | 'now'>,
  u: {
    txId: string
    agentId: string
    role: 'manager' | 'judge'
    modelSpec: string
    step: number
    inputTokens: number
    outputTokens: number
    latencyMs: number
  },
): void {
  const cost = costUsd(u.modelSpec, u.inputTokens, u.outputTokens)
  deps.bus.emit({ type: 'model.usage', ...u, costUsd: cost })
  void deps.store.usage
    .record({ runId: deps.bus.runId, ...u, costUsd: cost, now: deps.now() })
    .catch((err) => console.warn('[usage] record failed:', err))
}

/**
 * The orchestration layer reasoning over its sub-agents: the manager reads the
 * visit's tool trail and transcript and files it as ok, concern or escalate.
 */
async function review_(
  deps: VisitPipelineDeps,
  { txId, customerId, scenario, order, outcome, parent }: ClosedVisit,
): Promise<TransactionMetrics['review']> {
  if (!deps.config.reviewEnabled || deps.overBudget()) return null
  const modelSpec = deps.config.roles.manager
  try {
    const res = await reviewTransaction({
      registry: deps.registry,
      reviewerSpec: modelSpec,
      events: deps.bus.buffer.filter((e) => e.txId === txId),
      scenario,
      order,
      outcome,
      now: deps.now,
      parentContext: parent,
    })
    deps.bus.emit({
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
    recordUsage(deps, {
      txId,
      agentId: 'manager-1',
      role: 'manager',
      modelSpec,
      step: 2,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      latencyMs: res.latencyMs,
    })
    await deps.store.reviews.record({
      runId: deps.bus.runId,
      txId,
      orderId: order?.id ?? null,
      reviewerSpec: modelSpec,
      verdict: res.verdict,
      issues: res.issues,
      summary: res.summary,
      brief: res.brief,
      latencyMs: res.latencyMs,
      now: deps.now(),
    })
    return { verdict: res.verdict, issues: res.issues }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[review] failed:', message)
    deps.bus.emit({
      type: 'agent.error',
      txId,
      agentId: 'manager-1',
      role: 'manager',
      kind: 'model',
      message: `review: ${message}`,
      retryable: false,
    })
    return null
  }
}

async function judge_(
  deps: VisitPipelineDeps,
  { txId, scenario, order, outcome, parent }: ClosedVisit,
  review: TransactionMetrics['review'],
): Promise<TransactionMetrics> {
  const events = deps.bus.buffer.filter((e) => e.txId === txId)
  let verdict: Awaited<ReturnType<typeof judgeTransaction>> | null = null
  if (deps.config.judgeEnabled && !deps.overBudget()) {
    try {
      verdict = await judgeTransaction({
        registry: deps.registry,
        judgeSpec: deps.config.roles.judge,
        events,
        scenario,
        order,
        outcome,
        now: deps.now,
        parentContext: parent,
      })
      deps.bus.emit({
        type: 'judge.verdict',
        txId,
        orderId: order?.id ?? null,
        judgeSpec: deps.config.roles.judge,
        answers: verdict.answers,
        latencyMs: verdict.latencyMs,
      })
      recordUsage(deps, {
        txId,
        agentId: 'judge-1',
        role: 'judge',
        modelSpec: deps.config.roles.judge,
        step: 1,
        inputTokens: verdict.inputTokens,
        outputTokens: verdict.outputTokens,
        latencyMs: verdict.latencyMs,
      })
      await deps.store.judgements.record({
        runId: deps.bus.runId,
        txId,
        orderId: order?.id ?? null,
        judgeSpec: deps.config.roles.judge,
        answers: verdict.answers,
        blindedTranscript: verdict.blindedTranscript,
        latencyMs: verdict.latencyMs,
        now: deps.now(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[judge] failed:', message)
      deps.bus.emit({
        type: 'agent.error',
        txId,
        agentId: 'judge-1',
        role: 'judge',
        kind: 'model',
        message: `judge: ${message}`,
        retryable: false,
      })
    }
  }
  return transactionMetrics({
    txId,
    events: deps.bus.buffer,
    scenario,
    order,
    outcome,
    judge: verdict?.answers ?? null,
    judgeLatencyMs: verdict?.latencyMs ?? null,
    review,
  })
}
