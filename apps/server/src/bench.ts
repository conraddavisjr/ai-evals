import type { CafeStore } from '@cafe/db'
import { domainPack } from '@cafe/domains'
import {
  BENCH_TASKS,
  type BenchItem,
  type BenchProgress,
  type BenchReport,
  type BenchTask,
  blindJudgeInstructions,
  DOOR_INSTRUCTIONS,
  runBench,
  withoutGroundTruth,
} from '@cafe/evals'
import { ModelRegistry } from '@cafe/models'
import { isMockSpec } from '@cafe/protocol'
import { ulid } from 'ulid'
import { z } from 'zod'

export const BenchConfig = z.object({
  domain: z.string().default('cafe'),
  // five at most: one per categorical chart colour, never cycled
  specs: z.array(z.string().min(1)).min(1).max(5),
  tasks: z.array(z.enum(BENCH_TASKS as [BenchTask, ...BenchTask[]])).min(1),
  /** A finished run whose judged cases become the judge task (its ground truth is the label). */
  judgeRunId: z.string().optional(),
  concurrency: z.number().int().min(1).max(16).default(4),
})
export type BenchConfig = z.infer<typeof BenchConfig>
export type BenchConfigInput = z.input<typeof BenchConfig>

/** Build the labelled decisions for a domain: the door from its golden cases, the gate from its rules, the judge from a run. */
export async function benchItems(store: CafeStore, config: BenchConfig): Promise<BenchItem[]> {
  const pack = domainPack(config.domain)
  const items: BenchItem[] = []
  if (config.tasks.includes('door'))
    for (const s of pack.dataset.scenarios)
      items.push({
        id: `door:${s.id}`,
        task: 'door',
        title: s.title,
        state: pack.triage.state(s.customer.utterances[0] ?? ''),
        instructions: DOOR_INSTRUCTIONS,
        // manipulation is what the door turns away; a policy "no" is the agents' job
        label: s.tags.includes('adversarial') && s.expected.shouldRefuse,
        note: s.tags.includes('adversarial')
          ? s.expected.shouldRefuse
            ? 'manipulation: turn away'
            : 'pressure, but a legitimate request underneath'
          : 'legitimate request',
      })
  if (config.tasks.includes('gate') && pack.gate && pack.gateBench)
    for (const g of pack.gateBench())
      items.push({ ...g, task: 'gate', instructions: pack.gate.instructions })
  if (config.tasks.includes('judge') && config.judgeRunId) {
    const [judged, metrics] = await Promise.all([
      store.judgements.forRun(config.judgeRunId),
      store.metrics.get(config.judgeRunId),
    ])
    const truth = new Map(metrics?.perTransaction.map((t) => [t.txId, t]) ?? [])
    const correct = blindJudgeInstructions(pack.judgeQuestions.correct.instructions)
    for (const j of judged) {
      const t = truth.get(j.txId)
      if (!t) continue
      const transcript = withoutGroundTruth(j.blindedTranscript)
      items.push({
        id: `judge:${j.txId}`,
        task: 'judge',
        title: String(transcript?.scenario?.title ?? t.scenarioId),
        state: transcript,
        instructions: correct,
        label: t.taskSuccess,
        note: t.taskSuccess
          ? 'ground truth: right'
          : `ground truth: ${t.taskSuccessReasons.join('; ')}`,
      })
    }
  }
  return items
}

interface Live {
  progress: BenchProgress
  abort: AbortController
}

/** Runs benches in the background and keeps their reports in Postgres, so they outlive a restart. */
export class BenchRunner {
  private readonly live = new Map<string, Live>()

  constructor(
    private readonly store: CafeStore,
    private readonly allowLive: boolean,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async start(input: BenchConfigInput): Promise<{ id: string; items: number }> {
    const config = BenchConfig.parse(input)
    domainPack(config.domain)
    const live = config.specs.filter((s) => !isMockSpec(s))
    if (live.length && !this.allowLive)
      throw new Error(
        `Live models requested (${live.join(', ')}) but CAFE_ALLOW_LIVE_MODELS is not "true".`,
      )
    const items = await benchItems(this.store, config)
    if (items.length === 0)
      throw new Error(
        config.tasks.includes('judge') && !config.judgeRunId
          ? 'The judge task needs a finished run to read (judgeRunId).'
          : 'Nothing to decide: this domain has no items for the chosen tasks.',
      )
    const id = ulid()
    await this.store.benches.create({ id, config, now: this.now() })
    const state: Live = {
      progress: { done: 0, total: items.length * config.specs.length },
      abort: new AbortController(),
    }
    this.live.set(id, state)
    void runBench({
      registry: new ModelRegistry(),
      specs: config.specs,
      items,
      concurrency: config.concurrency,
      now: this.now,
      signal: state.abort.signal,
      onProgress: (p) => {
        state.progress = p
      },
    })
      .then((report) =>
        this.store.benches.finish(id, { status: 'finished', report, now: this.now() }),
      )
      .catch((err) =>
        this.store.benches.finish(id, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          now: this.now(),
        }),
      )
      .finally(() => this.live.delete(id))
    return { id, items: items.length }
  }

  cancel(id: string): boolean {
    const l = this.live.get(id)
    l?.abort.abort()
    return Boolean(l)
  }

  async get(id: string) {
    const row = await this.store.benches.get(id)
    if (!row) return null
    return {
      id: row.id,
      status: row.status,
      config: row.config as BenchConfig,
      report: (row.report ?? null) as BenchReport | null,
      error: row.error,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      progress: this.live.get(id)?.progress ?? null,
    }
  }

  async list() {
    const rows = await this.store.benches.list()
    return rows.map((r) => ({
      id: r.id,
      status: this.live.has(r.id) || r.status !== 'running' ? r.status : 'failed',
      config: r.config as BenchConfig,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      progress: this.live.get(r.id)?.progress ?? null,
    }))
  }
}
