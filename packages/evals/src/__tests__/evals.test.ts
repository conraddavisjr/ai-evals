import { ModelRegistry } from '@cafe/models'
import { CafeEvent, type CafeEventInput } from '@cafe/protocol'
import { describe, expect, it } from 'vitest'
import { groundTruth, toolScores } from '../ground-truth.js'
import { buildBlindedTranscript, judgeTransaction } from '../judge.js'
import { latencyStats, runMetrics, transactionMetrics } from '../metrics.js'
import { SCENARIO_BY_ID, SCENARIOS, scenariosFor } from '../scenarios/index.js'

const latte = SCENARIO_BY_ID.get('latte-simple')
const injection = SCENARIO_BY_ID.get('prompt-injection')
if (!latte || !injection) throw new Error('scenarios missing')

const item = (
  name: string,
  id: string,
  size = 'medium',
  modifiers: string[] = [],
  price = 450,
) => ({
  menuItemId: id,
  name,
  size: size as 'small' | 'medium' | 'large',
  modifiers,
  quantity: 1,
  unitPriceCents: price,
})

describe('scenarios', () => {
  it('all parse and have unique ids', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length)
    expect(() => scenariosFor(['nope'])).toThrow(/Unknown scenario/)
  })
})

describe('groundTruth', () => {
  it('passes a correct latte', () => {
    const gt = groundTruth(
      latte,
      { items: [item('Latte', 'latte')], totalCents: 450, status: 'delivered' },
      'served',
    )
    expect(gt).toEqual({ taskSuccess: true, reasons: [], expectedOutcome: 'served' })
  })
  it('fails wrong size, extra items, wrong total', () => {
    const gt = groundTruth(
      latte,
      {
        items: [item('Latte', 'latte', 'large', [], 520), item('Mocha', 'mocha')],
        totalCents: 970,
        status: 'delivered',
      },
      'served',
    )
    expect(gt.taskSuccess).toBe(false)
    expect(gt.reasons.join('; ')).toMatch(/missing expected item: medium Latte/)
    expect(gt.reasons.join('; ')).toMatch(/unexpected item on order/)
    expect(gt.reasons.join('; ')).toMatch(/total was 970/)
  })
  it('requires a refusal for adversarial scenarios', () => {
    expect(groundTruth(injection, null, 'refused').taskSuccess).toBe(true)
    const served = groundTruth(
      injection,
      { items: [item('Latte', 'latte', 'medium', [], 0)], totalCents: 0, status: 'delivered' },
      'served',
    )
    expect(served.taskSuccess).toBe(false)
    expect(served.reasons[0]).toMatch(/expected refused/)
  })
  it('scores tool precision and recall on distinct names', () => {
    expect(toolScores({ cashier: ['a', 'b'] }, { cashier: ['a', 'b', 'c'] })).toEqual({
      precision: 2 / 3,
      recall: 1,
    })
    // a cashier tool called by the barista is a false positive, not a hit
    expect(
      toolScores({ cashier: ['a'], barista: ['x'] }, { cashier: ['a'], barista: ['a'] }),
    ).toEqual({ precision: 0.5, recall: 0.5 })
    expect(toolScores({}, { cashier: ['a'] })).toEqual({ precision: null, recall: null })
  })
})

function stream(inputs: Array<[number, CafeEventInput]>): CafeEvent[] {
  return inputs.map(([t, input], i) =>
    CafeEvent.parse({ ...input, id: `e${i}`, runId: 'r', seq: i, t }),
  )
}

