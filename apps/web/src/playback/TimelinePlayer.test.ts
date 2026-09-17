import { CafeEvent, type CafeEventInput } from '@cafe/protocol'
import { describe, expect, it } from 'vitest'
import { TimelinePlayer } from './TimelinePlayer.js'

function stream(inputs: Array<[number, CafeEventInput]>): CafeEvent[] {
  return inputs.map(([t, input], i) =>
    CafeEvent.parse({ ...input, id: `e${i}`, runId: 'r', seq: i, t }),
  )
}
const T0 = 1_000_000
const tx = 'tx1'
const recorded = () =>
  stream([
    [
      T0,
      {
        type: 'run.started',
        config: {
          name: 'x',
          scenarioIds: ['a'],
          roles: {
            cashier: 'mock:cashier',
            barista: 'mock:barista',
            manager: 'mock:manager',
            judge: 'mock:judge',
          },
          staffing: { cashiers: 1, baristas: 1 },
          chaos: { toolErrorRate: 0, toolLatencyMs: 0, agentCrashRate: 0, crashRoles: [], seed: 1 },
          budget: {
            maxStepsPerAgent: 12,
            maxTokensPerAgent: 1,
            maxUsdPerRun: 1,
            agentTimeoutMs: 1,
          },
          arrivalGapMs: 0,
          judgeEnabled: false,
          triageEnabled: false,
          mockPacing: { llmStepMs: [0, 0], toolMs: [0, 0], hangOrders: [], hangMs: 0 },
        },
      },
    ],
    [
      T0,
      {
        type: 'agent.spawned',
        agentId: 'cashier-1',
        role: 'cashier',
        name: 'Juniper',
        modelSpec: 'mock:cashier',
        station: 'register_1',
        sprite: 'cashier_a',
      },
    ],
    [
      T0,
      {
        type: 'agent.spawned',
        agentId: 'barista-1',
        role: 'barista',
        name: 'Hazel',
        modelSpec: 'mock:barista',
        station: 'espresso_1',
        sprite: 'barista_a',
      },
    ],
    [
      T0 + 100,
      {
        type: 'customer.arrived',
        txId: tx,
        customerId: 'c1',
        name: 'Priya',
        scenarioId: 'latte-simple',
        sprite: 'customer_a',
        utterance: 'latte',
      },
    ],
    [T0 + 100, { type: 'customer.moved', txId: tx, customerId: 'c1', to: 'register_1' }],
    [
      T0 + 1200,
      { type: 'agent.thinking', txId: tx, agentId: 'cashier-1', role: 'cashier', step: 1 },
    ],
    [
      T0 + 2200,
      {
        type: 'agent.tool_called',
        txId: tx,
        agentId: 'cashier-1',
        role: 'cashier',
        callId: 'k1',
        tool: 'menu.lookup',
        args: {},
      },
    ],
    [
      T0 + 2205,
      {
        type: 'agent.tool_returned',
        txId: tx,
        agentId: 'cashier-1',
        role: 'cashier',
        callId: 'k1',
        tool: 'menu.lookup',
        ok: true,
        latencyMs: 5,
      },
    ],
    [
      T0 + 2206,
      {
        type: 'model.usage',
        txId: tx,
        agentId: 'cashier-1',
        role: 'cashier',
        modelSpec: 'mock:cashier',
        step: 1,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: 0,
        latencyMs: 1000,
      },
    ],
    [
      T0 + 4000,
      {
        type: 'order.created',
        txId: tx,
        orderId: 'o1',
        customerId: 'c1',
        cashierId: 'cashier-1',
        items: [],
        totalCents: 0,
      },
    ],
    [T0 + 4100, { type: 'order.queued', txId: tx, orderId: 'o1', position: 1 }],
    [T0 + 4200, { type: 'agent.idle', txId: tx, agentId: 'cashier-1', role: 'cashier' }],
    [
      T0 + 44_200,
      { type: 'order.claimed', txId: tx, orderId: 'o1', baristaId: 'barista-1', waitedMs: 40_100 },
    ], // 40s hang on the rail
    [T0 + 46_000, { type: 'order.ready', txId: tx, orderId: 'o1', baristaId: 'barista-1' }],
    [T0 + 46_400, { type: 'order.delivered', txId: tx, orderId: 'o1' }],
    [T0 + 47_000, { type: 'customer.left', txId: tx, customerId: 'c1', outcome: 'served' }],
  ])

