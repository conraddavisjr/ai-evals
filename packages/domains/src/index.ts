import { registerEvaluatorPersona, registerPersona } from '@cafe/models'
import { CAFE_PACK } from './cafe.js'
import { SUPPORT_ADVERSARIAL, SUPPORT_PACK, SUPPORT_PERSONAS } from './support/index.js'
import type { DomainPack } from './types.js'

export { CAFE_PACK } from './cafe.js'
export * from './support/data.js'
export { SUPPORT_PACK, SUPPORT_PERSONAS } from './support/index.js'
export type * from './types.js'

/** Every domain pack, in picker order. Add a pack here (and its vocabulary in protocol) to offer it. */
export const DOMAIN_PACKS: readonly DomainPack[] = [CAFE_PACK, SUPPORT_PACK]

// the packs' scripted agents become resolvable model specs (mock:support-rep, ...)
for (const [name, factory] of Object.entries(SUPPORT_PERSONAS)) registerPersona(name, factory)
registerEvaluatorPersona('support-lead', { adversarial: SUPPORT_ADVERSARIAL })

export function domainPack(id: string | null | undefined): DomainPack {
  const pack = DOMAIN_PACKS.find((d) => d.id === (id ?? 'cafe'))
  if (!pack)
    throw new Error(`Unknown domain "${id}". Known: ${DOMAIN_PACKS.map((d) => d.id).join(', ')}`)
  return pack
}

/** Every built-in golden case across packs, for resolving scenario ids in a run config. */
export const BUILTIN_SCENARIOS = new Map(
  DOMAIN_PACKS.flatMap((d) => d.dataset.scenarios.map((s) => [s.id, s] as const)),
)

/** The pack whose built-in dataset has this id. */
export const packForDataset = (datasetId: string) =>
  DOMAIN_PACKS.find((d) => d.dataset.id === datasetId)
