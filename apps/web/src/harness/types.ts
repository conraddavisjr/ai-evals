import type { CafeEvent, RunConfig, RunConfigInput, RunMetrics, Scenario } from '@cafe/protocol'

export interface RunRow {
  id: string
  status: 'pending' | 'running' | 'finished' | 'failed' | 'cancelled'
  config: RunConfig
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  createdAt: number
  /** The harness still owns this run: events are still arriving. */
  active: boolean
}

export interface ModelsInfo {
  allowLive: boolean
  presets: Record<string, string[]>
  personas: string[]
  providersConfigured: Record<string, boolean>
  defaults: RunConfig
}

export interface StreamHandlers {
  onEvent: (e: CafeEvent) => void
  onDone: (status: string) => void
  onError?: (err: unknown) => void
}

/**
 * Everything the cafe UI needs from whatever is producing the event stream.
 * The Stardust server implements it over REST + SSE (`createHttpHarness`); another
 * harness only has to emit `CafeEvent`s from `@cafe/protocol` and answer these calls.
 * The scene, the player and the panels never talk to the network directly.
 */
export interface HarnessClient {
  models(): Promise<ModelsInfo>
  scenarios(): Promise<Scenario[]>
  runs(): Promise<RunRow[]>
  run(id: string): Promise<RunRow>
  startRun(config: RunConfigInput): Promise<{ runId: string }>
  cancelRun(id: string): Promise<{ cancelled: boolean }>
  deleteRun(id: string): Promise<{ deleted: boolean }>
  /** Events so far; `afterSeq` resumes a partially loaded run. */
  events(id: string, afterSeq?: number): Promise<CafeEvent[]>
  metrics(id: string): Promise<RunMetrics>
  judgements(
    id: string,
  ): Promise<Array<{ txId: string; blindedTranscript: string; judgeSpec: string }>>
  /** Tail a live run. Returns a closer. */
  stream(id: string, handlers: StreamHandlers, afterSeq?: number): () => void
}
