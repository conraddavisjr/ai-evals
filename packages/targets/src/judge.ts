import type { JSONObject } from '@ai-sdk/provider'
import type { ModelRegistry } from '@cafe/models'
import { experimental_evaluate as evaluate } from 'ai'
import type { Check } from './assertions.js'
import type { EvalCase, JudgeExpectation, JudgeQuestion } from './config.js'
import type { TargetResult } from './http-target.js'

export type JudgeAnswer = { probability: number } | { score: number }

export interface JudgeRun {
  answers: Record<string, JudgeAnswer>
  latencyMs: number
  inputTokens: number
  outputTokens: number
}

/**
 * What the judge reads: the request and the app's answer, nothing about which
 * model produced it, plus the deterministic checks so it does not argue with
 * facts the harness already established.
 */
export function judgeState(
  c: EvalCase,
  r: TargetResult,
  checks: Check[],
  maxOutputChars: number,
): JSONObject {
  let output = JSON.stringify(r.output ?? null)
  if (output.length > maxOutputChars) output = `${output.slice(0, maxOutputChars)} …(cut)`
  const want = c.expect.outcome === undefined ? [] : [c.expect.outcome].flat()
  const state = {
    request: { title: c.title, tags: c.tags, input: c.input, rubric: c.rubric ?? null },
    expected: {
      outcome: want.length ? want : null,
      shouldRefuse: want.length === 1 && want[0] === 'refused',
    },
    response: { outcome: r.outcome, reason: r.reason, explanation: r.detail, output },
    matchesExpected: checks.every((k) => k.ok),
    deterministicChecks: checks.map((k) => ({ check: k.label, passed: k.ok, saw: k.detail })),
  }
  // evaluate() needs strictly JSON-compatible state: the round trip drops undefined.
  return JSON.parse(JSON.stringify(state)) as JSONObject
}

export async function judgeCase(input: {
  registry: ModelRegistry
  spec: string
  questions: JudgeQuestion[]
  state: JSONObject
}): Promise<JudgeRun> {
  const model = input.registry.evaluationModel(input.spec)
  const questions = Object.fromEntries(
    input.questions.map((q) =>
      q.type === 'boolean'
        ? [q.id, { type: 'boolean' as const, instructions: q.instructions }]
        : [q.id, { type: 'score' as const, instructions: q.instructions, criteria: q.criteria }],
    ),
  )
  const started = performance.now()
  const res = await evaluate({ model, state: input.state, questions })
  const answers: Record<string, JudgeAnswer> = {}
  for (const q of input.questions) {
    const a = (res.answers as Record<string, { probability?: number; score?: number }>)[q.id]
    if (!a) continue
    if (q.type === 'boolean') answers[q.id] = { probability: a.probability ?? 0.5 }
    // evaluate() scores levels from 0; reports read 1 to 5 like the rest of the harness.
    else answers[q.id] = { score: Math.max(1, Math.min(5, Math.round(a.score ?? 2) + 1)) }
  }
  return {
    answers,
    latencyMs: Math.round(performance.now() - started),
    inputTokens: res.usage.inputTokens ?? 0,
    outputTokens: res.usage.outputTokens ?? 0,
  }
}

const pct = (p: number) => `${Math.round(p * 100)}%`

/** Turn the judge's answers into checks against what the case expects. */
export function judgeChecks(
  expected: Record<string, JudgeExpectation>,
  answers: Record<string, JudgeAnswer>,
): Check[] {
  return Object.entries(expected).map(([id, want]) => {
    const got = answers[id]
    if (!got)
      return { kind: 'judge', label: `judge ${id}`, ok: false, detail: 'judge gave no answer' }
    if (typeof want === 'boolean') {
      const p = 'probability' in got ? got.probability : Number.NaN
      const ok = want ? p >= 0.5 : p < 0.5
      return {
        kind: 'judge',
        label: `judge ${id} is ${want ? 'yes' : 'no'}`,
        ok,
        detail: `yes ${pct(p)}`,
      }
    }
    const s = 'score' in got ? got.score : Number.NaN
    const ok =
      (want.min === undefined || s >= want.min) && (want.max === undefined || s <= want.max)
    const bound = [
      want.min !== undefined ? `>= ${want.min}` : '',
      want.max !== undefined ? `<= ${want.max}` : '',
    ]
      .filter(Boolean)
      .join(' and ')
    return { kind: 'judge', label: `judge ${id} ${bound}`, ok, detail: `scored ${s} of 5` }
  })
}
