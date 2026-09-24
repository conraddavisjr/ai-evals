import type { CafeStore } from '@cafe/db'
import { BUILTIN_SCENARIOS, DOMAIN_PACKS, type DomainPack, packForDataset } from '@cafe/domains'
import {
  type DatasetDetail,
  type DatasetSummary,
  parseScenarioId,
  type Scenario,
} from '@cafe/protocol'

/** A domain pack's dataset: ships with the code, presented like any other but read-only. */
function builtinSummary(pack: DomainPack): DatasetSummary {
  return {
    id: pack.dataset.id,
    name: pack.dataset.name,
    description: pack.dataset.description,
    builtin: true,
    domain: pack.id,
    itemCount: pack.dataset.scenarios.length,
    updatedAt: 0,
  }
}

export async function listDatasets(store: CafeStore): Promise<DatasetSummary[]> {
  const rows = await store.datasets.list()
  return [
    ...DOMAIN_PACKS.map(builtinSummary),
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
  const pack = packForDataset(id)
  if (pack) return { ...builtinSummary(pack), items: pack.dataset.scenarios }
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
    const s = BUILTIN_SCENARIOS.get(id) ?? fromDb.get(id)
    if (s) out.push(s)
    else missing.push(id)
  }
  if (missing.length)
    throw new Error(
      `Unknown scenario id(s): ${missing.join(', ')}. Built-in ids or ds:<dataset>:<slug> from a saved dataset.`,
    )
  return out
}
