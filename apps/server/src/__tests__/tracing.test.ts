import { type CafeStore, createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { runTelemetry } from '@cafe/evals'
import { RunConfig } from '@cafe/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EventBus } from '../event-bus.js'
import { ShiftOrchestrator } from '../orchestrator.js'
import { initTracing, type Tracing } from '../telemetry/tracing.js'

const { db, close } = createDb()
let store: CafeStore
let tracing: Tracing
const createdRuns: string[] = []

beforeAll(async () => {
  await runMigrations(db)
  await seedCatalog(db)
  store = createPgStore(db)
  tracing = initTracing({ store })
})
afterAll(async () => {
  await tracing.shutdown()
  for (const id of createdRuns) await store.runs.delete(id)
  await close()
})

const INSTANT = {
  llmStepMs: [0, 0] as [number, number],
  toolMs: [0, 0] as [number, number],
  hangOrders: [],
  hangMs: 0,
}

describe('OpenTelemetry spans', () => {
  it('record a run > visit > turn > step > tool tree and feed the telemetry aggregate', async () => {
    const config = RunConfig.parse({
      scenarioIds: ['latte-simple', 'prompt-injection', 'two-items'],
      roles: {
        cashier: 'mock:cashier',
        barista: 'mock:barista',
        manager: 'mock:manager',
        judge: 'mock:judge',
      },
      staffing: { cashiers: 1, baristas: 1 },
      arrivalGapMs: 0,
      triageEnabled: true,
      mockPacing: INSTANT,
    })
    const run = await store.runs.create(config)
    createdRuns.push(run.id)
    const bus = new EventBus(run.id, store)
    await new ShiftOrchestrator({ store, bus, config, sleep: async () => {} }).run()
    await tracing.flush()

    const rows = await store.spans.forRun(run.id)
    const byId = new Map(rows.map((r) => [r.spanId, r]))
    const kinds = (k: string) => rows.filter((r) => r.kind === k)
    expect(kinds('run').length).toBe(1)
    expect(kinds('visit').length).toBe(3)
    expect(kinds('triage').length).toBe(3)
    expect(kinds('review').length).toBe(3)
    expect(kinds('judge').length).toBe(3)
    expect(kinds('tool').length).toBeGreaterThan(5)
    expect(kinds('step').length).toBeGreaterThan(5)
    // every span in the run carries the run id, even deep in the tree
    expect(rows.every((r) => r.runId === run.id)).toBe(true)
    // parenting: tool < step < agent.turn < (visit | run); evaluate() calls < visit
    for (const t of kinds('tool')) expect(byId.get(t.parentSpanId ?? '')?.kind).toBe('step')
    for (const st of kinds('step')) expect(byId.get(st.parentSpanId ?? '')?.kind).toBe('agent.turn')
    for (const turn of kinds('agent.turn')) {
      const parent = byId.get(turn.parentSpanId ?? '')
      expect(parent?.kind).toBe(turn.role === 'cashier' ? 'visit' : 'run')
    }
    for (const k of ['triage', 'review', 'judge'])
      for (const sp of kinds(k)) expect(byId.get(sp.parentSpanId ?? '')?.kind).toBe('visit')
    // a barista's claim binds its later tool spans to the visit
    const baristaTools = kinds('tool').filter((r) => r.role === 'barista')
    expect(baristaTools.some((r) => r.txId !== null)).toBe(true)
    // model calls carry cost and tokens; a mock model is free but still counted
    expect(kinds('step').every((r) => r.inputTokens !== null && r.costUsd !== null)).toBe(true)

    const metrics = await store.metrics.get(run.id)
    const tel = runTelemetry(run.id, rows, metrics)
    expect(tel.items.map((i) => i.scenarioId)).toEqual([
      'latte-simple',
      'prompt-injection',
      'two-items',
    ])
    expect(tel.items.every((i) => i.taskSuccess === true)).toBe(true)
    expect(tel.tools.map((t) => t.tool)).toContain('orders.create')
    for (const t of tel.tools) {
      expect(t.p99).toBeGreaterThanOrEqual(t.p95)
      expect(t.max).toBeGreaterThanOrEqual(t.p99)
    }
    expect(tel.steps.some((s) => s.role === 'cashier' && s.stepIndex === 1)).toBe(true)
    expect(tel.costTrajectory.length).toBe(3)
    expect(tel.costTrajectory[2]?.cumulativeUsd).toBe(0)
    expect(tel.spanCount).toBe(rows.length)
  })
})
