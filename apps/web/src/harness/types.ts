import type {
  CafeEvent,
  DatasetDetail,
  DatasetInput,
  DatasetPatch,
  DatasetSummary,
  RunConfig,
  RunConfigInput,
  RunMetrics,
  RunTelemetry,
  Scenario,
  ScenarioInput,
  SpanSummary,
  SuiteConfigInput,
  SuiteDetail,
  SuiteMatrixRow,
  SuiteVariantResult,
} from '@cafe/protocol'

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

/**
 * The experiment side of the harness: telemetry today, datasets and suites next.
 * Kept apart from HarnessClient so a minimal harness (events only) still satisfies
 * the stage; anything here may reject with "not supported" and the UI copes.
 */
export interface ToolInfo {
  name: string
  scope: string
  description: string
}

export interface ExperimentClient {
  /** Aggregated OpenTelemetry view of a run (works while the run is live). */
  telemetry(runId: string): Promise<RunTelemetry>
  /** Raw spans for drill-down. */
  spans(
    runId: string,
    query?: { txId?: string; kinds?: string[]; limit?: number; offset?: number },
  ): Promise<SpanSummary[]>
  /** Golden datasets: the built-in one plus everything saved from the editor. */
  datasets(): Promise<DatasetSummary[]>
  dataset(id: string): Promise<DatasetDetail>
  createDataset(input: DatasetInput): Promise<DatasetDetail>
  updateDataset(id: string, patch: DatasetPatch): Promise<DatasetDetail>
  deleteDataset(id: string): Promise<{ deleted: boolean }>
  addItem(datasetId: string, item: ScenarioInput): Promise<Scenario>
  updateItem(datasetId: string, itemId: string, item: ScenarioInput): Promise<Scenario>
  deleteItem(datasetId: string, itemId: string): Promise<{ deleted: boolean }>
  reorderItems(datasetId: string, ids: string[]): Promise<DatasetDetail>
  /** The tool catalogue with scopes, for the expected-tools pickers. */
  tools(): Promise<{ tools: ToolInfo[]; roleScopes: Record<string, readonly string[]> }>
  /** Engines that can drive a shift. */
  orchestrators(): Promise<OrchestratorInfo[]>
  /** Suites: variants x repeats over one dataset. */
  suites(): Promise<SuiteDetail[]>
  suite(id: string): Promise<SuiteDetail>
  startSuite(config: SuiteConfigInput): Promise<{ suiteId: string }>
  cancelSuite(id: string): Promise<{ cancelled: boolean }>
  deleteSuite(id: string): Promise<{ deleted: boolean }>
  suiteMetrics(id: string): Promise<SuiteMetricsView>
  suiteTelemetry(id: string): Promise<SuiteTelemetryView>
}

export interface OrchestratorInfo {
  id: string
  label: string
  description: string
}

export interface SuiteMetricsView {
  suite: SuiteDetail
  variants: Array<SuiteVariantResult<RunMetrics>>
  matrix: SuiteMatrixRow[]
}

export interface SuiteTelemetryView {
  suiteId: string
  variants: Array<SuiteVariantResult<RunTelemetry>>
  errorMatrix: Array<{ scenarioId: string; cells: Record<string, number> }>
}
