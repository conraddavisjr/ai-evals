import type { CafeStore, RunRow } from '@cafe/db'
import {
  type RunConfig,
  RunConfig as RunConfigSchema,
  type Scenario,
  type SuiteConfig,
  type SuiteConfigInput,
  SuiteConfig as SuiteConfigSchema,
  type SuiteDetail,
  type SuiteRunRef,
  variantKey,
} from '@cafe/protocol'
import { ATTR, markOk, recordError, type Span, startSpan } from '@cafe/telemetry'
import type { RunManager } from './run-manager.js'
import { getDataset, resolveScenarios } from './scenarios.js'
import { flushTracing } from './telemetry/tracing.js'

interface PlannedRun {
  variant: string
  repeat: number
  config: RunConfig
}

interface ActiveSuite {
  cancelled: boolean
  /** runIds that have been started, in start order. */
  started: string[]
  planned: PlannedRun[]
  done: Promise<void>
}

/**
 * Executes a suite: one run per variant (times repeats) over the same golden
 * dataset, `concurrency` at a time. Sequential by default so cost and load are
 * predictable; raising the number is the whole path to parallel, since RunManager
 * already holds any number of active runs.
 */
export class SuiteRunner {
  private active = new Map<string, ActiveSuite>()

  constructor(
    private readonly store: CafeStore,
    private readonly runs: RunManager,
  ) {}

  /** Build every run config up front so a bad variant is a 400 before anything is written. */
  async plan(
    input: SuiteConfigInput,
  ): Promise<{ config: SuiteConfig; scenarios: Scenario[]; planned: PlannedRun[] }> {
    const config = SuiteConfigSchema.parse(input)
    const dataset = await getDataset(this.store, config.datasetId)
    if (!dataset) throw new Error(`Dataset ${config.datasetId} not found`)
    const ids = config.itemIds ?? dataset.items.map((i) => i.id)
    const scenarios = await resolveScenarios(this.store, ids)
    const planned: PlannedRun[] = []
    const names = new Set<string>()
    for (const v of config.variants) {
      if (names.has(v.name)) throw new Error(`Duplicate variant name "${v.name}"`)
      names.add(v.name)
      for (let repeat = 1; repeat <= config.repeats; repeat++) {
        const merged = RunConfigSchema.parse({
          ...config.base,
          name: `${config.name} / ${variantKey(v.name, repeat)}`,
          scenarioIds: ids,
          roles: { ...config.base.roles, ...v.roles },
          orchestrator: v.orchestrator ?? config.base.orchestrator,
          staffing: { ...config.base.staffing, ...(v.staffing ?? {}) },
          chaos: { ...config.base.chaos, ...(v.chaos ?? {}) },
          budget: { ...config.base.budget, ...(v.budget ?? {}) },
        })
        // the same live-model / orchestrator checks a single run gets
        this.runs.validateConfig(merged)
        planned.push({ variant: v.name, repeat, config: merged })
      }
    }
    return { config, scenarios, planned }
  }

  async start(input: SuiteConfigInput): Promise<{ suiteId: string }> {
    const { config, scenarios, planned } = await this.plan(input)
    const suite = await this.store.suites.create({ name: config.name, config, now: Date.now() })
    const state: ActiveSuite = { cancelled: false, started: [], planned, done: Promise.resolve() }
    state.done = this.execute(suite.id, config, scenarios, state)
      .catch((err) => console.error(`[suite ${suite.id}] failed:`, err))
      .finally(() => {
        setTimeout(() => this.active.delete(suite.id), 10_000).unref()
      })
    this.active.set(suite.id, state)
    return { suiteId: suite.id }
  }

  private async execute(
    suiteId: string,
    config: SuiteConfig,
    scenarios: Scenario[],
    state: ActiveSuite,
  ): Promise<void> {
    await this.store.suites.setStatus(suiteId, 'running', { startedAt: Date.now() })
    const span: Span = startSpan('suite', `suite ${config.name}`, {
      [ATTR.SUITE_ID]: suiteId,
      'cafe.variants': config.variants.length,
      'cafe.repeats': config.repeats,
      'cafe.items': scenarios.length,
      'cafe.concurrency': config.concurrency,
    })
    const queue = [...state.planned]
    const worker = async () => {
      for (;;) {
        const next = queue.shift()
        if (!next || state.cancelled) return
        try {
          const { runId } = await this.runs.start(next.config, {
            scenarios,
            parentContext: span,
            suite: { suiteId, variant: variantKey(next.variant, next.repeat) },
            variant: next.variant,
            repeat: next.repeat,
          })
          state.started.push(runId)
          await this.runs.whenDone(runId)
        } catch (err) {
          console.error(`[suite ${suiteId}] variant ${next.variant} failed to start:`, err)
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: config.concurrency }, worker))
      const status = state.cancelled ? 'cancelled' : 'finished'
      await this.store.suites.setStatus(suiteId, status, { finishedAt: Date.now() })
      span.setAttribute(ATTR.OUTCOME, status)
      markOk(span)
    } catch (err) {
      await this.store.suites.setStatus(suiteId, 'failed', {
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      })
      recordError(span, err, 'suite')
      throw err
    } finally {
      span.end()
      await flushTracing()
    }
  }

  /** Stops the current runs and never starts the queued ones. */
  cancel(suiteId: string): boolean {
    const state = this.active.get(suiteId)
    if (!state) return false
    state.cancelled = true
    for (const id of state.started) this.runs.cancel(id)
    return true
  }

  isActive(suiteId: string): boolean {
    return this.active.has(suiteId)
  }

  whenDone(suiteId: string): Promise<void> | null {
    return this.active.get(suiteId)?.done ?? null
  }

  /** Suites left running by a dead process (same reasoning as RunManager.reapOrphans). */
  async reapOrphans(): Promise<string[]> {
    const rows = await this.store.suites.list(200)
    const orphans = rows.filter(
      (s) => (s.status === 'running' || s.status === 'pending') && !this.active.has(s.id),
    )
    for (const s of orphans)
      await this.store.suites.setStatus(s.id, 'failed', {
        finishedAt: Date.now(),
        error: 'interrupted: the server restarted while this suite was running',
      })
    return orphans.map((s) => s.id)
  }

  /** The suite row with every planned run's status, for the UI's progress view. */
  async detail(suiteId: string): Promise<SuiteDetail | null> {
    const row = await this.store.suites.get(suiteId)
    if (!row) return null
    const rows = await this.store.runs.forSuite(suiteId)
    const byKey = new Map<string, RunRow>()
    for (const r of rows) byKey.set(variantKey(r.variant ?? '', r.repeat ?? 1), r)
    const refs: SuiteRunRef[] = []
    for (const v of row.config.variants) {
      for (let repeat = 1; repeat <= row.config.repeats; repeat++) {
        const r = byKey.get(variantKey(v.name, repeat))
        refs.push({
          variant: v.name,
          repeat,
          runId: r?.id ?? null,
          status: r ? r.status : 'queued',
          active: r ? this.runs.isActive(r.id) : false,
        })
      }
    }
    const done = refs.filter((r) => ['finished', 'failed', 'cancelled'].includes(r.status)).length
    const running = refs.filter((r) => r.status === 'running' || r.status === 'pending').length
    return {
      ...row,
      runs: refs,
      progress: { total: refs.length, done, running, queued: refs.length - done - running },
    }
  }
}
