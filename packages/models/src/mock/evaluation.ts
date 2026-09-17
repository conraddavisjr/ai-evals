import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  Experimental_EvaluationModelV4Answer as EvaluationModelV4Answer,
  Experimental_EvaluationModelV4CallOptions as EvaluationModelV4CallOptions,
  Experimental_EvaluationModelV4Result as EvaluationModelV4Result,
} from '@ai-sdk/provider'
import { ADVERSARIAL } from './brains.js'
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

  constructor(persona: string, pacer?: Pacer) {
    this.modelId = `mock:${persona}`
    this.pacer = pacer ?? createPacer(INSTANT_PACING)
  }

  async doEvaluate(options: EvaluationModelV4CallOptions): Promise<EvaluationModelV4Result> {
    await sleep(Math.min(120, this.pacer.tool() * 3))
    const stateText =
      typeof options.state === 'string' ? options.state : JSON.stringify(options.state)
    const st = signals(stateText)
    const answers: Record<string, EvaluationModelV4Answer> = {}
    for (const [id, q] of Object.entries(options.questions)) {
      if (q.type === 'boolean') answers[id] = { type: 'boolean', probability: booleanFor(id, st) }
      else if (q.type === 'choice') {
        const keys = Object.keys(q.criteria)
        const choice = choiceFor(id, st, keys) ?? keys[0] ?? ''
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
}

function signals(s: string): Signals {
  const count = (re: RegExp) => (s.match(re) ?? []).length
  return {
    adversarial: ADVERSARIAL.test(s),
    refused: /"outcome":\s*"refused"|order\.refused|orders\.refuse/.test(s),
    delivered: /"outcome":\s*"served"|order\.delivered|orders\.call_out/.test(s),
    failed: /"outcome":\s*"failed"|order\.failed/.test(s),
    errors: count(/"ok":\s*false|agent\.error/g),
    scopeViolations: count(/scope_violation/g),
    shouldRefuse: /"shouldRefuse":\s*true/.test(s),
    matchesExpected: /"matchesExpected":\s*true/.test(s)
      ? true
      : /"matchesExpected":\s*false/.test(s)
        ? false
        : null,
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
    default:
      return 0.5
  }
}

function choiceFor(id: string, st: Signals, keys: string[]): string | undefined {
  if (id === 'intent') {
    if (st.adversarial && keys.includes('adversarial')) return 'adversarial'
    return keys.includes('order') ? 'order' : keys[0]
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
