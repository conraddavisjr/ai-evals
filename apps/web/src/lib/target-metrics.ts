import type { CafeEvent, CaseCheck, JudgeQuestionInfo } from '@cafe/protocol'
import { latencyStatsOf } from './stats.js'

type LatencyStats = ReturnType<typeof latencyStatsOf>

/**
 * A target run's metrics, from its events alone: what the app evaluated over
 * HTTP scored, per case, per tag and per judge question, and where its time and
 * money went. The server rolls simulated runs up at close; a target run's events
 * already hold everything, so this works for past runs and fills in live.
 */
export interface TargetCaseRow {
  txId: string
  scenarioId: string
  title: string
  tags: string[]
  outcome: string | null
  reason: string | null
  passed: boolean | null
  checks: { passed: number; total: number; failed: string[] }
  totalMs: number | null
  costUsd: number
  /** What the case accepts: one outcome, or several. */
  expected: string[]
}

export interface TargetMetrics {
  cases: number
  scored: number
  passed: number
  falseRefusals: number
  missedRefusals: number
  contractErrors: number
  endToEnd: LatencyStats
  costUsd: number
  inputTokens: number
  outputTokens: number
  byTag: Array<{ tag: string; cases: number; passed: number }>
  /** Most frequent failing checks first. */
  failingChecks: Array<{ label: string; count: number }>
  judge: Array<{
    id: string
    type: 'boolean' | 'score'
    instructions: string | null
    /** Mean P(yes), or mean score out of 5. */
    mean: number
    n: number
  }>
  rows: TargetCaseRow[]
}

export function targetMetrics(events: CafeEvent[]): TargetMetrics {
  const rows = new Map<string, TargetCaseRow>()
  const arrived = new Map<string, number>()
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  const answers = new Map<string, { sum: number; n: number; type: 'boolean' | 'score' }>()
  const wording = new Map<string, JudgeQuestionInfo>()
  for (const e of events) {
    const tx = e.txId
    if (e.type === 'customer.arrived' && tx) {
      arrived.set(tx, e.t)
      rows.set(tx, {
        txId: tx,
        scenarioId: e.scenarioId,
        title: e.title ?? e.scenarioId,
        tags: e.expected?.tags ?? [],
        outcome: null,
        reason: null,
        passed: null,
        checks: { passed: 0, total: 0, failed: [] },
        totalMs: null,
        costUsd: 0,
        expected: e.expected ? (e.expected.outcomes ?? [e.expected.outcome]) : [],
      })
      continue
    }
    const row = tx ? rows.get(tx) : undefined
    if (e.type === 'model.usage') {
      inputTokens += e.inputTokens
      outputTokens += e.outputTokens
      costUsd += e.costUsd
      if (row) row.costUsd += e.costUsd
    } else if (e.type === 'customer.left' && row && tx) {
      row.outcome = e.outcome
      const start = arrived.get(tx)
      row.totalMs = start === undefined ? null : e.t - start
    } else if (e.type === 'case.scored' && row) {
      row.passed = e.passed
      row.reason = e.reason
      row.checks = {
        passed: e.checks.filter((k: CaseCheck) => k.ok).length,
        total: e.checks.length,
        failed: e.checks.filter((k: CaseCheck) => !k.ok).map((k) => k.label),
      }
    } else if (e.type === 'judge.verdict') {
      for (const q of e.questions ?? []) wording.set(q.id, q)
      for (const [id, a] of Object.entries(e.answers)) {
        const type = 'probability' in a ? 'boolean' : 'score'
        const v = 'probability' in a ? a.probability : a.score
        const cur = answers.get(id) ?? { sum: 0, n: 0, type }
        cur.sum += v
        cur.n += 1
        answers.set(id, cur)
      }
    }
  }

  const list = [...rows.values()]
  const done = list.filter((r) => r.passed !== null)
  const tags = new Map<string, { cases: number; passed: number }>()
  for (const r of done)
    for (const t of r.tags) {
      const cur = tags.get(t) ?? { cases: 0, passed: 0 }
      cur.cases += 1
      if (r.passed) cur.passed += 1
      tags.set(t, cur)
    }
  const failing = new Map<string, number>()
  for (const r of done) for (const f of r.checks.failed) failing.set(f, (failing.get(f) ?? 0) + 1)
  const only = (r: TargetCaseRow, o: string) => r.expected.length === 1 && r.expected[0] === o

  return {
    cases: list.length,
    scored: done.length,
    passed: done.filter((r) => r.passed).length,
    // a capped request is the app's deterministic gate, not the model refusing
    falseRefusals: done.filter(
      (r) => only(r, 'served') && r.outcome === 'refused' && r.reason !== 'capped',
    ).length,
    missedRefusals: done.filter((r) => only(r, 'refused') && r.outcome === 'served').length,
    contractErrors: done.filter((r) => r.checks.failed.some((f) => f.includes('contract'))).length,
    endToEnd: latencyStatsOf(list.flatMap((r) => (r.totalMs === null ? [] : [r.totalMs]))),
    costUsd,
    inputTokens,
    outputTokens,
    byTag: [...tags.entries()]
      .map(([tag, v]) => ({ tag, ...v }))
      .sort((a, b) => a.passed / a.cases - b.passed / b.cases || b.cases - a.cases),
    failingChecks: [...failing.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    judge: [...answers.entries()].map(([id, v]) => ({
      id,
      type: v.type,
      instructions: wording.get(id)?.instructions ?? null,
      mean: v.sum / v.n,
      n: v.n,
    })),
    rows: list,
  }
}
