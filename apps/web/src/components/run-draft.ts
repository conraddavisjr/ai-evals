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
