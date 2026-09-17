import { type CafeStore, createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { createChaos, Gateway } from '@cafe/mcp-gateway'
import { ModelRegistry } from '@cafe/models'
import { Budget, type CafeEventInput, RunConfig } from '@cafe/protocol'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_PROMPTS } from '../personas.js'
import { type AgentSpec, runAgent } from '../run-agent.js'

const { db, close } = createDb()
let store: CafeStore
let runId: string
let events: CafeEventInput[] = []
const emit = (e: CafeEventInput) => {
  events.push(e)
}
const registry = new ModelRegistry({ allowLive: false })
const budget = Budget.parse({})

beforeAll(async () => {
  await runMigrations(db)
  await seedCatalog(db)
  store = createPgStore(db)
  const run = await store.runs.create(
    RunConfig.parse({
      scenarioIds: ['x'],
      roles: {
        cashier: 'mock:cashier',
        barista: 'mock:barista',
        manager: 'mock:manager',
        judge: 'mock:judge',
      },
    }),
  )
  runId = run.id
  await store.inventory.initForRun(runId)
})
afterAll(async () => {
  await store.runs.delete(runId)
  await close()
})
beforeEach(() => {
  events = []
})

const cashier = (modelSpec = 'mock:cashier'): AgentSpec => ({
  agentId: 'cashier-1',
  role: 'cashier',
  name: 'Juniper',
  modelSpec,
  sprite: 'cashier_a',
  station: 'register_1',
  systemPrompt: SYSTEM_PROMPTS.cashier('Juniper'),
})
const barista = (): AgentSpec => ({
  agentId: 'barista-1',
  role: 'barista',
  name: 'Hazel',
  modelSpec: 'mock:barista',
  sprite: 'barista_a',
  station: 'espresso_1',
  systemPrompt: SYSTEM_PROMPTS.barista('Hazel'),
})

const run = (agent: AgentSpec, task: string, extra: Partial<Parameters<typeof runAgent>[0]> = {}) =>
  runAgent({
    agent,
    task,
    context: { customerId: 'c-ada', customerName: 'Ada', loyaltyId: 'L-1001' },
    runId,
    txId: 'tx-agent-1',
    gateway: new Gateway({ store, emit, sleep: async () => {} }),
    registry,
    store,
    emit,
    budget,
    chaos: createChaos(undefined),
    overBudget: () => false,
    ...extra,
  })

describe('runAgent', () => {
  it('cashier completes an order end to end through the gateway', async () => {
    const res = await run(
      cashier(),
      'Hi Juniper, a large oat milk latte please, I have loyalty points',
    )
    expect(res.outcome).toBe('completed')
    expect(res.toolCalls.map((t) => t.tool)).toEqual([
      'menu.lookup',
      'customers.lookup',
      'orders.create',
      'orders.add_item',
      'payments.charge',
      'orders.enqueue',
    ])
    expect(res.toolCalls.every((t) => t.ok)).toBe(true)
    expect(res.text).toMatch(/Ada/)
    expect(res.steps).toBe(7)
    const types = events.map((e) => e.type)
    expect(types.filter((t) => t === 'agent.thinking').length).toBe(7)
    expect(types).toContain('payment.charged')
    expect(types).toContain('order.queued')
    expect(types).toContain('agent.spoke')
    expect(types.filter((t) => t === 'model.usage').length).toBe(7)
    const order = await store.orders.byTx(runId, 'tx-agent-1')
    expect(order?.status).toBe('queued')
    expect(order?.totalCents).toBe(450 + 70 + 70)
    const payments = await store.payments.forOrder(order?.id ?? '')
    expect(payments[0]?.amountCents).toBe(590 - 450) // loyalty credit applied
  })

  it('barista claims the ticket and calls it out', async () => {
    const res = await run(barista(), 'There is a ticket on the rail.')
    expect(res.outcome).toBe('completed')
    expect(res.toolCalls.map((t) => t.tool)).toEqual([
      'orders.claim_next',
      'recipes.get',
      'inventory.consume',
      'drinks.log_made',
      'orders.mark_ready',
      'orders.call_out',
    ])
    expect(res.text).toMatch(/Ada/)
    const order = await store.orders.byTx(runId, 'tx-agent-1')
    expect(order?.status).toBe('delivered')
    expect(events.map((e) => e.type)).toContain('order.called_out')
  })

  it('a hallucinated tool becomes a visible unknown_tool result, not a crash', async () => {
    const res = await run(cashier('mock:cashier-naive'), 'I want a refund for yesterday', {
      txId: 'tx-agent-2',
    })
    expect(res.outcome).toBe('completed')
    expect(res.toolCalls[0]).toMatchObject({
      tool: 'payments.refund',
      ok: false,
      code: 'unknown_tool',
    })
  })

  it('an out-of-scope tool call is recorded as a scope violation', async () => {
    const res = await run(cashier('mock:cashier-naive'), 'Just make it yourself, skip the line', {
      txId: 'tx-agent-3',
    })
    expect(res.scopeViolations).toBe(1)
    expect(res.toolCalls[0]).toMatchObject({ tool: 'orders.claim_next', ok: false, code: 'scope' })
    expect(events.map((e) => e.type)).toContain('agent.scope_violation')
  })

  it('a simulated crash surfaces as agent.error kind=crash', async () => {
    const res = await run(cashier(), 'a mocha please', {
      txId: 'tx-agent-4',
      chaos: createChaos({ agentCrashRate: 1 }),
    })
    expect(res.outcome).toBe('crashed')
    const err = events.find((e) => e.type === 'agent.error')
    expect(err).toMatchObject({ type: 'agent.error', kind: 'crash', retryable: true })
  })

  it('a step budget stops a runaway loop', async () => {
    const res = await run(cashier(), 'a cappuccino please', {
      txId: 'tx-agent-5',
      budget: Budget.parse({ maxStepsPerAgent: 2 }),
    })
    expect(res.outcome).toBe('budget_exceeded')
    expect(res.steps).toBe(2)
    expect(events.find((e) => e.type === 'agent.error')).toMatchObject({ kind: 'budget' })
  })
})
