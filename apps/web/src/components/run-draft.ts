import type { RunConfigInput, Scenario } from '@cafe/protocol'
import type { ModelsInfo } from '../harness/index.js'

export const ROLES = ['cashier', 'barista', 'manager', 'judge'] as const
export type RoleKey = (typeof ROLES)[number]

export type PacingPreset = 'realistic' | 'instant' | 'hang'

/** The shift being configured. Owned by the app so the header, the stage and the Shift tab all start the same run. */
export interface RunDraft extends RunConfigInput {
  roles: Record<RoleKey, string>
  scenarioIds: string[]
  pacing: PacingPreset
}

export function initialDraft(models: ModelsInfo, scenarios: Scenario[]): RunDraft {
  const d = models.defaults
  return {
    name: 'shift',
    scenarioIds: scenarios.map((s) => s.id),
    roles: { ...d.roles },
    staffing: { ...d.staffing },
    chaos: { ...d.chaos },
    budget: { ...d.budget },
    arrivalGapMs: d.arrivalGapMs,
    judgeEnabled: true,
    triageEnabled: true,
    reviewEnabled: true,
    mockPacing: { ...d.mockPacing },
    pacing: 'realistic',
  }
}

const PACING: Record<PacingPreset, RunConfigInput['mockPacing']> = {
  instant: {
    llmStepMs: [0, 0],
    toolMs: [0, 0],
    hangOrders: [],
    hangMs: 0,
  },
  hang: {
    llmStepMs: [800, 2500],
    toolMs: [3, 20],
    hangOrders: [1],
    hangMs: 25_000,
  },
  realistic: {
    llmStepMs: [800, 2500],
    toolMs: [3, 20],
    hangOrders: [],
    hangMs: 0,
  },
}

/** What gets POSTed: the draft with the pacing preset resolved. */
export function toRunConfig(draft: RunDraft): RunConfigInput {
  const { pacing, ...config } = draft
  return { ...config, mockPacing: PACING[pacing] }
}

/** Select the whole group unless it is already fully selected, in which case clear it. */
export function toggleGroup(selected: string[], group: string[]): string[] {
  const all = group.every((id) => selected.includes(id))
  if (all) return selected.filter((id) => !group.includes(id))
  const set = new Set(selected)
  for (const id of group) set.add(id)
  return [...set]
}

/** Rough per-visit token profile for the pre-run estimate. */
export const TOKENS_PER_VISIT: Record<
  RoleKey,
  { steps: number; inPerStep: number; outPerStep: number }
> = {
  cashier: { steps: 6, inPerStep: 1100, outPerStep: 70 },
  barista: { steps: 7, inPerStep: 900, outPerStep: 60 },
  manager: { steps: 2, inPerStep: 400, outPerStep: 8 },
  judge: { steps: 1, inPerStep: 700, outPerStep: 40 },
}
/** Mirror of the server price table for the estimate (USD per MTok). */
export const PRICE: Array<[RegExp, number, number]> = [
  [/^mock:/, 0, 0],
  [/claude-haiku/, 1, 5],
  [/claude-sonnet/, 3, 15],
  [/claude-opus|claude-fable/, 15, 75],
  [/gpt-5-nano/, 0.05, 0.4],
  [/gpt-5-mini/, 0.25, 2],
  [/gpt-5/, 1.25, 10],
  [/flash-lite/, 0.1, 0.4],
  [/flash/, 0.3, 2.5],
  [/jev/, 0.042, 0],
  [/^ollama/, 0, 0],
]
export const priceOf = (spec: string): [number, number] =>
  (PRICE.find(([re]) => re.test(spec))?.slice(1) as [number, number] | undefined) ?? [3, 15]

/** Rough USD for `visits` customers with these role models; mirrors the server price table. */
export function estimateRunUsd(
  visits: number,
  roles: Record<RoleKey, string>,
  flags: { judgeEnabled: boolean; triageEnabled: boolean; reviewEnabled: boolean },
): number {
  let usd = 0
  for (const role of ROLES) {
    const [pin, pout] = priceOf(roles[role])
    const prof = TOKENS_PER_VISIT[role]
    if (role === 'judge' && !flags.judgeEnabled) continue
    let steps = prof.steps
    // the manager's two calls per visit: door triage (tiny) and the post-visit review (reads the trail)
    if (role === 'manager') {
      steps = (flags.triageEnabled ? 1 : 0) + (flags.reviewEnabled ? 1 : 0)
      if (steps === 0) continue
    }
    usd += (visits * steps * (prof.inPerStep * pin + prof.outPerStep * pout)) / 1_000_000
  }
  return usd
}
