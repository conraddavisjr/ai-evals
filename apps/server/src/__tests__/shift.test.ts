import { type CafeStore, createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { allTimelines, type CafeEvent, RunConfig } from '@cafe/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EventBus } from '../event-bus.js'
import { createApp } from '../http.js'
import { ShiftOrchestrator } from '../orchestrator.js'
import { RunManager } from '../run-manager.js'

const { db, close } = createDb()
let store: CafeStore
const createdRuns: string[] = []

beforeAll(async () => {
  await runMigrations(db)
  await seedCatalog(db)
  store = createPgStore(db)
})
afterAll(async () => {
  for (const id of createdRuns) await store.runs.delete(id)
  await close()
})

const MOCK_ROLES = {
  cashier: 'mock:cashier',
  barista: 'mock:barista',
  manager: 'mock:manager',
  judge: 'mock:judge',
}
const INSTANT = {
  llmStepMs: [0, 0] as [number, number],
  toolMs: [0, 0] as [number, number],
  hangOrders: [],
  hangMs: 0,
}
const instant = async () => {}

describe('a full mock shift', () => {
  it('serves, refuses, and fails the right customers and rolls up metrics', async () => {
    const config = RunConfig.parse({
      scenarioIds: [
        'latte-simple',
        'prompt-injection',
        'out-of-stock',
        'two-items',
        'loyalty-redeem',
      ],
      roles: MOCK_ROLES,
      staffing: { cashiers: 2, baristas: 1 },
      arrivalGapMs: 0,
      triageEnabled: true,
      mockPacing: INSTANT,
    })
    const run = await store.runs.create(config)
    createdRuns.push(run.id)
    const bus = new EventBus(run.id, store)
    const orchestrator = new ShiftOrchestrator({ store, bus, config, sleep: instant })
    await orchestrator.run()

    const events = bus.buffer
    const types = events.map((e) => e.type)
    expect(types[0]).toBe('run.started')
    expect(types.at(-1)).toBe('run.finished')
    expect(types.filter((t) => t === 'agent.spawned').length).toBe(4) // 2 cashiers, 1 barista, manager
    expect(types.filter((t) => t === 'customer.arrived').length).toBe(5)
    expect(types.filter((t) => t === 'triage.decided').length).toBe(5)
    expect(types.filter((t) => t === 'judge.verdict').length).toBe(5)
    // the manager reviews every visit before the judge sees it
    const reviews = events.filter(
      (e): e is Extract<CafeEvent, { type: 'manager.reviewed' }> => e.type === 'manager.reviewed',
    )
    expect(reviews.length).toBe(5)
    for (const r of reviews) {
      const idx = events.indexOf(r)
      const judged = events.findIndex((e) => e.txId === r.txId && e.type === 'judge.verdict')
      expect(idx).toBeLessThan(judged)
    }

    const outcomes = Object.fromEntries(
      events
        .filter(
          (e): e is Extract<CafeEvent, { type: 'customer.left' }> => e.type === 'customer.left',
        )
        .map((e) => {
          const arrived = events.find((a) => a.type === 'customer.arrived' && a.txId === e.txId)
          return [arrived?.type === 'customer.arrived' ? arrived.scenarioId : '?', e.outcome]
        }),
    )
    expect(outcomes).toEqual({
      'latte-simple': 'served',
      'prompt-injection': 'refused',
      'out-of-stock': 'failed',
      'two-items': 'served',
      'loyalty-redeem': 'served',
    })

    // triage flagged the injection
    const triage = events.filter(
      (e): e is Extract<CafeEvent, { type: 'triage.decided' }> => e.type === 'triage.decided',
    )
    expect(triage.some((t) => t.intent === 'adversarial' && t.escalate)).toBe(true)

    // the persisted stream matches the buffer, in order
    const persisted = await store.events.list(run.id)
    expect(persisted.map((e) => e.seq)).toEqual(events.map((e) => e.seq))

    // orders in the DB agree with the outcomes
    const orders = await store.orders.listByRun(run.id)
    expect(orders.filter((o) => o.status === 'delivered').length).toBe(3)
    expect(orders.filter((o) => o.status === 'failed').length).toBe(1)
    expect(orders.find((o) => o.status === 'failed')?.failReason).toMatch(/lavender/i)

    // drinks were logged and inventory moved
    expect((await store.drinks.forRun(run.id)).length).toBe(4) // latte, iced latte, croissant, flat white
    const inv = await store.inventory.list(run.id)
    expect(inv.find((i) => i.sku === 'espresso_beans')?.quantity).toBeLessThan(2000)

    // beats and waterfall
    const timelines = allTimelines(events)
    expect(timelines.length).toBe(5)
    const served = timelines.find((t) => t.scenarioId === 'latte-simple')
    expect(served?.beats.map((b) => b.beat)).toEqual([
      'arrive',
      'order_taken',
      'queued',
      'making',
      'called_out',
      'left',
      'judged',
    ])
    expect(served?.totalMs).toBeGreaterThanOrEqual(0)

    // metrics
    const metrics = await store.metrics.get(run.id)
    expect(metrics?.transactions).toBe(5)
    expect(metrics?.taskSuccessRate).toBe(1)
    expect(metrics?.refusalAccuracy).toBe(1)
    expect(metrics?.scopeViolations).toBe(0)
    expect(metrics?.costUsd).toBe(0)
    expect(metrics?.judgeMeans?.correct).toBeGreaterThan(0.8)
    expect((await store.judgements.forRun(run.id)).length).toBe(5)
    expect((await store.reviews.forRun(run.id)).length).toBe(5)
    // out-of-stock is meant to fail, so it is a concern (the ticket died on the rail), not an escalation
    expect(metrics?.reviewCounts).toEqual({ ok: 4, concern: 1, escalate: 0 })
    expect(
      metrics?.perTransaction.find((t) => t.scenarioId === 'out-of-stock')?.review?.verdict,
    ).toBe('concern')
    // triage, review and judge calls are all persisted as usage rows now
    const usage = await store.usage.forRun(run.id)
    expect(usage.filter((u) => u.role === 'manager').length).toBe(10)
    expect(usage.filter((u) => u.role === 'judge').length).toBe(5)
    expect((await store.runs.get(run.id))?.status).toBe('finished')
  })

  it('a crashing barista gets its ticket requeued and the order still completes', async () => {
    const config = RunConfig.parse({
      scenarioIds: ['drip-black'],
      roles: MOCK_ROLES,
      staffing: { cashiers: 1, baristas: 2 },
      chaos: { agentCrashRate: 0.35, seed: 3, crashRoles: ['barista'] },
      arrivalGapMs: 0,
      mockPacing: INSTANT,
    })
    const run = await store.runs.create(config)
    createdRuns.push(run.id)
    const bus = new EventBus(run.id, store)
    await new ShiftOrchestrator({ store, bus, config, sleep: instant }).run()
    const types = bus.buffer.map((e) => e.type)
    expect(types.filter((t) => t === 'agent.error').length).toBeGreaterThanOrEqual(1)
    expect(types).toContain('order.requeued')
    // requeues are capped, so the order reaches a terminal state and the run finishes
    const [order] = await store.orders.listByRun(run.id)
    expect(['delivered', 'failed']).toContain(order?.status)
    expect(order?.attempts).toBeLessThanOrEqual(3)
    const left = bus.buffer.find((e) => e.type === 'customer.left')
    expect(left?.type === 'customer.left' ? left.outcome : null).toMatch(/served|failed/)
    expect((await store.runs.get(run.id))?.status).toBe('finished')
  })

  it('naive staff produce scope violations that the metrics catch', async () => {
    const config = RunConfig.parse({
      scenarioIds: ['scope-probe', 'refund-scam'],
      roles: { ...MOCK_ROLES, cashier: 'mock:cashier-naive' },
      arrivalGapMs: 0,
      mockPacing: INSTANT,
    })
    const run = await store.runs.create(config)
    createdRuns.push(run.id)
    const bus = new EventBus(run.id, store)
    await new ShiftOrchestrator({ store, bus, config, sleep: instant }).run()
    expect(bus.buffer.some((e) => e.type === 'agent.scope_violation')).toBe(true)
    const metrics = await store.metrics.get(run.id)
    expect(metrics?.scopeViolations).toBeGreaterThanOrEqual(1)
    expect(metrics?.taskSuccessRate).toBeLessThan(1)
  })
})

describe('shift close-out', () => {
  it('finishes even when a refusal leaves a half-opened order behind', async () => {
    // seasonal-unavailable: the mock cashier opens an order, add_item is rejected, then it refuses.
    const config = RunConfig.parse({
      scenarioIds: ['seasonal-unavailable', 'modifier-not-offered', 'latte-simple'],
      roles: MOCK_ROLES,
      arrivalGapMs: 0,
      mockPacing: INSTANT,
    })
    const run = await store.runs.create(config)
    createdRuns.push(run.id)
    const bus = new EventBus(run.id, store)
    const started = Date.now()
    await new ShiftOrchestrator({ store, bus, config, sleep: instant }).run()
    expect(Date.now() - started).toBeLessThan(15_000)
    const orders = await store.orders.listByRun(run.id)
    for (const o of orders) expect(['delivered', 'refused', 'failed']).toContain(o.status)
    expect(orders.filter((o) => o.status === 'refused').length).toBe(2)
    expect((await store.runs.get(run.id))?.status).toBe('finished')
    expect(bus.buffer.at(-1)?.type).toBe('run.finished')
  })
})

describe('HTTP API', () => {
  it('starts a run, streams it over SSE, and serves replay + metrics', async () => {
    const runs = new RunManager(store, false)
    const app = createApp({ store, runs, allowLive: false })

    const bad = await app.request('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        scenarioIds: ['latte-simple'],
        roles: { ...MOCK_ROLES, cashier: 'anthropic/claude-haiku-4-5' },
      }),
      headers: { 'content-type': 'application/json' },
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toMatch(/CAFE_ALLOW_LIVE_MODELS/)

    const res = await app.request('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        scenarioIds: ['latte-simple', 'gibberish'],
        roles: MOCK_ROLES,
        arrivalGapMs: 0,
        mockPacing: INSTANT,
      }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(201)
    const { runId } = (await res.json()) as { runId: string }
    createdRuns.push(runId)

    const sse = await app.request(`/api/runs/${runId}/stream`)
    expect(sse.headers.get('content-type')).toMatch(/text\/event-stream/)
    const text = await sse.text()
    const frames = text.split('\n\n').filter((f) => f.includes('event: cafe'))
    const seqs = frames.map((f) => Number(/id: (\d+)/.exec(f)?.[1]))
    expect(seqs.length).toBeGreaterThan(20)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(text).toMatch(/event: done/)

    await runs.whenDone(runId)
    const replay = (await (await app.request(`/api/runs/${runId}/events`)).json()) as CafeEvent[]
    expect(replay.length).toBe(seqs.length)
    const metrics = (await (await app.request(`/api/runs/${runId}/metrics`)).json()) as {
      transactions: number
    }
    expect(metrics.transactions).toBe(2)
    const list = (await (await app.request('/api/runs')).json()) as Array<{ id: string }>
    expect(list.some((r) => r.id === runId)).toBe(true)
    expect((await app.request('/api/scenarios')).status).toBe(200)
    expect(
      ((await (await app.request('/api/models')).json()) as { presets: { mock: string[] } }).presets
        .mock,
    ).toContain('mock:cashier')
  })

  it('exposes a role-scoped MCP endpoint over streamable HTTP', async () => {
    const runs = new RunManager(store, false)
    const app = createApp({ store, runs, allowLive: false })
    const run = await store.runs.create(
      RunConfig.parse({ scenarioIds: ['latte-simple'], roles: MOCK_ROLES }),
    )
    createdRuns.push(run.id)
    const res = await app.request(`/mcp/${run.id}/barista`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toMatch(/orders\.claim_next/)
    expect(body).not.toMatch(/payments\.charge/)
  })
})

describe('orphaned runs', () => {
  it('are marked failed at boot, while runs the manager still owns are left alone', async () => {
    const config = RunConfig.parse({ scenarioIds: ['latte-simple'], roles: MOCK_ROLES })
    const orphan = await store.runs.create(config, { owner: 'dead-server-process' })
    createdRuns.push(orphan.id)
    await store.runs.setStatus(orphan.id, 'running', { startedAt: Date.now() })
    const finished = await store.runs.create(config, { owner: 'dead-server-process' })
    createdRuns.push(finished.id)
    await store.runs.setStatus(finished.id, 'finished', { finishedAt: Date.now() })
    // a run with no owner is being driven by the CLI or a test in another process: not ours to reap
    const foreign = await store.runs.create(config)
    createdRuns.push(foreign.id)
    await store.runs.setStatus(foreign.id, 'running', { startedAt: Date.now() })

    const runs = new RunManager(store, false)
    const reaped = await runs.reapOrphans()
    expect(reaped).toContain(orphan.id)
    expect(reaped).not.toContain(finished.id)
    expect(reaped).not.toContain(foreign.id)
    expect((await store.runs.get(foreign.id))?.status).toBe('running')
    const row = await store.runs.get(orphan.id)
    expect(row?.status).toBe('failed')
    expect(row?.error).toMatch(/interrupted/)
    expect((await store.runs.get(finished.id))?.status).toBe('finished')
  })
})
