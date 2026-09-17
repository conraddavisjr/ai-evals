import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  Experimental_EvaluationModelV4Answer as EvaluationModelV4Answer,
  Experimental_EvaluationModelV4CallOptions as EvaluationModelV4CallOptions,
  Experimental_EvaluationModelV4Result as EvaluationModelV4Result,
  LanguageModelV4,
} from '@ai-sdk/provider'
import { generateText, Output } from 'ai'
import { z } from 'zod'

/**
 * Turn any chat model into an EvaluationModelV4 by asking for structured JSON.
 * Anthropic/OpenAI/Google ship native adapters; this one covers everything else
 * (open weights via Ollama, gateway models without evaluation support) so any
 * model can sit in the judge's chair using the exact same questions as Jev.
 */
export function languageModelAsEvaluationModel(model: LanguageModelV4): EvaluationModelV4 {
  return {
    specificationVersion: 'v4',
    provider: `${model.provider}-eval-adapter`,
    modelId: model.modelId,
    supportedQuestionTypes: ['boolean', 'choice', 'score'],
    async doEvaluate(options: EvaluationModelV4CallOptions): Promise<EvaluationModelV4Result> {
      const shape: Record<string, z.ZodTypeAny> = {}
      const lines: string[] = []
      for (const [id, q] of Object.entries(options.questions)) {
        const instr =
          typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions)
        if (q.type === 'boolean') {
          shape[id] = z.number().min(0).max(1)
          lines.push(`- "${id}" (number 0..1, probability that this is TRUE): ${instr}`)
        } else if (q.type === 'choice') {
          const keys = Object.keys(q.criteria)
          shape[id] = z.enum(keys as [string, ...string[]])
          const desc = keys
            .map((k) => `${k}${q.criteria[k] ? ` = ${JSON.stringify(q.criteria[k])}` : ''}`)
            .join('; ')
          lines.push(
            `- "${id}" (one of ${keys.map((k) => `"${k}"`).join(', ')}): ${instr}. Options: ${desc}`,
          )
        } else {
          const n = q.criteria.length
          shape[id] = z
            .number()
            .int()
            .min(0)
            .max(n - 1)
          const levels = q.criteria.map((c, i) => `${i} = ${JSON.stringify(c)}`).join('; ')
          lines.push(`- "${id}" (integer 0..${n - 1}): ${instr}. Levels: ${levels}`)
        }
      }
      const schema = z.object(shape)
      const state =
        typeof options.state === 'string' ? options.state : JSON.stringify(options.state, null, 2)
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        system:
          'You are a careful, calibrated evaluator. Read the STATE and answer every question. Return only JSON matching the requested keys. For probabilities, be honest about uncertainty; do not default to extremes.',
        prompt: `STATE:\n${state}\n\nQUESTIONS:\n${lines.join('\n')}`,
        temperature: 0,
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      })
      const obj = result.output as Record<string, unknown>
      const answers: Record<string, EvaluationModelV4Answer> = {}
      for (const [id, q] of Object.entries(options.questions)) {
        const v = obj[id]
        if (q.type === 'boolean') answers[id] = { type: 'boolean', probability: clamp01(Number(v)) }
        else if (q.type === 'choice') answers[id] = { type: 'choice', choice: String(v) }
        else
          answers[id] = {
            type: 'score',
            score: Math.max(0, Math.min(q.criteria.length - 1, Number(v))),
          }
      }
      const inputTokens = result.usage.inputTokens
      const outputTokens = result.usage.outputTokens
      return {
        answers,
        usage: {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        },
        warnings: [],
        response: { timestamp: new Date(), modelId: model.modelId },
      }
    },
  }
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5)
