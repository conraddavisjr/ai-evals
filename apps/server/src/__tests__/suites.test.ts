import { type CafeStore, createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { BUILTIN_DATASET_ID, type SuiteDetail } from '@cafe/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../http.js'
import { RunManager } from '../run-manager.js'
import type { SuiteMetricsView, SuiteTelemetryView } from '../suite-results.js'
import { SuiteRunner } from '../suite-runner.js'
import { initTracing, type Tracing } from '../telemetry/tracing.js'

const { db, close } = createDb()
let store: CafeStore
let tracing: Tracing
const createdSuites: string[] = []

beforeAll(async () => {
  await runMigrations(db)
  await seedCatalog(db)
  store = createPgStore(db)
  tracing = initTracing({ store })
})
afterAll(async () => {
  await tracing.shutdown()
  // deleting a suite cascades to its runs
  for (const id of createdSuites) await store.suites.delete(id)
  await close()
})

const INSTANT = {
  llmStepMs: [0, 0] as [number, number],
  toolMs: [0, 0] as [number, number],
  hangOrders: [],
  hangMs: 0,
}
const BASE = {
  roles: {
    cashier: 'mock:cashier',
    barista: 'mock:barista',
    manager: 'mock:manager',
    judge: 'mock:judge',
  },
  arrivalGapMs: 0,
  mockPacing: INSTANT,
}
const json = (body: unknown, method = 'POST') => ({
  method,
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
})

describe('suites', () => {
  it('runs every variant over the same golden items, two at a time, and builds the comparison', async () => {
    const runs = new RunManager(store, false)
    const suites = new SuiteRunner(store, runs)
    const app = createApp({ store, runs, suites, allowLive: false })

    // a bad variant is a 400 before anything is written
    const bad = await app.request(
      '/api/suites',
      json({
        datasetId: BUILTIN_DATASET_ID,
        base: BASE,
        variants: [{ name: 'live', roles: { judge: 'anthropic/claude-haiku-4-5' } }],
      }),
    )
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toMatch(/CAFE_ALLOW_LIVE_MODELS/)
    const unknownEngine = await app.request(
      '/api/suites',
      json({
        datasetId: BUILTIN_DATASET_ID,
        base: BASE,
        variants: [{ name: 'x', orchestrator: 'langchain' }],
      }),
    )
    expect(((await unknownEngine.json()) as { error: string }).error).toMatch(
      /Unknown orchestrator/,
    )

    const res = await app.request(
      '/api/suites',
      json({
        name: 'naive vs careful',
        datasetId: BUILTIN_DATASET_ID,
        itemIds: ['latte-simple', 'scope-probe', 'refund-scam'],
        base: BASE,
        variants: [
          { name: 'careful', roles: {} },
          { name: 'naive', roles: { cashier: 'mock:cashier-naive' } },
        ],
        concurrency: 2,
      }),
    )
    expect(res.status).toBe(201)
    const { suiteId } = (await res.json()) as { suiteId: string }
    createdSuites.push(suiteId)

    const early = (await (await app.request(`/api/suites/${suiteId}`)).json()) as SuiteDetail
    expect(early.progress.total).toBe(2)
    await suites.whenDone(suiteId)

    const detail = (await (await app.request(`/api/suites/${suiteId}`)).json()) as SuiteDetail
    expect(detail.status).toBe('finished')
    expect(detail.runs.map((r) => [r.variant, r.status])).toEqual([
      ['careful', 'finished'],
      ['naive', 'finished'],
    ])
    expect(detail.progress).toEqual({ total: 2, done: 2, running: 0, queued: 0 })
    // both runs ran concurrently: the second started before the first finished
    const rows = await store.runs.forSuite(suiteId)
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.suiteId === suiteId)).toBe(true)
    const [a, b] = rows
    expect((b?.startedAt ?? 0) < (a?.finishedAt ?? 0)).toBe(true)
    expect(rows.map((r) => r.config.roles.cashier).sort()).toEqual([
      'mock:cashier',
      'mock:cashier-naive',
    ])

    const m = (await (
      await app.request(`/api/suites/${suiteId}/metrics`)
    ).json()) as SuiteMetricsView
    expect(m.variants.map((v) => v.key)).toEqual(['careful', 'naive'])
    expect(m.variants.every((v) => v.result?.transactions === 3)).toBe(true)
    expect(m.matrix.map((r) => r.scenarioId)).toEqual([
      'latte-simple',
      'scope-probe',
      'refund-scam',
    ])
    expect(m.matrix[0]?.cells.careful?.taskSuccess).toBe(true)
    expect(m.matrix[0]?.cells.naive?.taskSuccess).toBe(true)
    // the naive cashier reaches for tools outside its role: that is the comparison the suite is for
    const careful = m.variants.find((v) => v.key === 'careful')?.result
    const naive = m.variants.find((v) => v.key === 'naive')?.result
    expect(careful?.scopeViolations).toBe(0)
    expect(naive?.scopeViolations ?? 0).toBeGreaterThan(0)
    expect(naive?.taskSuccessRate ?? 1).toBeLessThan(careful?.taskSuccessRate ?? 0)

    const t = (await (
      await app.request(`/api/suites/${suiteId}/telemetry`)
    ).json()) as SuiteTelemetryView
    expect(t.variants.map((v) => v.result?.items.length)).toEqual([3, 3])
    expect(t.variants[0]?.result?.variant).toBe('careful')
    // spans of both runs are tagged with the suite and their variant
    const spans = await store.spans.forSuite(suiteId, { kinds: ['run'] })
    expect(spans.map((s) => s.attributes['cafe.variant']).sort()).toEqual(['careful', 'naive'])
    expect(spans.every((s) => s.suiteId === suiteId)).toBe(true)
    const suiteSpan = await store.spans.forSuite(suiteId, { kinds: ['suite'] })
    expect(suiteSpan.length).toBe(1)
  })

  it('cancels: running variants stop and queued ones never start', async () => {
    const runs = new RunManager(store, false)
    const suites = new SuiteRunner(store, runs)
    const { suiteId } = await suites.start({
      name: 'cancel me',
      datasetId: BUILTIN_DATASET_ID,
      itemIds: ['latte-simple', 'two-items', 'oat-latte-large'],
      base: { ...BASE, mockPacing: { ...INSTANT, llmStepMs: [50, 80] } },
      variants: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      concurrency: 1,
    })
    createdSuites.push(suiteId)
    await new Promise((r) => setTimeout(r, 150))
    expect(suites.cancel(suiteId)).toBe(true)
    await suites.whenDone(suiteId)
    const detail = await suites.detail(suiteId)
    expect(detail?.status).toBe('cancelled')
    expect(detail?.runs.filter((r) => r.status === 'queued').length).toBeGreaterThanOrEqual(1)
    expect(detail?.runs.some((r) => r.status === 'cancelled')).toBe(true)
  })
})
