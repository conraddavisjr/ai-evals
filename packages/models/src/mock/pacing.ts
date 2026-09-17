import type { MockPacing } from '@cafe/protocol'

/** Deterministic pacing for mock models so playback can be exercised with realistic timing. */
export interface Pacer {
  llmStep(): number
  tool(): number
  config: MockPacing
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const INSTANT_PACING: MockPacing = {
  llmStepMs: [0, 0],
  toolMs: [0, 0],
  hangOrders: [],
  hangMs: 0,
}

export function createPacer(config: MockPacing, seed = 1): Pacer {
  const rng = mulberry32(seed)
  const pick = ([lo, hi]: [number, number]) => Math.round(lo + rng() * Math.max(0, hi - lo))
  return { llmStep: () => pick(config.llmStepMs), tool: () => pick(config.toolMs), config }
}

/** Abortable sleep so a hung mock step still stops when the run is cancelled or an agent is killed. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(t)
      reject(
        signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
      )
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