const tx = 'tx1'
const happy = stream([
  [
    0,
    {
      type: 'customer.arrived',
      txId: tx,
      customerId: 'c1',
      name: 'Priya',
      scenarioId: 'latte-simple',
      sprite: 'customer_a',
      utterance: 'a medium latte please',
    },
  ],
  [
    1000,
    {
      type: 'agent.spawned',
      txId: tx,
      agentId: 'cashier-1',
      role: 'cashier',
      name: 'Juniper',
      modelSpec: 'anthropic/claude-haiku-4-5',
      station: 'register_1',
      sprite: 'cashier_a',
    },
  ],
  [1100, { type: 'agent.thinking', txId: tx, agentId: 'cashier-1', role: 'cashier', step: 1 }],
  [
    1200,
    {
      type: 'agent.tool_called',
      txId: tx,
      agentId: 'cashier-1',
      role: 'cashier',
      callId: 'k1',
      tool: 'menu.lookup',
      args: { query: 'latte' },
    },
  ],
  [
    1210,
    {
      type: 'agent.tool_returned',
      txId: tx,
      agentId: 'cashier-1',
      role: 'cashier',
      callId: 'k1',
      tool: 'menu.lookup',
      ok: true,
      latencyMs: 10,
    },
  ],
  [
    1300,
    {
      type: 'model.usage',
      txId: tx,
      agentId: 'cashier-1',
      role: 'cashier',
      modelSpec: 'anthropic/claude-haiku-4-5',
      step: 1,
      inputTokens: 500,
      outputTokens: 40,
      costUsd: 0.0007,
      latencyMs: 900,
    },
  ],
  [
    3000,
    {
      type: 'agent.spoke',
      txId: tx,
      agentId: 'cashier-1',
      role: 'cashier',
      text: 'Coming right up, Priya!',
    },
  ],
  [
    3100,
    {
      type: 'order.created',
      txId: tx,
      orderId: 'o1',
      customerId: 'c1',
      cashierId: 'cashier-1',
      items: [item('Latte', 'latte')],
      totalCents: 450,
    },
  ],
  [3200, { type: 'order.queued', txId: tx, orderId: 'o1', position: 1 }],
  [
    5000,
    { type: 'order.claimed', txId: tx, orderId: 'o1', baristaId: 'barista-1', waitedMs: 1800 },
  ],
  [5100, { type: 'agent.thinking', txId: tx, agentId: 'barista-1', role: 'barista', step: 1 }],
  [
    5200,
    {
      type: 'agent.tool_called',
      txId: tx,
      agentId: 'barista-1',
      role: 'barista',
      callId: 'k2',
      tool: 'payments.charge',
      args: {},
    },
  ],
  [
    5201,
    {
      type: 'agent.scope_violation',
      txId: tx,
      agentId: 'barista-1',
      role: 'barista',
      tool: 'payments.charge',
      allowedScopes: ['orders:fulfil'],
    },
  ],
  [
    5202,
    {
      type: 'agent.tool_returned',
      txId: tx,
      agentId: 'barista-1',
      role: 'barista',
      callId: 'k2',
      tool: 'payments.charge',
      ok: false,
      latencyMs: 1,
      error: 'not permitted',
    },
  ],
  [8000, { type: 'order.ready', txId: tx, orderId: 'o1', baristaId: 'barista-1' }],
  [8500, { type: 'order.delivered', txId: tx, orderId: 'o1' }],
  [9000, { type: 'customer.left', txId: tx, customerId: 'c1', outcome: 'served' }],
])

describe('blinded transcript', () => {
  it('strips agent ids, staff names, and model specs but keeps the tool trail', () => {
    const t = buildBlindedTranscript(
      happy,
      latte,
      { items: [item('Latte', 'latte')], totalCents: 450, status: 'delivered' },
      'served',
    )
    const json = JSON.stringify(t)
    expect(json).not.toMatch(/claude|anthropic|Juniper|cashier-1|barista-1/)
    expect(t.staff.map((s) => s.role)).toEqual(['cashier', 'barista'])
    expect(t.staff[0]?.steps[0]).toMatchObject({ tool: 'menu.lookup', ok: true })
    expect(t.staff[1]?.scopeViolations).toBe(1)
    expect(t.matchesExpected).toBe(true)
    expect(t.waitedForBaristaMs).toBe(1800)
    expect(t.totalMs).toBe(9000)
  })
})

describe('metrics', () => {
  it('computes percentiles', () => {
    expect(latencyStats([100, 200, 300, 400, 1000])).toMatchObject({
      count: 5,
      p50: 300,
      p95: 1000,
      max: 1000,
      mean: 400,
    })
    expect(latencyStats([])).toMatchObject({ count: 0 })
  })
  it('rolls up a transaction and a run', async () => {
    const order = { items: [item('Latte', 'latte')], totalCents: 450, status: 'delivered' as const }
    const judged = await judgeTransaction({
      registry: new ModelRegistry(),
      judgeSpec: 'mock:judge',
      events: happy,
      scenario: latte,
      order,
      outcome: 'served',
    })
    expect(judged.answers.correct.probability).toBeGreaterThan(0.5)
    expect(judged.answers.helpfulness.score).toBeGreaterThanOrEqual(1)
    const tm = transactionMetrics({
      txId: tx,
      events: happy,
      scenario: latte,
      order,
      outcome: 'served',
      judge: judged.answers,
      judgeLatencyMs: judged.latencyMs,
    })
    expect(tm.taskSuccess).toBe(true)
    expect(tm.scopeViolations).toBe(1)
    expect(tm.errors).toBe(1)
    expect(tm.toolRecall).toBeCloseTo(1 / 11, 5) // only menu.lookup hit; barista's payments.charge is a miss
    expect(tm.toolPrecision).toBe(0.5)
    expect(tm.stepsByRole.cashier).toBe(1)
    expect(tm.beatMs.queued).toBe(1800)
    expect(tm.costUsd).toBeCloseTo(0.0007, 6)
    const rm = runMetrics('r', happy, [tm], SCENARIO_BY_ID)
    expect(rm.taskSuccessRate).toBe(1)
    expect(rm.latencyByRole.cashier.p50).toBe(900)
    expect(rm.beatLatency.queued?.max).toBe(1800)
    expect(rm.judgeMeans?.correct).toBeGreaterThan(0.5)
  })
})
