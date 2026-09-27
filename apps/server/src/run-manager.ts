import type { CafeStore } from '@cafe/db'
import { domainPack } from '@cafe/domains'
import {
  type CafeEvent,
  type CafeEventInput,
  isMockSpec,
  type RunConfig,
  type RunConfigInput,
  RunConfig as RunConfigSchema,
} from '@cafe/protocol'
import { ulid } from 'ulid'
import { EventBus } from './event-bus.js'
import type { OrchestratorDeps } from './orchestrator.js'
import { type Orchestrator, orchestratorFor } from './orchestrators/index.js'
import { resolveScenarios } from './scenarios.js'
import { flushTracing } from './telemetry/tracing.js'

interface ActiveRun {
  bus: EventBus
  orchestrator: Pick<Orchestrator, 'cancel'>
  done: Promise<void>
  /** Set for runs recorded elsewhere (a target run): finishing it resolves `done`. */
  finish?: () => void
}

/** An event as a recorder sends it: the payload plus when it happened. */
export type RecordedEvent = CafeEventInput & { t?: number }

/** Owns live runs; finished runs are served from the database. */
export class RunManager {
  private active = new Map<string, ActiveRun>()
  /** Identifies this process's runs, so a restart reaps only what its predecessor left behind. */
  readonly ownerId = ulid()

  constructor(
    private readonly store: CafeStore,
    private readonly allowLive: boolean,
  ) {}

  /**
   * Runs that were pending or running when a previous server process died can never
   * finish: nothing owns them any more. Mark them failed at boot so the UI does not keep
   * listing them as running. Runs with no owner (CLI, tests) belong to a process that is
   * still driving them, so they are left alone. Returns the ids that were reaped.
   */
  async reapOrphans(): Promise<string[]> {
    const rows = await this.store.runs.list(500)
    const orphans = rows.filter(
      (r) =>
        (r.status === 'running' || r.status === 'pending') &&
        r.owner !== null &&
        r.owner !== this.ownerId &&
        !this.active.has(r.id),
    )
    for (const r of orphans) {
      await this.store.runs.setStatus(r.id, 'failed', {
        finishedAt: Date.now(),
        error: 'interrupted: the server restarted while this shift was running',
      })
    }
    return orphans.map((r) => r.id)
  }

  validateConfig(input: RunConfigInput): RunConfig {
    const config = RunConfigSchema.parse(input)
    orchestratorFor(config.orchestrator)
    domainPack(config.domain)
    const live = Object.entries(config.roles).filter(([, spec]) => !isMockSpec(spec))
    if (live.length > 0 && !this.allowLive) {
      throw new Error(
        `Live models requested for ${live.map(([r]) => r).join(', ')} but CAFE_ALLOW_LIVE_MODELS is not "true". Use mock:* specs or enable live models in .env.`,
      )
    }
    return config
  }

  async start(
    input: RunConfigInput,
    opts: Pick<OrchestratorDeps, 'parentContext' | 'scenarios' | 'suite'> & {
      variant?: string
      repeat?: number
    } = {},
  ): Promise<{ runId: string }> {
    const config = this.validateConfig(input)
    // Resolve before the row exists so an unknown scenario id is a clean 400, not a failed run.
    const scenarios = opts.scenarios ?? (await resolveScenarios(this.store, config.scenarioIds))
    const run = await this.store.runs.create(config, {
      owner: this.ownerId,
      suiteId: opts.suite?.suiteId ?? null,
      variant: opts.variant ?? null,
      repeat: opts.repeat ?? null,
    })
    const bus = new EventBus(run.id, this.store)
    this.keepSummary(bus)
    const orchestrator = orchestratorFor(config.orchestrator).create({
      store: this.store,
      bus,
      config,
      scenarios,
      parentContext: opts.parentContext,
      suite: opts.suite,
    })
    const done = orchestrator
      .run()
      .catch((err) => console.error(`[run ${run.id}] failed:`, err))
      // whenDone() resolves only once the run's spans are queryable
      .then(() => flushTracing())
      .finally(() => {
        // keep the buffer around briefly so late SSE subscribers still get a clean hand-off
        setTimeout(() => this.active.delete(run.id), 10_000)
      })
    this.active.set(run.id, { bus, orchestrator, done })
    return { runId: run.id }
  }

  /** Copy run.finished's summary onto the row, so run lists show results without reading events. */
  private keepSummary(bus: EventBus): void {
    bus.subscribe((e) => {
      if (e.type === 'run.finished')
        void this.store.runs
          .setSummary(bus.runId, e.summary)
          .catch((err) => console.error('[runs] failed to store summary', err))
    })
  }

  /**
   * A run driven somewhere else (the target CLI, a CI job) that streams its
   * events here. It is live like any other run: SSE subscribers watch it as the
   * recorder sends events, until finishRecorded() closes it.
   */
  async startRecorded(input: RunConfigInput, startedAt?: number): Promise<{ runId: string }> {
    const config = RunConfigSchema.parse(input)
    if (!config.target) throw new Error('A recorded run needs config.target (project, source, url)')
    const at = startedAt ?? Date.now()
    const run = await this.store.runs.create(config, { owner: this.ownerId, createdAt: at })
    await this.store.runs.setStatus(run.id, 'running', { startedAt: at })
    const bus = new EventBus(run.id, this.store)
    this.keepSummary(bus)
    let finish = () => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    }).finally(() => setTimeout(() => this.active.delete(run.id), 10_000))
    // The recorder owns the work; cancelling here only stops listening.
    this.active.set(run.id, { bus, orchestrator: { cancel: () => finish() }, done, finish })
    return { runId: run.id }
  }

  /** Append events to a recorded run, in order, keeping the times they happened. */
  record(runId: string, events: RecordedEvent[]): number {
    const a = this.active.get(runId)
    if (!a?.finish) throw new Error(`Run ${runId} is not a recorded run that is still open`)
    for (const { t, ...input } of events) a.bus.emitAt(input as CafeEventInput, t ?? Date.now())
    return a.bus.buffer.length
  }

  async finishRecorded(
    runId: string,
    status: 'finished' | 'failed' | 'cancelled',
    error?: string,
  ): Promise<void> {
    const a = this.active.get(runId)
    if (!a?.finish) throw new Error(`Run ${runId} is not a recorded run that is still open`)
    await a.bus.flush()
    await this.store.runs.setStatus(runId, status, {
      finishedAt: Date.now(),
      ...(error ? { error } : {}),
    })
    a.finish()
  }

  cancel(runId: string): boolean {
    const a = this.active.get(runId)
    if (!a) return false
    a.orchestrator.cancel()
    return true
  }

  isActive(runId: string): boolean {
    return this.active.has(runId)
  }

  /** Events so far (buffer for live runs, DB otherwise). */
  async events(runId: string, afterSeq = -1): Promise<CafeEvent[]> {
    const a = this.active.get(runId)
    if (a) return a.bus.buffer.filter((e) => e.seq > afterSeq)
    return this.store.events.list(runId, { afterSeq })
  }

  /** Subscribe to a live run; returns null when the run is not active. */
  subscribe(runId: string, listener: (e: CafeEvent) => void): (() => void) | null {
    const a = this.active.get(runId)
    if (!a) return null
    const off = a.bus.subscribe(listener)
    return off
  }

  whenDone(runId: string): Promise<void> | null {
    return this.active.get(runId)?.done ?? null
  }
}
