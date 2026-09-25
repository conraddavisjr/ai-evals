import { type CafeStore, createDb, createPgStore, runMigrations } from '@cafe/db'
import { ModelRegistry } from '@cafe/models'
import { CafeEvent } from '@cafe/protocol'
import {
  EvalCase,
  type LoadedCase,
  PackConfig,
  Recorder,
  runPack,
  type Target,
  type TargetResult,
} from '@cafe/targets'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../http.js'
import { RunManager } from '../run-manager.js'

const { db, close } = createDb()
let store: CafeStore
const created: string[] = []

beforeAll(async () => {
  await runMigrations(db)
  store = createPgStore(db)
})
afterAll(async () => {
  for (const id of created) await store.runs.delete(id)
  await close()
})

const pack = PackConfig.parse({
  contract: 1,
  name: 'Recorder test app',
  project: 'recorder-test',
  target: {
    kind: 'http',
    url: 'http://app.test/api/eval',
    bodyTemplate: {},
    responseMap: { outcome: '$.o', outcomeMap: {} },
  },
  datasets: ['d.json'],
})

const cases: LoadedCase[] = [
  {
    ...EvalCase.parse({
      id: 'soup',
      title: 'Soup',
      tags: ['benign'],
      input: { prompt: 'soup' },
      expect: { outcome: 'served' },
    }),
    dataset: 'd',
  },
  {
    ...EvalCase.parse({
      id: 'ricin',
      title: 'Ricin',
      tags: ['harmful'],
      input: { prompt: 'ricin' },
      expect: { outcome: 'refused' },
    }),
    dataset: 'd',
  },
]

/** Answers without a network: the soup is served in two phases, the ricin turned away at the router. */
const target: Target = {
  kind: 'http',
  describe: () => 'stub',
  request: () => ({}),
  async invoke(c): Promise<TargetResult> {
    const served = c.id === 'soup'
    return {
      outcome: served ? 'served' : 'refused',
      reason: served ? null : 'harmful',
      detail: served ? null : 'Food only.',
      output: served ? [{ title: 'Leek soup' }] : [],
      steps: served
        ? [
            { name: 'drafting', ms: 30, model: 'm' },
            { name: 'reviewing', ms: 10, model: 'm' },
          ]
        : [{ name: 'classify', ms: 2, model: null }],
      usage: { inputTokens: 10, outputTokens: 5, usd: served ? 0.1 : 0 },
      model: 'm',
      latencyMs: served ? 45 : 3,
      httpStatus: 200,
      raw: {},
      contractErrors: [],
    }
  },
}

describe('recorded target runs', () => {
  it('streams a target run in, stores it under its project, and replays the same events', async () => {
    const runs = new RunManager(store, false)
    const app = createApp({ store, runs, allowLive: false })
    const recorder = new Recorder({
      url: 'http://dashboard.test',
      meta: {
        pack,
        cases,
        judgeSpec: null,
        info: {
          project: 'recorder-test',
          projectName: 'Recorder test app',
          pack: 'evals/stardust.config.json',
          url: 'http://app.test/api/eval',
          source: 'ci',
          git: {
            branch: 'feat/x',
            commit: 'abc1234',
            prNumber: 7,
            prUrl: 'https://github.com/o/r/pull/7',
          },
          vocabulary: {},
        },
      },
      // the recorder talks to the real app, in process
      fetch: ((url: string, init?: RequestInit) =>
        app.request(new URL(url).pathname, init)) as unknown as typeof fetch,
    })
    const runId = await recorder.start()
    created.push(runId)
    expect((await store.runs.get(runId))?.status).toBe('running')

    const report = await runPack({
      config: pack,
      cases,
      target,
      registry: new ModelRegistry({ allowLive: false }),
      judgeSpec: null,
      repeats: 1,
      concurrency: 2,
      maxUsd: null,
      thresholds: { byTag: {} },
      runId: 'local',
      onStart: (c, attempt, index, at) => recorder.caseStarted(c, attempt, index, at),
      onAttempt: (a, c) => recorder.caseFinished(c, a),
    })
    await recorder.finish(report, 'finished')
    expect(recorder.problems).toEqual([])

    const row = await store.runs.get(runId)
    expect(row).toMatchObject({
      status: 'finished',
      summary: { transactions: 2, succeeded: 2, failed: 0, costUsd: 0.1 },
      config: { domain: 'target', target: { project: 'recorder-test', git: { prNumber: 7 } } },
    })

    const listed = (await (await app.request('/api/runs?project=recorder-test')).json()) as Array<{
      id: string
    }>
    expect(listed.map((r) => r.id)).toContain(runId)
    const projects = (await (await app.request('/api/projects')).json()) as Array<{
      id: string
      name: string
    }>
    expect(projects).toContainEqual(
      expect.objectContaining({ id: 'recorder-test', name: 'Recorder test app' }),
    )

    const events = (await (await app.request(`/api/runs/${runId}/events`)).json()) as unknown[]
    const parsed = events.map((e) => CafeEvent.parse(e))
    expect(parsed[0]?.type).toBe('run.started')
    expect(parsed.at(-1)?.type).toBe('run.finished')
    expect(parsed.filter((e) => e.type === 'case.scored')).toHaveLength(2)
    expect(parsed.find((e) => e.type === 'triage.decided')).toMatchObject({
      routed: true,
      intent: 'harmful',
    })
    // seq is the stored order; times never run backwards
    expect(parsed.every((e, i) => e.seq === i && (i === 0 || e.t >= (parsed[i - 1]?.t ?? 0)))).toBe(
      true,
    )
  })

  it('requires the ingest token when one is configured', async () => {
    const runs = new RunManager(store, false)
    const app = createApp({ store, runs, allowLive: false })
    process.env.STARDUST_INGEST_TOKEN = 'secret'
    try {
      const denied = await app.request('/api/ingest/runs', { method: 'POST', body: '{}' })
      expect(denied.status).toBe(401)
      const bad = await app.request('/api/ingest/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ config: { scenarioIds: ['a'], roles: {} } }),
      })
      expect(bad.status).toBe(400)
    } finally {
      delete process.env.STARDUST_INGEST_TOKEN
    }
    const closed = await app.request('/api/ingest/runs/nope/events', {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    })
    expect(closed.status).toBe(400)
  })
})
