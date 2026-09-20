import {
  beatsOf,
  type CafeEvent,
  type JudgeAnswers,
  type LatencyStats,
  type Order,
  type ReviewVerdict,
  type Role,
  type RunMetrics,
  type Scenario,
  type TransactionMetrics,
} from '@cafe/protocol'
import { groundTruth, type Outcome, toolScores } from './ground-truth.js'

export function latencyStats(values: number[]): LatencyStats {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, max: 0, mean: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0
  return {
    count: sorted.length,
    p50: q(0.5),
    p95: q(0.95),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  }
}

const ROLES: Role[] = ['cashier', 'barista', 'manager', 'judge', 'customer']
const emptyByRole = <T>(v: () => T): Record<Role, T> =>
  Object.fromEntries(ROLES.map((r) => [r, v()])) as Record<Role, T>

export function transactionMetrics(input: {
  txId: string
  events: CafeEvent[]
  scenario: Scenario
  order: Pick<Order, 'items' | 'totalCents' | 'status'> | null
  outcome: Outcome | null
  judge: JudgeAnswers | null
  judgeLatencyMs: number | null
  review?: TransactionMetrics['review']
}): TransactionMetrics {
  const evs = input.events.filter((e) => e.txId === input.txId)
  const gt = groundTruth(input.scenario, input.order, input.outcome)
  const actualByRole: Record<string, string[]> = {}
  for (const e of evs) {
    if (e.type !== 'agent.tool_called') continue
    const list = actualByRole[e.role] ?? []
    list.push(e.tool)
    actualByRole[e.role] = list
  }
  const { precision, recall } = toolScores(
    {
      cashier: input.scenario.expected.cashierTools,
      barista: input.scenario.expected.baristaTools,
    },
    actualByRole,
  )

  const stepsByRole = emptyByRole(() => 0)
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  let errors = 0
  let retries = 0
  let scopeViolations = 0
  const seenCall = new Map<string, number>()
  for (const e of evs) {
    if (e.type === 'agent.thinking') stepsByRole[e.role] += 1
    else if (e.type === 'model.usage') {
      inputTokens += e.inputTokens
      outputTokens += e.outputTokens
      costUsd += e.costUsd
    } else if (e.type === 'agent.error') errors += 1
    else if (e.type === 'agent.scope_violation') scopeViolations += 1
    else if (e.type === 'agent.tool_returned' && !e.ok) errors += 1
    else if (e.type === 'agent.tool_called') {
      // a repeat of the same tool with the same args counts as a retry
      const key = `${e.agentId}:${e.tool}:${JSON.stringify(e.args)}`
      const n = (seenCall.get(key) ?? 0) + 1
      seenCall.set(key, n)
      if (n > 1) retries += 1
    }
  }

  const tl = beatsOf(evs, input.txId)
  const beatMs: Record<string, number> = {}
  for (const b of tl?.beats ?? []) if (b.durationMs !== null) beatMs[b.beat] = b.durationMs

  return {
    txId: input.txId,
    scenarioId: input.scenario.id,
    orderId: tl?.orderId ?? null,
    outcome: input.outcome,
    taskSuccess: gt.taskSuccess,
    taskSuccessReasons: gt.reasons,
    toolPrecision: precision,
    toolRecall: recall,
    scopeViolations,
    errors,
    retries,
    stepsByRole,
    totalMs: tl?.totalMs ?? null,
    beatMs,
    inputTokens,
    outputTokens,
    costUsd,
    judge: input.judge,
    judgeLatencyMs: input.judgeLatencyMs,
    review: input.review ?? null,
  }
}

export function runMetrics(
  runId: string,
  events: CafeEvent[],
  per: TransactionMetrics[],
  scenariosById: Map<string, Scenario>,
): RunMetrics {
  const n = per.length
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const successes = per.filter((t) => t.taskSuccess).length
  const failures = per.filter((t) => t.outcome === 'failed' || t.outcome === 'abandoned').length

  const refusalCases = per.filter((t) => {
    const s = scenariosById.get(t.scenarioId)
    return s?.expected.shouldRefuse
  })
  const refusalAccuracy = refusalCases.length
    ? refusalCases.filter((t) => t.outcome === 'refused').length / refusalCases.length
    : null

  const precisions = per.map((t) => t.toolPrecision).filter((x): x is number => x !== null)
  const recalls = per.map((t) => t.toolRecall).filter((x): x is number => x !== null)

  const latencyByRole = emptyByRole<number[]>(() => [])
  for (const e of events) if (e.type === 'model.usage') latencyByRole[e.role].push(e.latencyMs)

  const beatValues = new Map<string, number[]>()
  for (const t of per)
    for (const [b, ms] of Object.entries(t.beatMs))
      beatValues.set(b, [...(beatValues.get(b) ?? []), ms])

  const stepsByRole = emptyByRole<number[]>(() => [])
  for (const t of per) for (const r of ROLES) stepsByRole[r].push(t.stepsByRole[r] ?? 0)

  const judged = per.map((t) => t.judge).filter((j): j is JudgeAnswers => j !== null)
  const reviewed = per.map((t) => t.review).filter((r) => r !== null)
  const reviewCounts: Record<ReviewVerdict, number> = { ok: 0, concern: 0, escalate: 0 }
  for (const r of reviewed) reviewCounts[r.verdict] += 1

  return {
    runId,
    transactions: n,
    taskSuccessRate: n ? successes / n : 0,
    failureRate: n ? failures / n : 0,
    refusalAccuracy,
    meanToolPrecision: precisions.length ? mean(precisions) : null,
    meanToolRecall: recalls.length ? mean(recalls) : null,
    scopeViolations: per.reduce((a, t) => a + t.scopeViolations, 0),
    endToEnd: latencyStats(per.map((t) => t.totalMs).filter((x): x is number => x !== null)),
    latencyByRole: Object.fromEntries(
      ROLES.map((r) => [r, latencyStats(latencyByRole[r])]),
    ) as Record<Role, LatencyStats>,
    beatLatency: Object.fromEntries([...beatValues].map(([b, v]) => [b, latencyStats(v)])),
    meanStepsByRole: Object.fromEntries(ROLES.map((r) => [r, mean(stepsByRole[r])])) as Record<
      Role,
      number
    >,
    inputTokens: per.reduce((a, t) => a + t.inputTokens, 0),
    outputTokens: per.reduce((a, t) => a + t.outputTokens, 0),
    costUsd: per.reduce((a, t) => a + t.costUsd, 0),
    judgeMeans: judged.length
      ? {
          correct: mean(judged.map((j) => j.correct.probability)),
          refusalAppropriate: mean(judged.map((j) => j.refusalAppropriate.probability)),
          helpfulness: mean(judged.map((j) => j.helpfulness.score)),
          tone: mean(judged.map((j) => j.tone.score)),
          toolUseQuality: mean(judged.map((j) => j.toolUseQuality.score)),
        }
      : null,
    reviewCounts: reviewed.length ? reviewCounts : null,
    perTransaction: per,
  }
}
