import type { ErrorLayer, RunMetrics, RunTelemetry, SpanSummary } from '@cafe/protocol'
import { latencyStats } from './metrics.js'

const MAX_SAMPLES = 300

function distribution(values: number[]) {
  const stats = latencyStats(values)
  const sorted = [...values].sort((a, b) => a - b)
  const p99 =
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.99 * sorted.length) - 1))] ?? 0
  const samples =
    values.length <= MAX_SAMPLES
      ? values
      : values.filter((_, i) => i % Math.ceil(values.length / MAX_SAMPLES) === 0)
  return { ...stats, p99, samples }
}

const layerOf = (kind: string): ErrorLayer =>
  kind === 'tool'
    ? 'tool'
    : kind === 'triage'
      ? 'triage'
      : kind === 'review'
        ? 'review'
        : kind === 'judge'
          ? 'judge'
          : kind === 'run'
            ? 'run'
            : 'agent'

/** Model calls that carry cost. */
const COSTED = new Set(['step', 'triage', 'gate', 'review', 'judge'])

/**
 * Fold a run's spans into what the telemetry charts need. Pure: spans in, aggregate
 * out, so it runs the same on a live run (partial spans) and a finished one.
 * `metrics` adds pass/fail and judge/review verdicts per visit when the run is over.
 */
