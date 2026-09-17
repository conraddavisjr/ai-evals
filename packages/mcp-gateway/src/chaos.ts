import type { Chaos, Role } from '@cafe/protocol'

/** mulberry32: tiny seeded PRNG so chaos is replayable from a seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class TransientToolError extends Error {
  readonly code = 'transient' as const
}

const FLAVOURS = [
  'register froze for a moment',
  'inventory scanner timed out',
  'POS lost connection to the back office',
  'ticket printer jammed',
]

export function createChaos(chaos: Partial<Chaos> | undefined) {
  const cfg: Chaos = {
    toolErrorRate: chaos?.toolErrorRate ?? 0,
    toolLatencyMs: chaos?.toolLatencyMs ?? 0,
    agentCrashRate: chaos?.agentCrashRate ?? 0,
    crashRoles: chaos?.crashRoles ?? ['cashier', 'barista', 'manager'],
    seed: chaos?.seed ?? 42,
  }
  const rng = seededRandom(cfg.seed)
  return {
    config: cfg,
    rng,
    /** Throws a TransientToolError with probability toolErrorRate. */
    maybeFail(tool: string): void {
      if (cfg.toolErrorRate > 0 && rng() < cfg.toolErrorRate) {
        const flavour = FLAVOURS[Math.floor(rng() * FLAVOURS.length)] ?? FLAVOURS[0]
        throw new TransientToolError(`${tool} failed: ${flavour} (simulated)`)
      }
    },
    /** True with probability agentCrashRate for targeted roles; the agent runtime decides what a crash means. */
    shouldCrash(role: Role): boolean {
      if (cfg.agentCrashRate <= 0 || !cfg.crashRoles.includes(role)) return false
      return rng() < cfg.agentCrashRate
    },
    extraLatencyMs: () => cfg.toolLatencyMs,
  }
}
export type ChaosEngine = ReturnType<typeof createChaos>
