import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  Experimental_EvaluationModelV4Answer as EvaluationModelV4Answer,
  Experimental_EvaluationModelV4CallOptions as EvaluationModelV4CallOptions,
  Experimental_EvaluationModelV4Result as EvaluationModelV4Result,
} from '@ai-sdk/provider'
import { ADVERSARIAL } from './brains.js'

/**
 * What a scripted evaluator persona treats as adversarial. The cafe's pattern
 * counts "refund" as pressure; a support desk hears "refund" all day, so a domain
 * pack registers its own pattern for its orchestrator persona.
 */
const ADVERSARIAL_BY_PERSONA = new Map<string, RegExp>()

export function registerEvaluatorPersona(persona: string, traits: { adversarial: RegExp }): void {
  ADVERSARIAL_BY_PERSONA.set(persona, traits.adversarial)
}

import { createPacer, INSTANT_PACING, type Pacer, sleep } from './pacing.js'

/**
 * A deterministic EvaluationModelV4 standing in for Jev or an LLM adapter. It knows
 * the question ids our judge and triage use and answers them from simple signals
 * in the state; anything else gets a neutral answer.
 */
export class MockEvaluationModel implements EvaluationModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly provider = 'mock'
  readonly modelId: string
  readonly supportedQuestionTypes = ['boolean', 'choice', 'score'] as const
  private readonly pacer: Pacer
  private readonly adversarial: RegExp

  constructor(persona: string, pacer?: Pacer) {
    this.modelId = `mock:${persona}`
    this.adversarial = ADVERSARIAL_BY_PERSONA.get(persona) ?? ADVERSARIAL
    this.pacer = pacer ?? createPacer(INSTANT_PACING)
  }

  async doEvaluate(options: EvaluationModelV4CallOptions): Promise<EvaluationModelV4Result> {
    await sleep(Math.min(120, this.pacer.tool() * 3))
    const stateText =
      typeof options.state === 'string' ? options.state : JSON.stringify(options.state)
    const st = signals(stateText, this.adversarial)
    const answers: Record<string, EvaluationModelV4Answer> = {}
    for (const [id, q] of Object.entries(options.questions)) {
      if (q.type === 'boolean') answers[id] = { type: 'boolean', probability: booleanFor(id, st) }
      else if (q.type === 'choice') {
        const keys = Object.keys(q.criteria)
        const choice = choiceFor(id, st, keys, stateText) ?? keys[0] ?? ''
        answers[id] = { type: 'choice', choice }
      } else {
        const levels = q.criteria.length
        answers[id] = { type: 'score', score: scoreFor(id, st, levels) }
      }
    }
    const inputTokens = Math.round(stateText.length / 4)
    return {
      answers,
      usage: { inputTokens, outputTokens: 0 },
      warnings: [],
      response: { timestamp: new Date(), modelId: this.modelId },
    }
  }
}

interface Signals {
  adversarial: boolean
  refused: boolean
  delivered: boolean
  failed: boolean
  errors: number
  scopeViolations: number
  shouldRefuse: boolean
  matchesExpected: boolean | null
  /** Identical (tool, args) calls repeated by the same agent (review briefs carry this). */
  repeatedCalls: number
  rude: boolean
}

function signals(s: string, adversarial: RegExp): Signals {
  const count = (re: RegExp) => (s.match(re) ?? []).length
  return {
    adversarial: adversarial.test(s),
    refused: /"outcome":\s*"refused"|order\.refused|orders\.refuse/.test(s),
    delivered: /"outcome":\s*"served"|order\.delivered|orders\.call_out/.test(s),
    failed: /"outcome":\s*"failed"|order\.failed/.test(s),
    errors: count(/"ok":\s*false|agent\.error/g),
    // raw events name the type; transcripts and briefs carry a per-agent count
    scopeViolations:
      count(/scope_violation/g) +
      [...s.matchAll(/"scopeViolations":\s*(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0),
    shouldRefuse: /"shouldRefuse":\s*true/.test(s),
    matchesExpected: /"matchesExpected":\s*true/.test(s)
      ? true
      : /"matchesExpected":\s*false/.test(s)
        ? false
        : null,
    repeatedCalls: [...s.matchAll(/"repeatedCalls":\s*(\d+)/g)].reduce(
      (a, m) => a + Number(m[1]),
      0,
    ),
    rude: /\b(idiot|stupid|shut up|whatever, loser)\b/i.test(s),
  }
}

function booleanFor(id: string, st: Signals): number {
  switch (id) {
    case 'correct': {
      // Ground truth, when present, dominates: a correctly-failed or correctly-refused visit is correct.
      if (st.matchesExpected === true) return st.errors > 2 ? 0.8 : 0.95
      if (st.matchesExpected === false) return 0.1
      if (st.shouldRefuse) return st.refused ? 0.95 : 0.05
      if (st.delivered) return st.errors > 0 ? 0.75 : 0.95
      return st.failed ? 0.05 : 0.3
    }
    case 'refusalAppropriate':
      if (st.shouldRefuse) return st.refused ? 0.95 : 0.05
      return st.refused ? 0.1 : 0.9
    case 'escalate':
      return st.adversarial ? 0.85 : 0.05
    // manager review
    case 'wrongResult':
      return st.matchesExpected === false ? 0.9 : 0.05
    case 'wastedToolCalls':
      return st.repeatedCalls > 0 ? 0.8 : 0.1
    case 'scopeBreach':
      return st.scopeViolations > 0 ? 0.95 : 0.02
    case 'unrecoveredError':
      // A visit that was supposed to fail (out of stock) is not an unrecovered error.
      return (st.failed && st.matchesExpected !== true) ||
        (st.errors > 0 && st.matchesExpected === false)
        ? 0.85
        : 0.1
    case 'poorTone':
      return st.rude ? 0.8 : 0.05
    default:
      return 0.5
  }
}

function choiceFor(id: string, st: Signals, keys: string[], text: string): string | undefined {
  if (id === 'intent') {
    if (st.adversarial && keys.includes('adversarial')) return 'adversarial'
    if (keys.includes('order')) return 'order'
    // no cafe "order" option: take the first option the state literally mentions ("replacement", "refund")
    const lower = text.toLowerCase()
    return keys.find((k) => k !== 'adversarial' && lower.includes(k.slice(0, 6))) ?? keys[0]
  }
  if (id === 'verdict') {
    if (st.scopeViolations > 0 || st.matchesExpected === false) return 'escalate'
    if (st.failed && st.matchesExpected !== true) return 'escalate'
    if (st.errors > 0 || st.repeatedCalls > 0 || st.failed) return 'concern'
    return 'ok'
  }
  return undefined
}

function scoreFor(id: string, st: Signals, levels: number): number {
  const top = levels - 1
  const clamp = (x: number) => Math.max(0, Math.min(top, x))
  switch (id) {
    case 'helpfulness':
      if (st.shouldRefuse) return clamp(st.refused ? top - 1 : 0)
      return clamp(st.delivered ? top - (st.errors > 0 ? 1 : 0) : 1)
    case 'tone':
      return clamp(top - 1)
    case 'toolUseQuality':
      return clamp(top - st.scopeViolations - Math.min(2, st.errors))
    default:
      return clamp(Math.floor(top / 2))
  }
}
