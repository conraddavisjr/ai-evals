import type { ModelRegistry } from '@cafe/models'
import { type Check, deterministicChecks, latencyOf } from './assertions.js'
import type { JudgeExpectation, LatencyGate, PackConfig } from './config.js'
import type { Target, TargetResult } from './http-target.js'
import { type JudgeAnswer, judgeCase, judgeChecks, judgeState } from './judge.js'
import type { LoadedCase } from './load.js'

export interface Attempt {
  caseId: string
  attempt: number
  /** Null when the budget ran out before this attempt started. */
  result: TargetResult | null
  checks: Check[]
  judge: {
    spec: string
    answers: Record<string, JudgeAnswer>
    latencyMs: number
    /** The wording asked, so a stored verdict keeps its meaning. */
    questions: Array<{ id: string; type: 'boolean' | 'score'; instructions: string }>
    skipped?: string
  } | null
  passed: boolean
  skipped: string | null
  /** When the request went out (epoch ms), so a recorded run keeps its timeline. */
  startedAt: number
  /** Position in the run, from 0, in the order attempts started. */
  index: number
}

export interface CaseSummary {
  id: string
  title: string
  dataset: string
  tags: string[]
  attempts: Attempt[]
  passes: number
  /** Passed at least once (pass@k). */
  passAny: boolean
  /** Passed every time. */
  passAll: boolean
  /** Passed some attempts and failed others. */
  flaky: boolean
}

export interface Gate {
  name: string
  /** A pass rate (0 to 1, at least `required`) or a time in ms (at most `required`). */
  unit?: 'rate' | 'ms'
  required: number
  actual: number
  attempts: number
  ok: boolean
  /** A miss is reported but does not fail the run. */
  warnOnly?: boolean
}

export interface Report {
  pack: string
  target: string
  runId: string
  startedAt: string
  finishedAt: string
  judge: string | null
  repeats: number
  cases: CaseSummary[]
  totals: {
    attempts: number
    passed: number
    skipped: number
    passRate: number
    /** Benign cases the app turned away (model refusals; gate reasons such as a cap excluded). */
    falseRefusals: number
    /** Cases that should have been refused and were served. */
    missedRefusals: number
    usd: number
    judgeInputTokens: number
    judgeOutputTokens: number
  }
  gates: Gate[]
  ok: boolean
}

export interface RunOptions {
  config: PackConfig
  cases: LoadedCase[]
  target: Target
  registry: ModelRegistry
  /** Null turns the judge off. */
  judgeSpec: string | null
  repeats: number
  concurrency: number
  maxUsd: number | null
  thresholds: {
    overall?: number | undefined
    byTag: Record<string, number>
    latency?: LatencyGate[] | undefined
  }
  runId: string
  onAttempt?: ((a: Attempt, c: LoadedCase) => void) | undefined
  /** Called as each attempt's request goes out, before its answer (a live dashboard shows the case arriving). */
  onStart?: ((c: LoadedCase, attempt: number, index: number, startedAt: number) => void) | undefined
  signal?: AbortSignal | undefined
}

const expects = (c: LoadedCase) => {
  const o = c.expect.outcome
  return o === undefined ? [] : Array.isArray(o) ? o : [o]
}

/**
 * Run every selected case against the target, `repeats` times, with bounded
 * concurrency. Deterministic checks decide first; the judge is only asked when
 * they pass, since a case that already failed cannot pass on the judge's word.
 */
