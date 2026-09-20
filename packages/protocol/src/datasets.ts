import { z } from 'zod'
import { Scenario } from './domain.js'

/**
 * Golden datasets: named collections of scenarios (input + expected output). The
 * built-in one ships with the code; the rest live in the database and are edited
 * from the UI. Item ids are namespaced so a run config can mix both.
 */
export const BUILTIN_DATASET_ID = 'builtin:stardust'

export const CUSTOMER_SPRITES = [
  'customer_a',
  'customer_b',
  'customer_c',
  'customer_d',
  'customer_e',
  'customer_f',
] as const

export const DatasetSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Ships with the code; read-only. */
  builtin: z.boolean(),
  itemCount: z.number().int(),
  updatedAt: z.number(),
})
export type DatasetSummary = z.infer<typeof DatasetSummary>

export const DatasetDetail = DatasetSummary.extend({ items: z.array(Scenario) })
export type DatasetDetail = z.infer<typeof DatasetDetail>

/** What the editor submits: a scenario without its id (the server assigns one from the slug or title). */
export const ScenarioInput = Scenario.omit({ id: true }).extend({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,48}$/, 'lowercase letters, digits and dashes')
    .optional(),
  customer: Scenario.shape.customer.extend({
    sprite: z.enum(CUSTOMER_SPRITES).default('customer_a'),
  }),
})
export type ScenarioInput = z.infer<typeof ScenarioInput>

export const DatasetInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  /** Copy the items of another dataset (the built-in one, typically) as a starting point. */
  cloneFrom: z.string().optional(),
  items: z.array(ScenarioInput).default([]),
})
export type DatasetInput = z.infer<typeof DatasetInput>

export const DatasetPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
})
export type DatasetPatch = z.infer<typeof DatasetPatch>

export function datasetItemId(datasetId: string, slug: string): string {
  return `ds:${datasetId}:${slug}`
}

export function parseScenarioId(
  id: string,
):
  | { kind: 'builtin'; id: string }
  | { kind: 'dataset'; datasetId: string; slug: string; id: string } {
  const m = /^ds:([^:]+):(.+)$/.exec(id)
  return m
    ? { kind: 'dataset', datasetId: m[1] ?? '', slug: m[2] ?? '', id }
    : { kind: 'builtin', id }
}

/** "ds:01J...:oat-latte" -> "oat-latte"; built-in ids pass through. */
export function shortScenarioId(id: string): string {
  const p = parseScenarioId(id)
  return p.kind === 'dataset' ? p.slug : p.id
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  )
}
