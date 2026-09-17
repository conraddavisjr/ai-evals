import { z } from 'zod'

/**
 * A ModelSpec is the single string that names a model anywhere in the system.
 * It is deliberately provider-agnostic so any role can be pointed at any model
 * by editing one config value.
 *
 *   anthropic/claude-haiku-4-5-20251001
 *   openai/gpt-5-mini
 *   google/gemini-2.5-flash-lite
 *   gateway:typesafe-ai/jev          (Vercel AI Gateway; the only route to Jev today)
 *   gateway:anthropic/claude-opus-5
 *   ollama/llama3.3                  (any OpenAI-compatible server)
 *   mock:cashier-happy               (deterministic, zero cost)
 */
export const ModelProvider = z.enum(['anthropic', 'openai', 'google', 'gateway', 'ollama', 'mock'])
export type ModelProvider = z.infer<typeof ModelProvider>

export const ModelSpec = z
  .string()
  .regex(/^(anthropic|openai|google|ollama)\/[\w.:-]+$|^gateway:[\w-]+\/[\w.:-]+$|^mock:[\w-]+$/, {
    message: 'ModelSpec must look like provider/model, gateway:provider/model, or mock:persona',
  })
export type ModelSpec = z.infer<typeof ModelSpec>

export interface ParsedModelSpec {
  provider: ModelProvider
  /** For gateway specs this is "typesafe-ai/jev"; for others the bare model id. */
  model: string
  raw: ModelSpec
}

export function parseModelSpec(spec: string): ParsedModelSpec {
  const raw = ModelSpec.parse(spec)
  if (raw.startsWith('gateway:'))
    return { provider: 'gateway', model: raw.slice('gateway:'.length), raw }
  if (raw.startsWith('mock:')) return { provider: 'mock', model: raw.slice('mock:'.length), raw }
  const slash = raw.indexOf('/')
  return { provider: ModelProvider.parse(raw.slice(0, slash)), model: raw.slice(slash + 1), raw }
}

export const isMockSpec = (spec: string): boolean => spec.startsWith('mock:')
