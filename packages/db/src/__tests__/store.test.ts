import { RunConfig } from '@cafe/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../client.js'
import { runMigrations } from '../migrate.js'
import { priceLine } from '../pricing.js'
import { seedCatalog } from '../seed.js'
import { type CafeStore, createPgStore, InsufficientInventoryError } from '../store.js'

const { db, close } = createDb()
let store: CafeStore
let runId: string
const now = () => Date.now()

const config = RunConfig.parse({
  scenarioIds: ['latte'],
  roles: {
    cashier: 'mock:cashier',
    barista: 'mock:barista',
    manager: 'mock:manager',
    judge: 'mock:judge',
  },
})

beforeAll(async () => {
  await runMigrations(db)
  await seedCatalog(db)
  store = createPgStore(db)
  const run = await store.runs.create(config)
  runId = run.id
  await store.inventory.initForRun(runId)
})

afterAll(async () => {
  await store.runs.delete(runId)
  await close()
})

describe('catalog', () => {
  it('searches the menu and prices a line with size and modifiers', async () => {
    const hits = await store.menu.search('latte')
    expect(hits.map((h) => h.id)).toContain('latte')
    const latte = await store.menu.get('latte')
    if (!latte) throw new Error('no latte')
    const line = priceLine(latte, { size: 'large', modifiers: ['Oat Milk', 'extra shot'] })
    expect(line.unitPriceCents).toBe(450 + 70 + 70 + 100)
    expect(() => priceLine(latte, { size: 'venti' })).toThrow(/size/)
    expect(() => priceLine(latte, { modifiers: ['whipped cream'] })).toThrow(/not an option/)
  })

  it('refuses unavailable items', async () => {
    const psl = await store.menu.get('pumpkin_latte')
    if (!psl) throw new Error('no psl')
    expect(() => priceLine(psl, {})).toThrow(/not available/)
  })

  it('finds loyalty customers', async () => {
    expect((await store.customers.byLoyaltyId('L-1001'))?.name).toBe('Ada Lovelace')
    expect((await store.customers.byName('hopper'))[0]?.loyaltyId).toBe('L-1002')
  })
})

describe('orders and the queue', () => {
  it('walks an order through the full lifecycle', async () => {
    const order = await store.orders.create({
      runId,
      txId: 'tx-1',
      customerId: 'c1',
      customerName: 'Ada',
      cashierId: 'cashier-1',
      now: now(),
    })
    const latte = await store.menu.get('latte')
    if (!latte) throw new Error('no latte')
    const withItem = await store.orders.addItem(order.id, priceLine(latte, {}))
    expect(withItem.totalCents).toBe(450)

    // cannot queue before paying
    await expect(store.orders.enqueue(order.id, now())).rejects.toThrow(/paid/)
    await store.payments.charge({
      runId,
      orderId: order.id,
      amountCents: 450,
      method: 'card',
      now: now(),
    })
    await store.orders.setStatus(order.id, 'paid')
    const { position } = await store.orders.enqueue(order.id, now())
    expect(position).toBe(1)

    const claimed = await store.orders.claimNext(runId, 'barista-1', now())
    expect(claimed?.id).toBe(order.id)
    expect(claimed?.status).toBe('claimed')
    // nothing else on the rail
    expect(await store.orders.claimNext(runId, 'barista-2', now())).toBeNull()

    await store.orders.markReady(order.id, now())
    const done = await store.orders.markDelivered(order.id, now())
    expect(done.status).toBe('delivered')
    expect(done.deliveredAt).not.toBeNull()
  })

  it('claims strictly FIFO and requeues on crash', async () => {
    const mk = async (tx: string, t: number) => {
      const o = await store.orders.create({
        runId,
        txId: tx,
        customerId: tx,
        customerName: tx,
        cashierId: 'cashier-1',
        now: t,
      })
      const drip = await store.menu.get('drip')
      if (!drip) throw new Error('no drip')
      await store.orders.addItem(o.id, priceLine(drip, {}))
      await store.orders.setStatus(o.id, 'paid')
      await store.orders.enqueue(o.id, t)
      return o.id
    }
    const t0 = now()
    const first = await mk('tx-fifo-1', t0)
    const second = await mk('tx-fifo-2', t0 + 10)
    expect((await store.orders.queue(runId)).map((o) => o.id)).toEqual([first, second])

    const c1 = await store.orders.claimNext(runId, 'barista-1', now())
    expect(c1?.id).toBe(first)
    // barista-1 crashes: ticket goes back to the front of the rail (keeps original queuedAt)
    await store.orders.requeue(first, 'barista crashed')
    const c2 = await store.orders.claimNext(runId, 'barista-2', now())
    expect(c2?.id).toBe(first)
    const c3 = await store.orders.claimNext(runId, 'barista-1', now())
    expect(c3?.id).toBe(second)
  })
})

describe('inventory', () => {
  it('consumes atomically and reports shortages', async () => {
    const before = await store.inventory.check(runId, ['espresso_beans', 'lavender_syrup'])
    expect(before.espresso_beans).toBe(2000)
    const after = await store.inventory.consume(runId, [{ sku: 'espresso_beans', qty: 18 }])
    expect(after.espresso_beans).toBe(1982)
    await expect(
      store.inventory.consume(runId, [
        { sku: 'espresso_beans', qty: 18 },
        { sku: 'lavender_syrup', qty: 25 },
      ]),
    ).rejects.toBeInstanceOf(InsufficientInventoryError)
    // whole batch rejected: beans untouched
    expect((await store.inventory.check(runId, ['espresso_beans'])).espresso_beans).toBe(1982)
    expect(await store.inventory.restock(runId, 'lavender_syrup', 500)).toBe(520)
  })
})

describe('events', () => {
  it('appends and lists in seq order, filtered by tx', async () => {
    const base = { runId, t: now() }
    await store.events.appendMany([
      {
        ...base,
        id: 'ev-2',
        seq: 2,
        txId: 'tx-1',
        type: 'customer.left',
        customerId: 'c1',
        outcome: 'served',
      },
      {
        ...base,
        id: 'ev-1',
        seq: 1,
        txId: 'tx-1',
        type: 'customer.arrived',
        customerId: 'c1',
        name: 'Ada',
        scenarioId: 'latte',
        sprite: 'customer_a',
        utterance: 'hi',
      },
      {
        ...base,
        id: 'ev-3',
        seq: 3,
        txId: 'tx-2',
        type: 'customer.arrived',
        customerId: 'c2',
        name: 'Bo',
        scenarioId: 'latte',
        sprite: 'customer_a',
        utterance: 'hi',
      },
    ])
    const all = await store.events.list(runId)
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3])
    expect((await store.events.list(runId, { txId: 'tx-1' })).map((e) => e.id)).toEqual([
      'ev-1',
      'ev-2',
    ])
    expect((await store.events.list(runId, { afterSeq: 2 })).map((e) => e.id)).toEqual(['ev-3'])
  })
})
