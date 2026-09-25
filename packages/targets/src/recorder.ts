import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import type { TargetRunInfo } from '@cafe/protocol'
import {
  caseEndEvents,
  caseSlot,
  caseStartEvents,
  LANES,
  pipelineOf,
  type RecordedEvent,
  runEndEvents,
  runStartEvents,
  type TargetRunMeta,
} from './events.js'
import type { LoadedCase } from './load.js'
import type { Attempt, Report } from './runner.js'

/**
 * Sends a target run to a Stardust dashboard as it happens, so the Trace board
 * and the scenes show it live, and it is stored under its project afterwards.
 * Recording is an observer: when the dashboard is down the evaluation still runs
 * and still gates; the recorder reports what it could not send.
 */
export class Recorder {
  private runId: string | null = null
  private chain: Promise<void> = Promise.resolve()
  private failures: string[] = []
  private slots = new Map<string, ReturnType<typeof caseSlot>>()

  constructor(
    private readonly opts: {
      /** The dashboard's API: http://localhost:4747 locally. */
      url: string
      token?: string | undefined
      meta: TargetRunMeta
      fetch?: typeof fetch
    },
  ) {}

  get id(): string | null {
    return this.runId
  }

  get problems(): string[] {
    return this.failures
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.url.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error ?? res.statusText}`)
    return json
  }

  /** Queue a send; sends go out one at a time so the dashboard gets events in order. */
  private send(events: RecordedEvent[]): void {
    if (!this.runId || !events.length) return
    const id = this.runId
    this.chain = this.chain
      .then(() => this.post(`/api/ingest/runs/${id}/events`, { events }))
      .then(() => undefined)
      .catch((err: Error) => {
        this.failures.push(err.message)
      })
  }

  async start(): Promise<string> {
    const t = Date.now()
    const start = runStartEvents(this.opts.meta, t)
    const config = (start[0] as { config: unknown }).config
    const res = (await this.post('/api/ingest/runs', { config })) as { runId: string }
    this.runId = res.runId
    this.send(start)
    return res.runId
  }

  caseStarted(c: LoadedCase, attempt: number, index: number, startedAt: number): void {
    const slot = caseSlot(c, attempt, index)
    this.slots.set(`${c.id}#${attempt}`, slot)
    this.send(caseStartEvents(c, slot, startedAt))
  }

  caseFinished(c: LoadedCase, a: Attempt): void {
    const slot = this.slots.get(`${c.id}#${a.attempt}`) ?? caseSlot(c, a.attempt, a.index)
    if (!this.slots.has(`${c.id}#${a.attempt}`)) this.send(caseStartEvents(c, slot, a.startedAt))
    this.send(
      caseEndEvents(a, slot, {
        t0: a.startedAt,
        project: this.opts.meta.info.project,
        pipeline: pipelineOf(this.opts.meta.pack),
      }),
    )
  }

  async finish(report: Report, status: 'finished' | 'failed' | 'cancelled'): Promise<void> {
    this.send(runEndEvents(report, Date.now()))
    await this.chain
    if (!this.runId) return
    await this.post(`/api/ingest/runs/${this.runId}/finish`, { status }).catch((err: Error) =>
      this.failures.push(err.message),
    )
  }

  /**
   * A finished report (a replay, or an import of an earlier run) sent in one go,
   * with the timeline rebuilt from each answer's latency across the two lanes.
   */
  async sendReport(report: Report, cases: LoadedCase[]): Promise<void> {
    const byId = new Map(cases.map((c) => [c.id, c]))
    const asked = (this.opts.meta.pack.judge?.questions ?? []).map((q) => ({
      id: q.id,
      type: q.type,
      instructions: q.instructions,
    }))
    const base = Date.parse(report.startedAt) || Date.now()
    const laneFree = Array.from({ length: LANES }, () => base)
    const start = runStartEvents(this.opts.meta, base)
    const events: RecordedEvent[] = []
    // Report order is start order; older reports carry no index.
    // Reports written before a field existed still import: fill it from the pack and the report.
    const attempts = report.cases
      .flatMap((c) => c.attempts)
      .map((a, i) => ({
        a: {
          ...a,
          judge: a.judge
            ? {
                ...a.judge,
                spec: a.judge.spec ?? report.judge ?? '',
                questions: a.judge.questions ?? asked,
              }
            : null,
        },
        order: a.index ?? i,
      }))
      .sort((x, y) => x.order - y.order)
    let index = 0
    for (const { a } of attempts) {
      const c = byId.get(a.caseId)
      if (!c) continue
      const lane = laneFree.indexOf(Math.min(...laneFree))
      const t0 = laneFree[lane] ?? base
      const slot = { ...caseSlot(c, a.attempt, index++), lane: lane + 1 }
      const end = caseEndEvents({ ...a, startedAt: t0 }, slot, {
        t0,
        project: this.opts.meta.info.project,
        pipeline: pipelineOf(this.opts.meta.pack),
      })
      events.push(...caseStartEvents(c, slot, t0), ...end)
      // A short gap between cases on a lane, so the scenes show one leaving before the next arrives.
      laneFree[lane] = Math.max(t0 + (a.result?.latencyMs ?? 0), end.at(-1)?.t ?? t0) + 400
    }
    events.sort((x, y) => x.t - y.t)
    const config = (start[0] as { config: unknown }).config
    this.runId = (
      (await this.post('/api/ingest/runs', { config, startedAt: base })) as { runId: string }
    ).runId
    const all = [...start, ...events]
    for (let i = 0; i < all.length; i += 200) this.send(all.slice(i, i + 200))
    const endAt = Math.max(...laneFree)
    this.send(runEndEvents(report, endAt))
    await this.chain
    await this.post(`/api/ingest/runs/${this.runId}/finish`, { status: 'finished' }).catch(
      (err: Error) => this.failures.push(err.message),
    )
  }
}

