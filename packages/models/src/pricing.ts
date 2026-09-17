import { parseModelSpec } from '@cafe/protocol'

/** USD per million tokens. Approximate list prices; override via MODEL_PRICES_JSON if needed. */
export interface Price {
  inputPerMTok: number
  outputPerMTok: number
}

const TABLE: Record<string, Price> = {
  // Anthropic
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-5': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-fable-5-1': { inputPerMTok: 15, outputPerMTok: 75 },
  // OpenAI
  'gpt-5-mini': { inputPerMTok: 0.25, outputPerMTok: 2 },
  'gpt-5-nano': { inputPerMTok: 0.05, outputPerMTok: 0.4 },
  'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gpt-5.6-luna': { inputPerMTok: 2, outputPerMTok: 12 },
  // Google
  'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-3.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gemini-3.5-pro': { inputPerMTok: 2, outputPerMTok: 12 },
  // TypeSafe (output tokens are free)
  'typesafe-ai/jev': { inputPerMTok: 0.042, outputPerMTok: 0 },
  'typesafe-ai/jev-latest': { inputPerMTok: 0.042, outputPerMTok: 0 },
}

function overrides(): Record<string, Price> {
  const raw = process.env.MODEL_PRICES_JSON
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, Price>
  } catch {
    return {}
  }
}

/** Longest-prefix match so dated ids (claude-haiku-4-5-20251001) resolve to their family. */
export function priceFor(spec: string): Price & { known: boolean } {
  const { provider, model } = parseModelSpec(spec)
  if (provider === 'mock') return { inputPerMTok: 0, outputPerMTok: 0, known: true }
  const table = { ...TABLE, ...overrides() }
  const bare = model.includes('/') && provider !== 'gateway' ? model : model
  const candidates = Object.keys(table)
    .filter((k) => bare.startsWith(k) || bare.endsWith(k) || bare.includes(k))
    .sort((a, b) => b.length - a.length)
  const hit = candidates[0]
  if (hit) return { ...(table[hit] as Price), known: true }
  // Open-weights on your own hardware: no per-token bill.
  if (provider === 'ollama') return { inputPerMTok: 0, outputPerMTok: 0, known: true }
  return { inputPerMTok: 0, outputPerMTok: 0, known: false }
}

export function costUsd(spec: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(spec)
  return (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000
}
