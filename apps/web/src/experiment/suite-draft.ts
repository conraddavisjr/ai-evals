import type { DatasetSummary, SuiteConfigInput, SuiteVariant } from '@cafe/protocol'
import { BUILTIN_DATASET_ID } from '@cafe/protocol'
import { estimateRunUsd, ROLES, type RoleKey } from '../components/run-draft.js'
import type { ModelsInfo } from '../harness/index.js'

export type PacingPreset = 'realistic' | 'instant'

/**
 * The experiment being configured on the Experiment page: a base run config the
 * diagram's node panels edit, plus the variants that each loop the dataset with
 * their own overrides. Owned by App so it survives page switches.
 */
export interface SuiteDraft {
  name: string
  /** The business domain every variant plays (a built-in dataset brings its own). */
  domain: string
  datasetId: string
  /** null = every item in the dataset. */
  itemIds: string[] | null
  orchestrator: string
  roles: Record<RoleKey, string>
  staffing: { cashiers: number; baristas: number }
  chaos: { toolErrorRate: number; toolLatencyMs: number; agentCrashRate: number; seed: number }
  budget: { maxUsdPerRun: number; maxStepsPerAgent: number }
  arrivalGapMs: number
  judgeEnabled: boolean
  triageEnabled: boolean
  reviewEnabled: boolean
  pacing: PacingPreset
  variants: SuiteVariant[]
  concurrency: number
  repeats: number
}

export function initialSuiteDraft(models: ModelsInfo, datasets: DatasetSummary[]): SuiteDraft {
  const d = models.defaults
  return {
    name: 'experiment',
    domain: datasets[0]?.domain ?? 'cafe',
    datasetId: datasets[0]?.id ?? BUILTIN_DATASET_ID,
    itemIds: null,
    orchestrator: d.orchestrator,
    roles: { ...d.roles },
    staffing: { ...d.staffing },
    chaos: {
      toolErrorRate: d.chaos.toolErrorRate,
      toolLatencyMs: d.chaos.toolLatencyMs,
      agentCrashRate: d.chaos.agentCrashRate,
      seed: d.chaos.seed,
    },
    budget: { maxUsdPerRun: d.budget.maxUsdPerRun, maxStepsPerAgent: d.budget.maxStepsPerAgent },
    arrivalGapMs: 0,
    judgeEnabled: true,
    triageEnabled: false,
    reviewEnabled: true,
    pacing: 'instant',
    variants: [{ name: 'baseline', roles: {} }],
    concurrency: 1,
    repeats: 1,
  }
}

/**
 * Move the draft to another domain: roles still on a scripted mock take that
 * domain's mocks (a cafe barista mock cannot work a support queue); live models stay.
 */
export function withDomain(
  draft: SuiteDraft,
  domain: { id: string; defaultRoles: Record<RoleKey, string> },
): SuiteDraft {
  if (draft.domain === domain.id) return draft
  const swap = (spec: string, role: RoleKey) =>
    spec.startsWith('mock:') ? domain.defaultRoles[role] : spec
  const roles = { ...draft.roles }
  for (const role of Object.keys(roles) as RoleKey[]) roles[role] = swap(roles[role], role)
  const variants = draft.variants.map((v) => {
    const r = { ...(v.roles as Partial<Record<RoleKey, string>>) }
    for (const role of Object.keys(r) as RoleKey[]) {
      const spec = r[role]
      if (spec) r[role] = swap(spec, role)
    }
    return { ...v, roles: r }
  })
  return { ...draft, domain: domain.id, roles, variants }
}

/** A new variant starts as a copy of the base so only the differences need editing. */
export function addVariant(draft: SuiteDraft): SuiteDraft {
  const n = draft.variants.length + 1
  let name = `variant ${n}`
  for (let i = n; draft.variants.some((v) => v.name === name); i++) name = `variant ${i + 1}`
  return { ...draft, variants: [...draft.variants, { name, roles: {} }] }
}

/** The models a variant actually runs with: base roles under its overrides. */
export function effectiveRoles(draft: SuiteDraft, v: SuiteVariant): Record<RoleKey, string> {
  return { ...draft.roles, ...(v.roles as Partial<Record<RoleKey, string>>) }
}

export function toSuiteConfig(draft: SuiteDraft): SuiteConfigInput {
  const instant = { llmStepMs: [0, 0] as [number, number], toolMs: [0, 0] as [number, number] }
  const realistic = {
    llmStepMs: [800, 2500] as [number, number],
    toolMs: [3, 20] as [number, number],
  }
  return {
    name: draft.name,
    datasetId: draft.datasetId,
    ...(draft.itemIds ? { itemIds: draft.itemIds } : {}),
    base: {
      domain: draft.domain,
      orchestrator: draft.orchestrator,
      roles: draft.roles,
      staffing: draft.staffing,
      chaos: draft.chaos,
      budget: draft.budget,
      arrivalGapMs: draft.arrivalGapMs,
      judgeEnabled: draft.judgeEnabled,
      triageEnabled: draft.triageEnabled,
      reviewEnabled: draft.reviewEnabled,
      mockPacing: {
        ...(draft.pacing === 'instant' ? instant : realistic),
        hangOrders: [],
        hangMs: 0,
      },
    },
    variants: draft.variants,
    concurrency: draft.concurrency,
    repeats: draft.repeats,
  }
}

/** Sum of every variant run's estimate: variants x repeats x items. */
export function estimateSuiteUsd(draft: SuiteDraft, itemCount: number): number {
  let usd = 0
  for (const v of draft.variants) {
    usd +=
      estimateRunUsd(itemCount, effectiveRoles(draft, v), {
        judgeEnabled: draft.judgeEnabled,
        triageEnabled: draft.triageEnabled,
        reviewEnabled: draft.reviewEnabled,
      }) * draft.repeats
  }
  return usd
}

export function anyLiveModel(draft: SuiteDraft): boolean {
  return draft.variants.some((v) =>
    ROLES.some((r) => !effectiveRoles(draft, v)[r].startsWith('mock:')),
  )
}
