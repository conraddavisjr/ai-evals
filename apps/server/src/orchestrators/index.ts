import { ShiftOrchestrator } from '../orchestrator.js'
import type { OrchestratorEntry, OrchestratorInfo } from './types.js'

export type {
  Orchestrator,
  OrchestratorEntry,
  OrchestratorFactory,
  OrchestratorInfo,
} from './types.js'
export { closeVisit, recordUsage, type VisitPipelineDeps } from './visit-pipeline.js'

/**
 * Every engine that can drive a shift, by the id a RunConfig names in
 * `orchestrator`. Adding an engine (Mastra, LangChain, ...) is one entry here and
 * one file that satisfies the Orchestrator contract; see docs/ORCHESTRATORS.md.
 */
export const ORCHESTRATORS: Record<string, OrchestratorEntry> = {
  'evals-cafe': {
    id: 'evals-cafe',
    label: 'Evals Cafe (built-in)',
    description:
      'Deterministic scheduler: customers arrive on a gap, cashiers take them FIFO, baristas pull tickets from the rail; staff turns run on the AI SDK tool loop.',
    create: (deps) => new ShiftOrchestrator(deps),
  },
}

export function listOrchestrators(): OrchestratorInfo[] {
  return Object.values(ORCHESTRATORS).map(({ id, label, description }) => ({
    id,
    label,
    description,
  }))
}

/** Ids stored before the rename to Evals Cafe. */
const LEGACY_IDS: Record<string, string> = { stardust: 'evals-cafe' }

export function orchestratorFor(id: string): OrchestratorEntry {
  const entry = ORCHESTRATORS[LEGACY_IDS[id] ?? id]
  if (!entry)
    throw new Error(
      `Unknown orchestrator "${id}". Available: ${Object.keys(ORCHESTRATORS).join(', ')}.`,
    )
  return entry
}
