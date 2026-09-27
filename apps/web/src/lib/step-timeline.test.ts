import { CafeEvent, type CafeEventInput } from '@cafe/protocol'
import { describe, expect, it } from 'vitest'
import { agentWork, caseTimeline } from './step-timeline.js'
import { targetMetrics } from './target-metrics.js'

const stream = (inputs: Array<[number, CafeEventInput]>): CafeEvent[] =>
  inputs.map(([t, input], i) => CafeEvent.parse({ ...input, id: `e${i}`, runId: 'r', seq: i, t }))

const arrive = (
  tx: string,
  tags: string[],
  outcome: 'served' | 'refused' = 'served',
): CafeEventInput => ({
  type: 'customer.arrived',
  txId: tx,
  customerId: `c-${tx}`,
  name: 'x',
  scenarioId: tx,
  title: tx,
  sprite: 'customer_a',
  utterance: 'hi',
  expected: { outcome, cashierTools: [], baristaTools: [], tags },
})
const usage = (
  tx: string,
  agentId: string,
  role: 'cashier' | 'barista',
  step: number,
  latencyMs: number,
  costUsd = 0,
): CafeEventInput => ({
  type: 'model.usage',
  txId: tx,
  agentId,
  role,
  modelSpec: 'app:claude-opus-5',
  step,
  inputTokens: 100,
  outputTokens: 50,
  costUsd,
  latencyMs,
})

const events = stream([
  [1000, arrive('a', ['benign'])],
  [
    1500,
    {
      type: 'triage.decided',
      txId: 'a',
      customerId: 'c-a',
      intent: 'request',
      escalate: false,
      escalateProbability: 0,
      modelSpec: 'app:haiku',
      latencyMs: 500,
    },
  ],
  [41_500, usage('a', 'cashier-1', 'cashier', 1, 40_000, 0.2)],
  [
    41_600,
    {
      type: 'agent.tool_returned',
      txId: 'a',
      agentId: 'cashier-1',
      role: 'cashier',
      callId: 'k',
      tool: 'orders.create',
      ok: true,
      latencyMs: 100,
    },
  ],
  [41_700, { type: 'order.queued', txId: 'a', orderId: 'o', position: 1 }],
  [
    42_700,
    { type: 'order.claimed', txId: 'a', orderId: 'o', baristaId: 'barista-1', waitedMs: 1000 },
  ],
  [47_700, usage('a', 'barista-1', 'barista', 1, 5000)],
  [48_000, { type: 'customer.left', txId: 'a', customerId: 'c-a', outcome: 'served' }],
  [
    51_000,
    {
      type: 'judge.verdict',
      txId: 'a',
      orderId: 'o',
      judgeSpec: 'anthropic/claude-sonnet-5',
      answers: { onlyRecipes: { probability: 0.9 }, cookable: { score: 4 } },
      latencyMs: 3000,
      questions: [{ id: 'onlyRecipes', type: 'boolean', instructions: 'Only recipes?' }],
    },
  ],
  [
    51_001,
    {
      type: 'case.scored',
      txId: 'a',
      customerId: 'c-a',
      passed: true,
      checks: [{ kind: 'outcome', label: 'outcome served', ok: true, detail: '' }],
      reason: null,
      detail: null,
    },
  ],
  [2000, arrive('b', ['benign', 'edge'])],
  [2100, { type: 'customer.left', txId: 'b', customerId: 'c-b', outcome: 'refused' }],
  [
    2101,
    {
      type: 'case.scored',
      txId: 'b',
      customerId: 'c-b',
      passed: false,
      checks: [{ kind: 'outcome', label: 'outcome served', ok: false, detail: 'got refused' }],
      reason: 'off_topic',
      detail: 'No.',
    },
  ],
])

describe('caseTimeline', () => {
  it('orders a case by when each step started, with its duration', () => {
    const t = caseTimeline(events, 'a')
    expect(t.totalMs).toBe(47_000)
    expect(t.steps.map((s) => [s.kind, s.atMs, s.durationMs])).toEqual([
      ['arrive', 0, null],
      ['router', 0, 500],
      ['model', 500, 40_000],
      ['tool', 40_500, 100],
      ['wait', 40_700, 1000],
      ['model', 41_700, 5000],
      ['result', 47_000, null],
      ['judge', 47_000, 3000],
      ['checks', 50_001, null],
    ])
    expect(t.steps.find((s) => s.kind === 'model')?.what).toBe(
      'step 1 · claude-opus-5 · 150 tokens',
    )
  })

  it('is empty for a case that has not arrived', () => {
    expect(caseTimeline(events, 'zzz')).toEqual({ steps: [], totalMs: null })
  })
})

describe('agentWork', () => {
  it('adds up an agent’s model and tool time, per case', () => {
    expect(agentWork(events, 'cashier-1')).toEqual({
      steps: 1,
      modelMs: 40_000,
      tools: 1,
      toolMs: 100,
      failedTools: 0,
      byCase: [{ txId: 'a', steps: 1, tools: 1, ms: 40_100 }],
    })
  })
})

describe('targetMetrics', () => {
  it('scores a target run from its events: rate, refusals, tags, judge means, spend', () => {
    const m = targetMetrics(events)
    expect(m).toMatchObject({
      cases: 2,
      scored: 2,
      passed: 1,
      falseRefusals: 1,
      missedRefusals: 0,
      costUsd: 0.2,
    })
    expect(m.byTag).toEqual([
      { tag: 'edge', cases: 1, passed: 0 },
      { tag: 'benign', cases: 2, passed: 1 },
    ])
    expect(m.failingChecks).toEqual([{ label: 'outcome served', count: 1 }])
    expect(m.judge).toEqual([
      { id: 'onlyRecipes', type: 'boolean', instructions: 'Only recipes?', mean: 0.9, n: 1 },
      { id: 'cookable', type: 'score', instructions: null, mean: 4, n: 1 },
    ])
    expect(m.rows.find((r) => r.txId === 'a')).toMatchObject({
      totalMs: 47_000,
      passed: true,
      costUsd: 0.2,
    })
  })
})

describe('caseTimeline while a step is running', () => {
  it('shows the open model step with its time so far', () => {
    const live = stream([
      [1000, arrive('x', [])],
      [1200, { type: 'agent.thinking', txId: 'x', agentId: 'cashier-1', role: 'cashier', step: 1 }],
    ])
    const t = caseTimeline(live, 'x', 5200)
    expect(t.steps.at(-1)).toMatchObject({
      kind: 'model',
      atMs: 200,
      durationMs: 4000,
      running: true,
    })
    // without a clock, nothing is invented
    expect(caseTimeline(live, 'x').steps).toHaveLength(1)
  })
})