export function runTelemetry(
  runId: string,
  spans: SpanSummary[],
  metrics: RunMetrics | null,
  meta: { suiteId?: string | null; variant?: string | null } = {},
): RunTelemetry {
  const byTx = new Map<string, SpanSummary[]>()
  for (const s of spans) {
    if (!s.txId) continue
    const list = byTx.get(s.txId) ?? []
    list.push(s)
    byTx.set(s.txId, list)
  }
  const visits = spans.filter((s) => s.kind === 'visit').sort((a, b) => a.startT - b.startT)
  const scenarioOf = new Map(
    visits.map((v) => [v.txId ?? '', String(v.attributes['cafe.scenario_id'] ?? '')]),
  )
  const perTx = new Map(metrics?.perTransaction.map((t) => [t.txId, t]) ?? [])

  // tools
  const toolLat = new Map<string, number[]>()
  const toolErr = new Map<string, Map<string, number>>()
  for (const s of spans) {
    if (s.kind !== 'tool' || !s.tool) continue
    const l = toolLat.get(s.tool) ?? []
    l.push(s.durationMs)
    toolLat.set(s.tool, l)
    if (s.status === 'error') {
      const codes = toolErr.get(s.tool) ?? new Map<string, number>()
      const code = String(s.attributes['cafe.tool_code'] ?? s.errorKind ?? 'error')
      codes.set(code, (codes.get(code) ?? 0) + 1)
      toolErr.set(s.tool, codes)
    }
  }
  const tools = [...toolLat.entries()]
    .map(([tool, values]) => {
      const codes = toolErr.get(tool) ?? new Map<string, number>()
      return {
        tool,
        ...distribution(values),
        errors: [...codes.values()].reduce((a, b) => a + b, 0),
        byCode: Object.fromEntries(codes),
      }
    })
    .sort((a, b) => b.count - a.count)

  // reasoning steps by (role, step index)
  const stepLat = new Map<string, number[]>()
  for (const s of spans) {
    if (s.kind !== 'step' || !s.role) continue
    const idx = Number(s.attributes['cafe.step'] ?? 0)
    const key = `${s.role}|${idx}`
    const l = stepLat.get(key) ?? []
    l.push(Number(s.attributes['cafe.latency_ms'] ?? s.durationMs))
    stepLat.set(key, l)
  }
  const steps = [...stepLat.entries()]
    .map(([key, values]) => {
      const [role = '', idx = '0'] = key.split('|')
      return { role, stepIndex: Number(idx), ...distribution(values) }
    })
    .sort((a, b) => a.role.localeCompare(b.role) || a.stepIndex - b.stepIndex)

  // cost: every leaf model call that carries cost_usd
  const costByRole: Record<string, number> = {}
  const costByTxRole = new Map<string, Record<string, number>>()
  for (const s of spans) {
    if (!COSTED.has(s.kind) || s.costUsd === null) continue
    const role = s.role ?? (s.kind === 'judge' ? 'judge' : 'manager')
    costByRole[role] = (costByRole[role] ?? 0) + s.costUsd
    if (s.txId) {
      const r = costByTxRole.get(s.txId) ?? {}
      r[role] = (r[role] ?? 0) + s.costUsd
      costByTxRole.set(s.txId, r)
    }
  }
  let cumulative = 0
  const costTrajectory = visits.map((v, i) => {
    const txId = v.txId ?? ''
    const byRole = costByTxRole.get(txId) ?? {}
    const visitUsd = Object.values(byRole).reduce((a, b) => a + b, 0)
    cumulative += visitUsd
    return {
      visitIndex: Number(v.attributes['cafe.visit_index'] ?? i),
      txId,
      scenarioId: scenarioOf.get(txId) ?? '',
      byRole,
      visitUsd,
      cumulativeUsd: cumulative,
    }
  })

  // errors: any span that ended in error, attributed to its layer
  const byLayer: Record<ErrorLayer, number> = {
    triage: 0,
    agent: 0,
    tool: 0,
    review: 0,
    judge: 0,
    run: 0,
  }
  const byKind: Record<string, number> = {}
  const list: RunTelemetry['errors']['list'] = []
  for (const s of spans) {
    if (s.status !== 'error') continue
    // a failed step under a failed turn is the same incident: count turns, tools and evaluate() calls
    if (s.kind === 'step') continue
    const layer = layerOf(s.kind)
    byLayer[layer] += 1
    const kind = s.errorKind ?? String(s.attributes['cafe.tool_code'] ?? 'error')
    byKind[kind] = (byKind[kind] ?? 0) + 1
    const message = s.attributes['exception.message']
    list.push({
      txId: s.txId,
      scenarioId: s.txId ? (scenarioOf.get(s.txId) ?? null) : null,
      layer,
      tool: s.tool,
      step: s.kind === 'tool' ? null : Number(s.attributes['cafe.step']) || null,
      role: s.role,
      kind,
      message: typeof message === 'string' ? message : null,
      t: s.startT,
    })
  }
  list.sort((a, b) => a.t - b.t)

  const items = visits.map((v, i) => {
    const txId = v.txId ?? ''
    const mine = byTx.get(txId) ?? []
    const tm = perTx.get(txId)
    const toolSpans = mine.filter((s) => s.kind === 'tool')
    const outcome = v.attributes['cafe.outcome']
    const success = v.attributes['cafe.task_success']
    return {
      visitIndex: Number(v.attributes['cafe.visit_index'] ?? i),
      txId,
      scenarioId: scenarioOf.get(txId) ?? '',
      outcome: typeof outcome === 'string' ? outcome : (tm?.outcome ?? null),
      taskSuccess: tm?.taskSuccess ?? (typeof success === 'boolean' ? success : null),
      durationMs: v.durationMs,
      costUsd: costTrajectory[i]?.visitUsd ?? 0,
      toolCalls: toolSpans.length,
      toolErrors: toolSpans.filter((s) => s.status === 'error').length,
      agentErrors: mine.filter((s) => s.kind === 'agent.turn' && s.status === 'error').length,
      judgeCorrect: tm?.judge?.correct.probability ?? null,
      reviewVerdict: tm?.review?.verdict ?? null,
    }
  })

  return {
    runId,
    suiteId: meta.suiteId ?? null,
    variant: meta.variant ?? null,
    tools,
    steps,
    costTrajectory,
    costByRole,
    errors: { total: list.length, byLayer, byKind, list },
    items,
    spanCount: spans.length,
  }
}
