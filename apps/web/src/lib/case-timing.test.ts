import { CafeEvent, type CafeEventInput } from '@cafe/protocol'
import { describe, expect, it } from 'vitest'
import { caseTiming, timingGroup } from './case-timing.js'

const stream = (inputs: Array<[number, CafeEventInput]>): CafeEvent[] =>
  inputs.map(([t, input], i) => CafeEvent.parse({ ...input, id: `e${i}`, runId: 'r', seq: i, t }))

const a1 = { agentId: 'cashier-1', role: 'cashier' } as const
const a2 = { agentId: 'barista-1', role: 'barista' } as const
const usage = (agent: typeof a1 | typeof a2, latencyMs: number): CafeEventInput => ({
  type: 'model.usage',
  txId: 't',
  ...agent,
  modelSpec: 'mock:x',
  step: 1,
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0,
  latencyMs,
})
const ret = (
  agent: typeof a1 | typeof a2,
  callId: string,
  tool: string,
  latencyMs: number,
  ok = true,
): CafeEventInput => ({
  type: 'agent.tool_returned',
  txId: 't',
  ...agent,
  callId,
  tool,
  ok,
  latencyMs,
  ...(ok ? { result: null } : { error: 'nope' }),
})

describe('case timing', () => {
  it('adds each agent’s model and tool time, the wait for agent 2 and the evaluation calls', () => {
    const t = caseTiming(
      stream([
        [
          0,
          {
            type: 'customer.arrived',
            txId: 't',
            customerId: 'c',
            name: 'x',
            scenarioId: 's',
            sprite: 'a',
            utterance: 'hi',
          },
        ],
        [
          10,
          {
            type: 'triage.decided',
            txId: 't',
            customerId: 'c',
            intent: 'order',
            escalate: false,
            escalateProbability: 0.1,
            modelSpec: 'mock:m',
            latencyMs: 5,
          },
        ],
        [20, usage(a1, 900)],
        [30, ret(a1, 'k1', 'menu.lookup', 12)],
        [40, ret(a1, 'k2', 'orders.create', 8, false)],
        [
          50,
          {
            type: 'order.claimed',
            txId: 't',
            orderId: 'o',
            baristaId: 'barista-1',
            waitedMs: 1800,
          },
        ],
        [60, usage(a2, 400)],
        [70, ret(a2, 'k3', 'orders.call_out', 20)],
        [80, { type: 'customer.left', txId: 't', customerId: 'c', outcome: 'served' }],
      ]),
      't',
    )
    expect(t.totalMs).toBe(80)
    expect(t.rows.map((r) => [r.step, r.ms])).toEqual([
      ['router', 5],
      ['agent 1 (cashier 1)', 920],
      ['waiting for agent 2', 1800],
      ['agent 2 (barista 1)', 420],
    ])
    const agent1 = t.rows[1]
    expect(agent1?.detail).toBe('1 step · 2 tool calls')
    expect(agent1?.tools).toEqual([
      { tool: 'menu.lookup', ms: 12, ok: true },
      { tool: 'orders.create', ms: 8, ok: false },
    ])
    expect(agent1 && timingGroup(agent1)).toBe('agent 1 (cashier)')
  })

  it('ignores other cases and leaves the total open until the case closes', () => {
    const t = caseTiming(stream([[0, usage(a1, 100)]]), 'other')
    expect(t.rows).toEqual([])
    expect(t.totalMs).toBeNull()
  })
})
