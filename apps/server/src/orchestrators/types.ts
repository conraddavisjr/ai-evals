import type { OrchestratorDeps } from '../orchestrator.js'

/**
 * What every orchestration engine must provide. The engine owns the shift while
 * it runs (customers, staff turns, tickets) and reports through the EventBus; the
 * shared post-visit pipeline (review, judge, metrics) is in visit-pipeline.ts.
 */
export interface Orchestrator {
  readonly runId: string
  /** Resolves when the run has reached a terminal status; rejects on a run-level failure. */
  run(): Promise<void>
  cancel(): void
}

export type OrchestratorFactory = (deps: OrchestratorDeps) => Orchestrator

export interface OrchestratorInfo {
  id: string
  label: string
  description: string
}

export interface OrchestratorEntry extends OrchestratorInfo {
  create: OrchestratorFactory
}
