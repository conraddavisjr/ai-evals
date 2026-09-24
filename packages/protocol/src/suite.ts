import { z } from 'zod'
import { Budget, Chaos, RoleModels, RunConfig, RunStatus, Staffing } from './domain.js'

/**
 * A suite is one experiment: every variant loops the same golden dataset with its
 * own model assignment (and optionally engine, staffing, chaos, budget), so the
 * results compare model against model on identical inputs.
 */
export const SuiteVariant = z.object({
  name: z.string().trim().min(1).max(60),
  roles: RoleModels.partial().default({}),
  orchestrator: z.string().optional(),
  staffing: Staffing.partial().optional(),
  chaos: Chaos.partial().optional(),
  budget: Budget.partial().optional(),
})
export type SuiteVariant = z.infer<typeof SuiteVariant>

/** Everything a run needs except what the suite decides per variant. */
export const SuiteBase = RunConfig.omit({ scenarioIds: true, name: true })
export type SuiteBase = z.infer<typeof SuiteBase>

export const SuiteConfig = z.object({
  name: z.string().trim().min(1).max(80).default('suite'),
  datasetId: z.string(),
  /** Subset of the dataset's items to play, in this order; all items when omitted. */
  itemIds: z.array(z.string()).min(1).optional(),
  base: SuiteBase,
  variants: z.array(SuiteVariant).min(1).max(12),
  /** How many variant runs execute at once. 1 is sequential; RunManager handles any number. */
  concurrency: z.number().int().min(1).max(8).default(1),
  /** Play every variant this many times (noise estimate). */
  repeats: z.number().int().min(1).max(5).default(1),
})
export type SuiteConfig = z.infer<typeof SuiteConfig>
export type SuiteConfigInput = z.input<typeof SuiteConfig>

export const SuiteStatus = z.enum(['pending', 'running', 'finished', 'failed', 'cancelled'])
export type SuiteStatus = z.infer<typeof SuiteStatus>

export const SuiteRow = z.object({
  id: z.string(),
  name: z.string(),
  status: SuiteStatus,
  config: SuiteConfig,
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  error: z.string().nullable(),
})
export type SuiteRow = z.infer<typeof SuiteRow>

export const SuiteRunRef = z.object({
  variant: z.string(),
  repeat: z.number().int(),
  runId: z.string().nullable(),
  status: z.union([RunStatus, z.literal('queued')]),
  active: z.boolean(),
})
export type SuiteRunRef = z.infer<typeof SuiteRunRef>

export const SuiteDetail = SuiteRow.extend({
  runs: z.array(SuiteRunRef),
  progress: z.object({
    total: z.number().int(),
    done: z.number().int(),
    running: z.number().int(),
    queued: z.number().int(),
  }),
})
export type SuiteDetail = z.infer<typeof SuiteDetail>

/** Key for a (variant, repeat) column in result matrices. */
export const variantKey = (variant: string, repeat: number) =>
  repeat > 1 ? `${variant} #${repeat}` : variant

/** One variant run's roll-up beside the others, plus an item x variant matrix. */
export const SuiteMatrixCell = z.object({
  outcome: z.string().nullable(),
  taskSuccess: z.boolean(),
  costUsd: z.number(),
  durationMs: z.number().nullable(),
  errors: z.number().int(),
  judgeCorrect: z.number().nullable(),
  reviewVerdict: z.string().nullable(),
})
export type SuiteMatrixCell = z.infer<typeof SuiteMatrixCell>

export interface SuiteVariantResult<M> {
  key: string
  variant: string
  repeat: number
  runId: string | null
  status: string
  result: M | null
}

export interface SuiteMatrixRow {
  scenarioId: string
  title: string
  cells: Record<string, SuiteMatrixCell | null>
}
