import { CafeEvent, type CafeEventInput } from '@cafe/protocol'
import { describe, expect, it } from 'vitest'
import { buildTrace } from './model.js'

function stream(inputs: Array<[number, CafeEventInput]>): CafeEvent[] {
  return inputs.map(([t, input], i) =>
    CafeEvent.parse({ ...input, id: `e${i}`, runId: 'r', seq: i, t }),
  )
}
const ref = { agentId: 'cashier-1', role: 'cashier' } as const

describe('trace model', () => {
  it('lays a visit out as bands with tool calls marked against the expected set', () => {
    const evs = stream([
      [
        0,
        {
          type: 'agent.spawned',
          agentId: 'barista-1',
          role: 'barista',
          name: 'Hazel',
          modelSpec: 'mock:barista',
          station: 'espresso_1',
          sprite: 'b',
        },
      ],
      [
        100,
        {
          type: 'customer.arrived',
          txId: 't1',
          customerId: 'c1',
          name: 'Priya',
          scenarioId: 'latte-simple',
          sprite: 'customer_a',
          utterance: 'a latte please',
          expected: {
            outcome: 'served',
            cashierTools: ['menu.lookup', 'orders.create'],
            baristaTools: ['orders.claim_next'],
            tags: ['happy'],
          },
        },
      ],
      [
        110,
        {
          type: 'triage.decided',
          txId: 't1',
          customerId: 'c1',
          intent: 'order',
          escalate: false,
          escalateProbability: 0.05,
          modelSpec: 'mock:manager',
          latencyMs: 3,
        },
      ],
      [120, { type: 'agent.thinking', txId: 't1', ...ref, step: 1 }],
      [
        130,
        {
          type: 'agent.tool_called',
          txId: 't1',
          ...ref,
          callId: 'k1',
          tool: 'menu.lookup',
          args: { query: 'latte' },
        },
      ],
      [
        140,
        {
          type: 'agent.tool_returned',
          txId: 't1',
          ...ref,
          callId: 'k1',
          tool: 'menu.lookup',
          ok: true,
          latencyMs: 10,
          result: {},
        },
      ],
      [
        150,
        {
          type: 'model.usage',
          txId: 't1',
          ...ref,
          modelSpec: 'mock:cashier',
          step: 1,
          inputTokens: 100,
          outputTokens: 10,
          costUsd: 0,
          latencyMs: 25,
        },
      ],
      [
        160,
        {
          type: 'agent.tool_called',
          txId: 't1',
          ...ref,
          callId: 'k2',
          tool: 'payments.charge',
          args: {},
        },
      ],
      [
        170,
        {
          type: 'agent.tool_returned',
          txId: 't1',
          ...ref,
          callId: 'k2',
          tool: 'payments.charge',
          ok: false,
          latencyMs: 2,
          error: 'nothing to charge',
        },
      ],
      // the barista works before its claim binds it to the visit
      [200, { type: 'agent.thinking', agentId: 'barista-1', role: 'barista', step: 1 }],
      [
        210,
        {
          type: 'agent.tool_called',
          agentId: 'barista-1',
          role: 'barista',
          callId: 'k3',
          tool: 'orders.claim_next',
          args: {},
        },
      ],
      [
        220,
        {
          type: 'agent.tool_returned',
          txId: 't1',
          agentId: 'barista-1',
          role: 'barista',
          callId: 'k3',
          tool: 'orders.claim_next',
          ok: true,
          latencyMs: 4,
          result: {},
        },
      ],
      [300, { type: 'customer.left', txId: 't1', customerId: 'c1', outcome: 'served' }],
      [
        310,
        {
          type: 'manager.reviewed',
          txId: 't1',
          customerId: 'c1',
          orderId: null,
          modelSpec: 'mock:manager',
          verdict: 'concern',
          issues: ['unrecovered_error'],
          summary: 'Concern: unrecovered error.',
          latencyMs: 5,
        },
      ],
    ])
    const m = buildTrace(evs)
    expect(m.shift.map((b) => b.head)).toEqual(['agent 2 (barista 1)'])
    expect(m.columns.length).toBe(1)
    const c = m.columns[0]
    expect(c?.name).toBe('Priya')
    expect(c?.expectedOutcome).toBe('served')
    expect(c?.outcome).toBe('served')
    expect(c?.bands.input.map((b) => b.head)).toEqual(['Priya', 'expect'])
    expect(c?.bands.orch.map((b) => [b.head, b.mark])).toEqual([
      ['triage', undefined],
      ['left', 'ok'],
    ])
    const work = c?.bands.work ?? []
    expect(work.map((b) => b.head)).toEqual([
      'agent 1 (cashier 1)',
      'menu.lookup',
      'payments.charge',
      'agent 2 (barista 1)',
      'orders.claim_next',
    ])
    // expected tool: ok; not expected: warn; failed: bad; step carries model latency
    expect(work[1]?.mark).toBe('ok')
    expect(work[1]?.latencyMs).toBe(10)
    expect(work[2]?.mark).toBe('bad')
    expect(work[0]?.latencyMs).toBe(25)
    expect(work[4]?.mark).toBe('ok')
    expect(c?.bands.eval[0]).toMatchObject({ head: 'review', mark: 'warn' })
  })
  it('gives every badge a stable unique key and names the tools a step called', () => {
    const evs = stream([
      [
        0,
        {
          type: 'customer.arrived',
          txId: 't',
          customerId: 'c',
          name: 'x',
          scenarioId: 's',
          sprite: 'customer_a',
          utterance: 'hi',
          expected: { outcome: 'served', cashierTools: [], baristaTools: [], tags: [] },
        },
      ],
      [1, { type: 'agent.thinking', txId: 't', ...ref, step: 1 }],
      [
        2,
        {
          type: 'agent.tool_called',
          txId: 't',
          ...ref,
          callId: 'a',
          tool: 'menu.lookup',
          args: {},
        },
      ],
      [
        3,
        {
          type: 'agent.tool_called',
          txId: 't',
          ...ref,
          callId: 'b',
          tool: 'orders.create',
          args: {},
        },
      ],
    ])
    const m = buildTrace(evs)
    const all = [...m.shift, ...(m.columns[0] ? Object.values(m.columns[0].bands).flat() : [])]
    // the arrival yields two badges (input and expectations) from one event
    expect(new Set(all.map((b) => b.key)).size).toBe(all.length)
    expect(m.columns[0]?.bands.work[0]?.text).toBe('step 1 → menu.lookup, orders.create')
    // and a rebuild keys them the same way
    expect(buildTrace(evs).columns[0]?.bands.input.map((b) => b.key)).toEqual(
      m.columns[0]?.bands.input.map((b) => b.key),
    )
  })
  it('marks tools unknown when the item carries no expectations (older runs)', () => {
    const evs = stream([
      [
        0,
        {
          type: 'customer.arrived',
          txId: 't',
          customerId: 'c',
          name: 'x',
          scenarioId: 's',
          sprite: 'customer_a',
          utterance: 'hi',
        },
      ],
      [
        1,
        {
          type: 'agent.tool_called',
          txId: 't',
          ...ref,
          callId: 'k',
          tool: 'menu.lookup',
          args: {},
        },
      ],
      [2, { type: 'customer.left', txId: 't', customerId: 'c', outcome: 'refused' }],
    ])
    const c = buildTrace(evs).columns[0]
    expect(c?.bands.work[0]?.mark).toBe('unknown')
    expect(c?.bands.orch.at(-1)?.mark).toBe('unknown')
    // the playhead needs to know when a case arrived and when its outcome became known
    expect(c?.startSeq).toBe(0)
    expect(c?.leftSeq).toBe(2)
  })
})
