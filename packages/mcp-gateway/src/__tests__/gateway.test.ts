import { type CafeStore, createDb, createPgStore, runMigrations, seedCatalog } from '@cafe/db'
import { type CafeEventInput, RunConfig } from '@cafe/protocol'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Gateway } from '../gateway.js'
import { createMcpServer } from '../mcp-server.js'
import { resolveIngredients } from '../tools/barista.js'

const { db, close } = createDb()
let store: CafeStore
let runId: string
let events: CafeEventInput[] = []
const emit = (e: CafeEventInput) => {
  events.push(e)
}

beforeAll(async () => {
  await runMigrations(db)
  await seedCatalog(db)
  store = createPgStore(db)
  const run = await store.runs.create(
    RunConfig.parse({
      scenarioIds: ['x'],
      roles: { cashier: 'mock:c', barista: 'mock:b', manager: 'mock:m', judge: 'mock:j' },
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

const gw = () => new Gateway({ store, emit, sleep: async () => {} })

describe('scopes', () => {
  it('advertises only the role slice', () => {
    const g = gw()
    const cashier = g.capability({ agentId: 'c1', role: 'cashier', runId })
    const barista = g.capability({ agentId: 'b1', role: 'barista', runId })
    const names = (c: typeof cashier) => g.toolsFor(c).map((t) => t.name)
    expect(names(cashier)).toContain('payments.charge')
    expect(names(cashier)).not.toContain('orders.claim_next')
    expect(names(barista)).toContain('orders.claim_next')
    expect(names(barista)).not.toContain('payments.charge')
    expect(names(g.capability({ agentId: 'j', role: 'judge', runId }))).toEqual([])
  })

  it('rejects out-of-scope calls and emits a scope_violation', async () => {
    const g = gw()
    const barista = g.capability({ agentId: 'b1', role: 'barista', runId, txId: 'tx-scope' })
    const res = await g.call(barista, 'payments.charge', { orderId: 'nope', method: 'card' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('scope')
    const types = events.map((e) => e.type)
    expect(types).toEqual(['agent.tool_called', 'agent.scope_violation', 'agent.tool_returned'])
  })

  it('reports unknown tools and invalid args without touching the store', async () => {
    const g = gw()
    const cashier = g.capability({ agentId: 'c1', role: 'cashier', runId })
    const unknown = await g.call(cashier, 'orders.teleport', {})
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.code).toBe('unknown_tool')
    const bad = await g.call(cashier, 'orders.add_item', { orderId: 1 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe('invalid_args')
  })
})

describe('chaos', () => {
  it('injects deterministic transient failures from a seed', async () => {
    const mk = () =>
      new Gateway({ store, emit, sleep: async () => {}, chaos: { toolErrorRate: 0.5, seed: 7 } })
    const outcomes = async (g: Gateway) => {
      const cap = g.capability({ agentId: 'c1', role: 'cashier', runId })
      const out: boolean[] = []
      for (let i = 0; i < 12; i++) out.push((await g.call(cap, 'menu.list', {})).ok)
      return out
    }
    const a = await outcomes(mk())
    const b = await outcomes(mk())
    expect(a).toEqual(b)
    expect(a).toContain(false)
    expect(a).toContain(true)
  })

  it('adds latency through the injectable sleep', async () => {
    let slept = 0
    const g = new Gateway({
      store,
      emit,
      chaos: { toolLatencyMs: 250 },
      sleep: async (ms) => {
        slept += ms
      },
    })
    await g.call(g.capability({ agentId: 'c1', role: 'cashier', runId }), 'menu.list', {})
    expect(slept).toBe(250)
  })
})

describe('end-to-end tool flow', () => {
  it('cashier takes an order, barista makes and calls it out', async () => {
    const g = gw()
    const txId = 'tx-e2e'
    const cashier = g.capability({ agentId: 'cashier-1', role: 'cashier', runId, txId })
    const barista = g.capability({ agentId: 'barista-1', role: 'barista', runId })

    const call = async (cap: typeof cashier, tool: string, args: unknown) => {
      const r = await g.call(cap, tool, args)
      if (!r.ok) throw new Error(`${tool}: ${r.error}`)
      return r.result as Record<string, unknown>
    }

    const found = (await call(cashier, 'menu.lookup', { query: 'latte' })) as unknown as Array<{
      id: string
    }>
    expect(found.map((f) => f.id)).toContain('latte')
    const { orderId } = (await call(cashier, 'orders.create', {
      customerId: 'c-ada',
      customerName: 'Ada',
    })) as { orderId: string }
    const added = await call(cashier, 'orders.add_item', {
      orderId,
      menuItemId: 'latte',
      size: 'large',
      modifiers: ['oat milk'],
    })
    expect(added.totalCents).toBe(450 + 70 + 70)
    // bad modifier is a domain error, not a crash
    const bad = await g.call(cashier, 'orders.add_item', {
      orderId,
      menuItemId: 'latte',
      modifiers: ['whipped cream'],
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe('domain')
    // cannot enqueue before paying
    const early = await g.call(cashier, 'orders.enqueue', { orderId })
    expect(early.ok).toBe(false)
    const paid = await call(cashier, 'payments.charge', {
      orderId,
      method: 'card',
      loyaltyId: 'L-1001',
    })
    expect(paid.chargedCents).toBe(590)
    expect(paid.earnedPoints).toBe(11)
    const q = await call(cashier, 'orders.enqueue', { orderId })
    expect(q.position).toBe(1)

    // barista side
    const ticket = (await call(barista, 'orders.claim_next', {})) as {
      orderId: string
      customerName: string
      items: Array<{ menuItemId: string; size: string; modifiers: string[] }>
    }
    expect(ticket.orderId).toBe(orderId)
    const before = (await call(barista, 'inventory.check', {
      skus: ['oat_milk', 'whole_milk'],
    })) as Record<string, number>
    const item = ticket.items[0]
    if (!item) throw new Error('no item')
    await call(barista, 'inventory.consume', {
      menuItemId: item.menuItemId,
      size: item.size,
      modifiers: item.modifiers,
    })
    const after = (await call(barista, 'inventory.check', {
      skus: ['oat_milk', 'whole_milk'],
    })) as Record<string, number>
    expect(after.whole_milk).toBe(before.whole_milk) // swapped to oat
    expect(after.oat_milk).toBe((before.oat_milk ?? 0) - Math.round(240 * 1.3))
    await call(barista, 'drinks.log_made', {
      orderId,
      menuItemId: 'latte',
      size: 'large',
      modifiers: ['oat milk'],
    })
    // call_out before ready is refused
    expect((await g.call(barista, 'orders.call_out', { orderId })).ok).toBe(false)
    await call(barista, 'orders.mark_ready', { orderId })
    const done = await call(barista, 'orders.call_out', { orderId })
    expect(done.customerName).toBe('Ada')

    const final = await store.orders.get(orderId)
    expect(final?.status).toBe('delivered')
    expect((await store.drinks.forRun(runId)).some((d) => d.orderId === orderId)).toBe(true)

    const types = events.map((e) => e.type)
    for (const t of [
      'payment.charged',
      'order.queued',
      'order.claimed',
      'inventory.changed',
      'order.ready',
      'order.called_out',
      'order.delivered',
    ]) {
      expect(types).toContain(t)
    }
    // every tool call has a matching return with latency
    const calls = events.filter((e) => e.type === 'agent.tool_called').length
    const rets = events.filter((e) => e.type === 'agent.tool_returned')
    expect(rets.length).toBe(calls)
    for (const r of rets)
      if (r.type === 'agent.tool_returned') expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('refuses to make a drink the pantry cannot support', async () => {
    const g = gw()
    const barista = g.capability({ agentId: 'barista-1', role: 'barista', runId })
    const res = await g.call(barista, 'inventory.consume', { menuItemId: 'lavender_latte' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/lavender_syrup/)
  })
})

describe('resolveIngredients', () => {
  it('swaps milk, scales by size, and merges extra shots', () => {
    const base = [
      { sku: 'espresso_beans', qty: 18 },
      { sku: 'whole_milk', qty: 240 },
      { sku: 'cups', qty: 1 },
    ]
    const out = resolveIngredients(base, ['Oat Milk', 'extra shot'], 'small')
    expect(out).toEqual([
      { sku: 'espresso_beans', qty: 27 },
      { sku: 'oat_milk', qty: 180 },
      { sku: 'cups', qty: 1 },
    ])
  })
})

describe('MCP transport', () => {
  it('serves the slice to a real MCP client over an in-memory transport', async () => {
    const g = gw()
    const cap = g.capability({ agentId: 'cashier-mcp', role: 'cashier', runId, txId: 'tx-mcp' })
    const server = createMcpServer(g, cap)
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await server.connect(serverT)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientT)
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('menu.lookup')
    expect(names).not.toContain('orders.claim_next')
    const res = await client.callTool({ name: 'menu.lookup', arguments: { query: 'mocha' } })
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
    expect(JSON.parse(text)[0].id).toBe('mocha')
    await client.close()
    await server.close()
  })
})