const git = (cwd: string, args: string[]): string | undefined => {
  try {
    return (
      execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
    )
  } catch {
    return undefined
  }
}

/** "conraddavisjr/ai-recipe-builder" from an https or ssh remote. */
export function repoFromRemote(remote: string | undefined): string | undefined {
  const m = remote?.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)
  return m?.[1]
}

/**
 * Where this run came from. In GitHub Actions: the repo, branch, commit, pull
 * request and job link from the environment. Locally: the config pack's git
 * checkout, and the open pull request for its branch when `gh` can find one.
 */
/** The pack's path inside its own repository ("evals/stardust.config.json"), else as given. */
export function packPath(file: string, packDir: string): string {
  const root = git(packDir, ['rev-parse', '--show-toplevel'])
  if (!root) return file
  const rel = file.startsWith(root) ? file.slice(root.length).replace(/^\//, '') : null
  return rel || file
}

export function gitContext(
  packDir: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  source: 'local' | 'ci'
  git: TargetRunInfo['git']
} {
  if (env.GITHUB_ACTIONS === 'true') {
    let prNumber: number | undefined
    let prUrl: string | undefined
    if (env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)) {
      try {
        const ev = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as {
          pull_request?: { number?: number; html_url?: string; head?: { sha?: string } }
        }
        prNumber = ev.pull_request?.number
        prUrl = ev.pull_request?.html_url
      } catch {}
    }
    const server = env.GITHUB_SERVER_URL ?? 'https://github.com'
    return {
      source: 'ci',
      git: {
        ...(env.GITHUB_REPOSITORY ? { repo: env.GITHUB_REPOSITORY } : {}),
        ...(env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME
          ? { branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME }
          : {}),
        ...(env.GITHUB_SHA ? { commit: env.GITHUB_SHA } : {}),
        ...(prNumber ? { prNumber } : {}),
        ...(prUrl ? { prUrl } : {}),
        ...(env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
          ? { runUrl: `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` }
          : {}),
      },
    }
  }
  const branch = git(packDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const commit = git(packDir, ['rev-parse', 'HEAD'])
  const repo = repoFromRemote(git(packDir, ['remote', 'get-url', 'origin']))
  let prNumber: number | undefined
  let prUrl: string | undefined
  if (branch && branch !== 'HEAD' && branch !== 'main' && branch !== 'master') {
    try {
      const out = execFileSync('gh', ['pr', 'view', branch, '--json', 'number,url'], {
        cwd: packDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
      })
      const pr = JSON.parse(out) as { number?: number; url?: string }
      prNumber = pr.number
      prUrl = pr.url
    } catch {}
  }
  return {
    source: 'local',
    git: {
      ...(repo ? { repo } : {}),
      ...(branch ? { branch } : {}),
      ...(commit ? { commit } : {}),
      ...(prNumber ? { prNumber } : {}),
      ...(prUrl ? { prUrl } : {}),
    },
  }
}
