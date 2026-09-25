import type { ModelRegistry } from '@cafe/models'
import { type Check, deterministicChecks } from './assertions.js'
import type { JudgeExpectation, PackConfig } from './config.js'
import type { Target, TargetResult } from './http-target.js'
import { type JudgeAnswer, judgeCase, judgeChecks, judgeState } from './judge.js'
import type { LoadedCase } from './load.js'

export interface Attempt {
  caseId: string
  attempt: number
  /** Null when the budget ran out before this attempt started. */
  result: TargetResult | null
  checks: Check[]
  judge: { answers: Record<string, JudgeAnswer>; latencyMs: number; skipped?: string } | null
  passed: boolean
  skipped: string | null
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
  required: number
  actual: number
  attempts: number
  ok: boolean
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
  thresholds: { overall?: number | undefined; byTag: Record<string, number> }
  runId: string
  onAttempt?: ((a: Attempt, c: LoadedCase) => void) | undefined
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

  const runOne = async (c: LoadedCase, attempt: number): Promise<Attempt> => {
    if (o.maxUsd !== null && spent >= o.maxUsd)
      return {
        caseId: c.id,
        attempt,
        result: null,
        checks: [],
        judge: null,
        passed: false,
        skipped: `budget of $${o.maxUsd} spent`,
      }
    if (o.signal?.aborted)
      return {
        caseId: c.id,
        attempt,
        result: null,
        checks: [],
        judge: null,
        passed: false,
        skipped: 'cancelled',
      }
    const result = await o.target.invoke(c, { runId: o.runId, attempt, signal: o.signal })
    spent += result.usage?.usd ?? 0
    const checks = deterministicChecks(c, result)
    let judge: Attempt['judge'] = null
    const expected = { ...defaults, ...c.judge }
    if (o.judgeSpec && o.config.judge && Object.keys(expected).length) {
      if (checks.some((k) => !k.ok) || result.outcome === 'failed') {
        judge = { answers: {}, latencyMs: 0, skipped: 'deterministic checks already failed' }
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
          judge = { answers: j.answers, latencyMs: j.latencyMs }
          checks.push(...judgeChecks(expected, j.answers))
        } catch (err) {
          judge = { answers: {}, latencyMs: 0, skipped: `judge error: ${(err as Error).message}` }
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
    ok: gates.every((g) => g.ok) && skipped === 0,
  }
}
