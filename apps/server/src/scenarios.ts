import type { CafeStore } from '@cafe/db'
import { SCENARIO_BY_ID, SCENARIOS } from '@cafe/evals'
import {
  BUILTIN_DATASET_ID,
  type DatasetDetail,
  type DatasetSummary,
  parseScenarioId,
  type Scenario,
} from '@cafe/protocol'

/** The dataset that ships with the code, presented like any other but read-only. */
function builtinSummary(): DatasetSummary {
  return {
    id: BUILTIN_DATASET_ID,
    name: 'Stardust starter',
    description:
      'The scenarios that ship with the cafe: happy paths, edge cases and adversarial customers.',
    builtin: true,
    itemCount: SCENARIOS.length,
    updatedAt: 0,
  }
}

export async function listDatasets(store: CafeStore): Promise<DatasetSummary[]> {
  const rows = await store.datasets.list()
  return [
    builtinSummary(),
    ...rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      builtin: false,
      itemCount: r.itemCount,
      updatedAt: r.updatedAt,
    })),
  ]
}

export async function getDataset(store: CafeStore, id: string): Promise<DatasetDetail | null> {
  if (id === BUILTIN_DATASET_ID) return { ...builtinSummary(), items: SCENARIOS }
  const row = await store.datasets.get(id)
  if (!row) return null
  const items = await store.datasets.items(id)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    builtin: false,
    itemCount: items.length,
    updatedAt: row.updatedAt,
    items: items.map((i) => i.scenario),
  }
}

/**
 * Resolve scenario ids to scenarios, in the order given: built-ins by id, dataset
 * items by their namespaced id. Unknown ids are an error so a bad config fails
 * before a run row exists.
 */
export async function resolveScenarios(store: CafeStore, ids: string[]): Promise<Scenario[]> {
  const wanted = ids.filter((id) => parseScenarioId(id).kind === 'dataset')
  const fromDb = await store.datasets.itemsByIds(wanted)
  const missing: string[] = []
  const out: Scenario[] = []
  for (const id of ids) {
    const s = SCENARIO_BY_ID.get(id) ?? fromDb.get(id)
    if (s) out.push(s)
    else missing.push(id)
  }
  if (missing.length)
    throw new Error(
      `Unknown scenario id(s): ${missing.join(', ')}. Built-in ids or ds:<dataset>:<slug> from a saved dataset.`,
    )
  return out
}