describe('TimelinePlayer', () => {
  it('replay advances the virtual clock at the chosen speed and applies in order', () => {
    const p = new TimelinePlayer()
    const applied: string[] = []
    p.subscribe({ onApply: (e) => applied.push(e.type) })
    p.setMode('replay')
    p.ingest(recorded())
    p.markComplete()
    p.play()
    p.tick(0)
    p.tick(1000) // 1s visual -> events up to T0+1000 (5 events)
    expect(p.position.cursor).toBe(5)
    p.setOptions({ speed: 10 })
    p.tick(1000)
    p.tick(1500) // +5s visual -> up to T0+6000 (12 events)
    expect(p.position.cursor).toBe(12)
    expect(applied.at(-1)).toBe('agent.idle')
    expect(p.state.queue).toEqual(['o1'])
    expect(p.state.agents['cashier-1']?.busy).toBe(false)
    expect(p.state.agents['cashier-1']?.workDurations).toEqual([3000])
  })

  it('step mode pauses on beats, exposes deltas, and steps back by rebuilding', () => {
    const p = new TimelinePlayer()
    const snaps: number[] = []
    p.subscribe({ onSnap: (s) => snaps.push(s.applied.length) })
    p.setMode('step')
    p.ingest(recorded())
    p.markComplete()
    expect(p.playing).toBe(false)
    p.stepForward() // run.started, spawned x2, customer.arrived (beat)
    expect(p.position.lastEvent?.type).toBe('customer.arrived')
    p.stepForward() // moved, thinking, tool_called + trailing returned/usage
    expect(p.position.lastEvent?.type).toBe('model.usage')
    expect(p.state.agents['cashier-1']?.toolCalls[0]?.ok).toBe(true)
    expect(p.position.deltaMs).toBe(1)
    p.stepForward() // order.created is not a beat -> continues to order.queued
    expect(p.position.lastEvent?.type).toBe('order.queued')
    p.stepForward() // agent.idle is not a beat -> order.claimed
    expect(p.position.lastEvent?.type).toBe('order.claimed')
    expect(p.position.deltaMs).toBe(40_000)
    p.stepBack()
    expect(p.position.lastEvent?.type).toBe('order.queued')
    expect(snaps.at(-1)).toBe(11)
    expect(p.state.queue).toEqual(['o1'])
  })

  it("director's cut clamps the 40s hang and stretches sub-100ms steps", () => {
    const p = new TimelinePlayer()
    p.setMode('directors-cut')
    p.setOptions({ cut: { scale: 1, minVisibleGapMs: 700, maxGapMs: 4000 } })
    p.ingest(recorded())
    p.markComplete()
    // real: tool_called (seq 6) -> order.created (seq 9, same tx) is 1.8s; visual keeps it (<= max)
    expect((p.visualTimeOf(9) ?? 0) - (p.visualTimeOf(6) ?? 0)).toBeCloseTo(1800, 0)
    // real: order.created -> order.queued is 100ms; both paced beats of the same tx -> stretched to 700ms
    expect((p.visualTimeOf(10) ?? 0) - (p.visualTimeOf(9) ?? 0)).toBe(700)
    // real: queued -> claimed 40.1s; visual: <= 4s (plus agent.idle in between)
    const vQueued = p.visualTimeOf(10) ?? 0
    const vClaimed = p.visualTimeOf(12) ?? 0
    expect(vClaimed - vQueued).toBeLessThanOrEqual(4000 + 700)
    expect(vClaimed - vQueued).toBeGreaterThanOrEqual(4000)
    // total visual length far shorter than 47s real
    expect(p.visualEnd()).toBeLessThan(20_000)
    expect(p.position.realTotalMs).toBe(47_000)
    // playing through applies everything
    p.play()
    p.tick(0)
    p.tick(p.visualEnd() + 1)
    expect(p.position.atEnd).toBe(true)
    expect(p.state.customers.c1?.outcome).toBe('served')
  })

  it('seek rebuilds state at a point in time and snaps', () => {
    const p = new TimelinePlayer()
    let snapped = 0
    p.subscribe({ onSnap: () => snapped++ })
    p.setMode('replay')
    p.ingest(recorded())
    p.markComplete()
    p.seek(4150)
    expect(p.position.lastEvent?.type).toBe('order.queued')
    expect(p.state.queue).toEqual(['o1'])
    expect(snapped).toBe(1)
    p.seek(0)
    expect(p.position.cursor).toBe(3) // the three t=T0 events
    p.seekToSeq(13)
    expect(p.state.orders.o1?.status).toBe('ready')
  })

  it('live-raw applies on ingest; live-buffered holds events back by the buffer', () => {
    const raw = new TimelinePlayer()
    raw.setMode('live-raw')
    raw.ingest(recorded().slice(0, 5))
    expect(raw.position.cursor).toBe(5)

    const buf = new TimelinePlayer()
    buf.setMode('live-buffered')
    buf.setOptions({ bufferMs: 2000 })
    const now = Date.now()
    const fresh = recorded().map((e) => ({ ...e, t: e.t - T0 + now })) // as if happening right now
    buf.ingest(fresh.slice(0, 6))
    buf.tick(0)
    // nothing older than 2s yet
    expect(buf.position.cursor).toBe(0)
    const older = recorded().map((e) => ({ ...e, t: e.t - T0 + now - 3000 })) // 3s ago
    const buf2 = new TimelinePlayer()
    buf2.setMode('live-buffered')
    buf2.setOptions({ bufferMs: 2000 })
    buf2.ingest(older.slice(0, 6))
    buf2.tick(0)
    expect(buf2.position.cursor).toBe(5) // events at <= now-2000: T0..T0+100 (5 events); thinking at +1200 is too fresh
  })

  it('dedupes by seq and switches modes without losing position', () => {
    const p = new TimelinePlayer()
    p.setMode('replay')
    const evs = recorded()
    p.ingest(evs.slice(0, 8))
    p.ingest(evs.slice(4)) // overlap
    expect(p.events.length).toBe(evs.length)
    p.seek(2300)
    const cursor = p.position.cursor
    p.setMode('directors-cut')
    expect(p.position.cursor).toBe(cursor)
    p.setMode('step')
    expect(p.position.cursor).toBe(cursor)
    expect(p.playing).toBe(false)
  })
})