export async function runPack(o: RunOptions): Promise<Report> {
  const startedAt = new Date().toISOString()
  const jobs = o.cases.flatMap((c) =>
    Array.from({ length: o.repeats }, (_, i) => ({ c, attempt: i + 1 })),
  )
  const attempts = new Map<string, Attempt[]>()
  let spent = 0
  let judgeIn = 0
  let judgeOut = 0
  let next = 0
  const defaults: Record<string, JudgeExpectation> = o.config.judge?.defaults ?? {}

  let started = 0
  const runOne = async (c: LoadedCase, attempt: number): Promise<Attempt> => {
    const index = started++
    const startedAt = Date.now()
    const skip = (why: string): Attempt => ({
      caseId: c.id,
      attempt,
      result: null,
      checks: [],
      judge: null,
      passed: false,
      skipped: why,
      startedAt,
      index,
    })
    if (o.maxUsd !== null && spent >= o.maxUsd) return skip(`budget of $${o.maxUsd} spent`)
    if (o.signal?.aborted) return skip('cancelled')
    o.onStart?.(c, attempt, index, startedAt)
    const result = await o.target.invoke(c, { runId: o.runId, attempt, signal: o.signal })
    spent += result.usage?.usd ?? 0
    const checks = deterministicChecks(c, result)
    let judge: Attempt['judge'] = null
    const expected = { ...defaults, ...c.judge }
    const asked = (o.config.judge?.questions ?? []).map((q) => ({
      id: q.id,
      type: q.type,
      instructions: q.instructions,
    }))
    const judged = (patch: Partial<NonNullable<Attempt['judge']>>): Attempt['judge'] => ({
      spec: o.judgeSpec ?? '',
      answers: {},
      latencyMs: 0,
      questions: asked,
      ...patch,
    })
    if (o.judgeSpec && o.config.judge && !c.skipJudge && Object.keys(expected).length) {
      if (checks.some((k) => !k.ok) || result.outcome === 'failed') {
        judge = judged({ skipped: 'deterministic checks already failed' })
      } else {
        try {
          const state = judgeState(c, result, checks, o.config.judge.maxOutputChars)
          const j = await judgeCase({
            registry: o.registry,
            spec: o.judgeSpec,
            questions: o.config.judge.questions,
            state,
          })
          judgeIn += j.inputTokens
          judgeOut += j.outputTokens
          judge = judged({ answers: j.answers, latencyMs: j.latencyMs })
          checks.push(...judgeChecks(expected, j.answers))
        } catch (err) {
          judge = judged({ skipped: `judge error: ${(err as Error).message}` })
          checks.push({
            kind: 'judge',
            label: 'judge answered',
            ok: false,
            detail: (err as Error).message,
          })
        }
      }
    }
    return {
      caseId: c.id,
      attempt,
      result,
      checks,
      judge,
      passed: checks.every((k) => k.ok),
      skipped: null,
      startedAt,
      index,
    }
  }

  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      if (!job) break
      const a = await runOne(job.c, job.attempt)
      const list = attempts.get(job.c.id) ?? []
      list.push(a)
      attempts.set(job.c.id, list)
      o.onAttempt?.(a, job.c)
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(o.concurrency, jobs.length)) }, worker),
  )

  const cases: CaseSummary[] = o.cases.map((c) => {
    const list = (attempts.get(c.id) ?? []).sort((a, b) => a.attempt - b.attempt)
    const passes = list.filter((a) => a.passed).length
    return {
      id: c.id,
      title: c.title,
      dataset: c.dataset,
      tags: c.tags,
      attempts: list,
      passes,
      passAny: passes > 0,
      passAll: list.length > 0 && passes === list.length,
      flaky: passes > 0 && passes < list.length,
    }
  })

  const all = cases.flatMap((c) => c.attempts)
  const byCase = new Map(o.cases.map((c) => [c.id, c]))
  const gateReasons = new Set(o.config.gateReasons)
  let falseRefusals = 0
  let missedRefusals = 0
  for (const a of all) {
    const c = byCase.get(a.caseId)
    if (!c || !a.result) continue
    const want = expects(c)
    if (
      want.length === 1 &&
      want[0] === 'served' &&
      a.result.outcome === 'refused' &&
      !gateReasons.has(a.result.reason ?? '')
    )
      falseRefusals++
    if (want.length === 1 && want[0] === 'refused' && a.result.outcome === 'served')
      missedRefusals++
  }

  const rate = (list: Attempt[]) =>
    list.length ? list.filter((a) => a.passed).length / list.length : 0
  const gates: Gate[] = []
  // With no thresholds anywhere, every case must pass: a silent green is worse than a strict one.
  const overall = o.thresholds.overall ?? (Object.keys(o.thresholds.byTag).length ? undefined : 1)
  if (overall !== undefined)
    gates.push({
      name: 'overall',
      required: overall,
      actual: rate(all),
      attempts: all.length,
      ok: rate(all) >= overall,
    })
  for (const [tag, required] of Object.entries(o.thresholds.byTag)) {
    const list = cases.filter((c) => c.tags.includes(tag)).flatMap((c) => c.attempts)
    // A tag with nothing selected (a smoke run without it) has nothing to gate.
    if (!list.length) continue
    gates.push({
      name: `tag ${tag}`,
      required,
      actual: rate(list),
      attempts: list.length,
      ok: rate(list) >= required,
    })
  }
  gates.push(...latencyGates(o.thresholds.latency ?? [], cases))
  const skipped = all.filter((a) => a.skipped).length

  return {
    pack: o.config.name,
    target: o.target.describe(),
    runId: o.runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    judge: o.judgeSpec,
    repeats: o.repeats,
    cases,
    totals: {
      attempts: all.length,
      passed: all.filter((a) => a.passed).length,
      skipped,
      passRate: rate(all),
      falseRefusals,
      missedRefusals,
      usd: Math.round(spent * 10_000) / 10_000,
      judgeInputTokens: judgeIn,
      judgeOutputTokens: judgeOut,
    },
    gates,
    // A run cut short by the budget never counts as green.
    ok: gates.every((g) => g.ok || g.warnOnly) && skipped === 0,
  }
}

/** Nearest-rank percentile of a list of ms (the list must not be empty). */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0
}

/** One gate per bound of each latency budget, over the attempts it selects. */
export function latencyGates(budgets: LatencyGate[], cases: CaseSummary[]): Gate[] {
  const gates: Gate[] = []
  for (const b of budgets) {
    const picked = cases
      .filter((c) => !b.tags?.length || c.tags.some((t) => b.tags?.includes(t)))
      .flatMap((c) => c.attempts)
      .filter((a) => a.result && (!b.outcome || a.result.outcome === b.outcome))
    const values = picked.flatMap((a) => {
      const ms = a.result ? latencyOf(a.result, b.step) : null
      return ms === null ? [] : [ms]
    })
    // Nothing selected (a subset without these cases) has nothing to gate.
    if (!values.length) continue
    const label =
      b.name ??
      [
        b.step ? `step ${b.step}` : 'latency',
        b.outcome ? b.outcome : '',
        b.tags?.length ? b.tags.join('/') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    const bounds: Array<[string, number | undefined, number]> = [
      ['p50', b.p50Ms, percentile(values, 0.5)],
      ['p95', b.p95Ms, percentile(values, 0.95)],
      ['max', b.maxMs, Math.max(...values)],
    ]
    for (const [stat, required, actual] of bounds) {
      if (required === undefined) continue
      gates.push({
        name: `${label} ${stat}`,
        unit: 'ms',
        required,
        actual,
        attempts: values.length,
        ok: actual <= required,
        warnOnly: b.warnOnly,
      })
    }
  }
  return gates
}
