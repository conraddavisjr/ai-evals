import type {
  CafeEvent,
  JudgeAnswers,
  OrderItem,
  OrderStatus,
  Role,
  RunConfig,
  RunMetrics,
  RunStatus,
} from '@cafe/protocol'
import { and, asc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { Db } from './client.js'
import * as s from './schema.js'

/**
 * CafeStore is the only way the rest of the system touches persistence.
 * Today there is one Postgres implementation; adding DynamoDB/Mongo later means
 * implementing (part of) this interface, not touching tools or agents.
 */
export interface CafeStore {
  runs: RunsStore
  events: EventsStore
  menu: MenuStore
  customers: CustomersStore
  inventory: InventoryStore
  orders: OrdersStore
  payments: PaymentsStore
  drinks: DrinksStore
  usage: UsageStore
  judgements: JudgementsStore
  incidents: IncidentsStore
  metrics: MetricsStore
}

export type RunRow = typeof s.runs.$inferSelect
export type OrderRow = typeof s.orders.$inferSelect
export type MenuItemRow = typeof s.menuItems.$inferSelect
export type RecipeRow = typeof s.recipes.$inferSelect
export type CustomerRow = typeof s.customers.$inferSelect
export type InventoryRow = typeof s.inventory.$inferSelect & {
  name: string
  unit: string
  reorderLevel: number
}

export interface RunsStore {
  create(config: RunConfig, id?: string): Promise<RunRow>
  get(id: string): Promise<RunRow | null>
  list(limit?: number): Promise<RunRow[]>
  setStatus(
    id: string,
    status: RunStatus,
    patch?: { startedAt?: number; finishedAt?: number; error?: string },
  ): Promise<void>
  delete(id: string): Promise<void>
}

export interface EventsStore {
  append(event: CafeEvent): Promise<void>
  appendMany(events: CafeEvent[]): Promise<void>
  list(runId: string, opts?: { afterSeq?: number; txId?: string }): Promise<CafeEvent[]>
}

export interface MenuStore {
  list(): Promise<MenuItemRow[]>
  get(id: string): Promise<MenuItemRow | null>
  search(query: string): Promise<MenuItemRow[]>
  recipe(menuItemId: string): Promise<RecipeRow | null>
}

export interface CustomersStore {
  byLoyaltyId(id: string): Promise<CustomerRow | null>
  byName(name: string): Promise<CustomerRow[]>
  addPoints(loyaltyId: string, points: number): Promise<void>
}

export interface InventoryStore {
  initForRun(runId: string): Promise<void>
  list(runId: string): Promise<InventoryRow[]>
  check(runId: string, skus: string[]): Promise<Record<string, number>>
  /** Atomically consume; rejects the whole batch if any sku is short. */
  consume(
    runId: string,
    lines: Array<{ sku: string; qty: number }>,
  ): Promise<Record<string, number>>
  restock(runId: string, sku: string, qty: number): Promise<number>
}

export interface OrdersStore {
  create(input: {
    runId: string
    txId: string
    customerId: string
    customerName: string
    cashierId: string
    now: number
  }): Promise<OrderRow>
  get(id: string): Promise<OrderRow | null>
  addItem(orderId: string, item: OrderItem): Promise<OrderRow>
  removeItem(orderId: string, index: number): Promise<OrderRow>
  setStatus(
    orderId: string,
    status: OrderStatus,
    patch?: Partial<Pick<OrderRow, 'failReason' | 'baristaId'>>,
  ): Promise<OrderRow>
  enqueue(orderId: string, now: number): Promise<{ order: OrderRow; position: number }>
  /** FIFO claim with row locking so several baristas never grab the same ticket. */
  claimNext(runId: string, baristaId: string, now: number): Promise<OrderRow | null>
  requeue(orderId: string, reason: string): Promise<OrderRow>
  markReady(orderId: string, now: number): Promise<OrderRow>
  markDelivered(orderId: string, now: number): Promise<OrderRow>
  fail(orderId: string, reason: string): Promise<OrderRow>
  queue(runId: string): Promise<OrderRow[]>
  listByRun(runId: string): Promise<OrderRow[]>
  byTx(runId: string, txId: string): Promise<OrderRow | null>
}

export interface PaymentsStore {
  charge(input: {
    runId: string
    orderId: string
    amountCents: number
    method: string
    now: number
  }): Promise<{ id: string }>
  forOrder(orderId: string): Promise<Array<typeof s.payments.$inferSelect>>
}

export interface DrinksStore {
  log(input: {
    runId: string
    orderId: string
    baristaId: string
    menuItemId: string
    size: string
    modifiers: string[]
    now: number
  }): Promise<{ id: string }>
  forRun(runId: string): Promise<Array<typeof s.drinksMade.$inferSelect>>
}

export interface UsageStore {
  record(input: {
    runId: string
    txId?: string | undefined
    agentId: string
    role: Role
    modelSpec: string
    step: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    latencyMs: number
    now: number
  }): Promise<void>
  totalCostUsd(runId: string): Promise<number>
  forRun(runId: string): Promise<Array<typeof s.modelUsage.$inferSelect>>
}

export interface JudgementsStore {
  record(input: {
    runId: string
    txId: string
    orderId: string | null
    judgeSpec: string
    answers: JudgeAnswers
    blindedTranscript: string
    latencyMs: number
    now: number
  }): Promise<void>
  forRun(runId: string): Promise<Array<typeof s.judgements.$inferSelect>>
}

export interface IncidentsStore {
  record(input: {
    runId: string
    txId?: string | undefined
    agentId?: string | undefined
    kind: string
    message: string
    now: number
  }): Promise<void>
  forRun(runId: string): Promise<Array<typeof s.incidents.$inferSelect>>
}

export interface MetricsStore {
  save(runId: string, metrics: RunMetrics, now: number): Promise<void>
  get(runId: string): Promise<RunMetrics | null>
}

export class InsufficientInventoryError extends Error {
  constructor(readonly shortages: Array<{ sku: string; needed: number; onHand: number }>) {
    super(
      `Insufficient inventory: ${shortages.map((x) => `${x.sku} (need ${x.needed}, have ${x.onHand})`).join(', ')}`,
    )
  }
}

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found`)
  }
}

const totalOf = (items: OrderItem[]) => items.reduce((n, i) => n + i.unitPriceCents * i.quantity, 0)

export function createPgStore(db: Db): CafeStore {
  const one = <T>(rows: T[]): T | null => rows[0] ?? null
  const must = <T>(row: T | null, what: string, id: string): T => {
    if (!row) throw new NotFoundError(what, id)
    return row
  }

  const runs: RunsStore = {
    async create(config, id = ulid()) {
      const [row] = await db
        .insert(s.runs)
        .values({ id, status: 'pending', config, createdAt: Date.now() })
        .returning()
      return must(row ?? null, 'run', id)
    },
    get: async (id) => one(await db.select().from(s.runs).where(eq(s.runs.id, id))),
    list: async (limit = 50) =>
      db.select().from(s.runs).orderBy(sql`${s.runs.createdAt} desc`).limit(limit),
    async setStatus(id, status, patch = {}) {
      await db
        .update(s.runs)
        .set({ status, ...patch })
        .where(eq(s.runs.id, id))
    },
    async delete(id) {
      await db.delete(s.runs).where(eq(s.runs.id, id))
    },
  }

  const toEventRow = (e: CafeEvent) => ({
    id: e.id,
    runId: e.runId,
    seq: e.seq,
    t: e.t,
    txId: e.txId ?? null,
    type: e.type,
    payload: e,
  })
  const events: EventsStore = {
    async append(e) {
      await db.insert(s.events).values(toEventRow(e))
    },
    async appendMany(es) {
      if (es.length === 0) return
      await db.insert(s.events).values(es.map(toEventRow))
    },
    async list(runId, opts = {}) {
      const conds = [eq(s.events.runId, runId)]
      if (opts.afterSeq !== undefined) conds.push(gt(s.events.seq, opts.afterSeq))
      if (opts.txId !== undefined) conds.push(eq(s.events.txId, opts.txId))
      const rows = await db
        .select({ payload: s.events.payload })
        .from(s.events)
        .where(and(...conds))
        .orderBy(asc(s.events.seq))
      return rows.map((r) => r.payload as CafeEvent)
    },
  }

  const menu: MenuStore = {
    list: () =>
      db.select().from(s.menuItems).orderBy(asc(s.menuItems.category), asc(s.menuItems.name)),
    get: async (id) => one(await db.select().from(s.menuItems).where(eq(s.menuItems.id, id))),
    search: (q) =>
      db
        .select()
        .from(s.menuItems)
        .where(
          or(
            ilike(s.menuItems.name, `%${q}%`),
            ilike(s.menuItems.description, `%${q}%`),
            ilike(s.menuItems.id, `%${q}%`),
          ),
        )
        .orderBy(asc(s.menuItems.name)),
    recipe: async (menuItemId) =>
      one(await db.select().from(s.recipes).where(eq(s.recipes.menuItemId, menuItemId))),
  }

  const customers: CustomersStore = {
    byLoyaltyId: async (id) =>
      one(await db.select().from(s.customers).where(eq(s.customers.loyaltyId, id))),
    byName: (name) =>
      db
        .select()
        .from(s.customers)
        .where(ilike(s.customers.name, `%${name}%`)),
    async addPoints(loyaltyId, points) {
      await db
        .update(s.customers)
        .set({ points: sql`${s.customers.points} + ${points}` })
        .where(eq(s.customers.loyaltyId, loyaltyId))
    },
  }

  const inventory: InventoryStore = {
    async initForRun(runId) {
      const defaults = await db.select().from(s.ingredients)
      if (defaults.length === 0) return
      await db
        .insert(s.inventory)
        .values(defaults.map((d) => ({ runId, sku: d.sku, quantity: d.defaultQty })))
        .onConflictDoNothing()
    },
    async list(runId) {
      const rows = await db
        .select({
          runId: s.inventory.runId,
          sku: s.inventory.sku,
          quantity: s.inventory.quantity,
          name: s.ingredients.name,
          unit: s.ingredients.unit,
          reorderLevel: s.ingredients.reorderLevel,
        })
        .from(s.inventory)
        .innerJoin(s.ingredients, eq(s.ingredients.sku, s.inventory.sku))
        .where(eq(s.inventory.runId, runId))
        .orderBy(asc(s.inventory.sku))
      return rows
    },
    async check(runId, skus) {
      if (skus.length === 0) return {}
      const rows = await db
        .select()
        .from(s.inventory)
        .where(and(eq(s.inventory.runId, runId), inArray(s.inventory.sku, skus)))
      const out: Record<string, number> = {}
      for (const sku of skus) out[sku] = 0
      for (const r of rows) out[r.sku] = r.quantity
      return out
    },
    async consume(runId, lines) {
      return db.transaction(async (tx) => {
        const skus = lines.map((l) => l.sku)
        const rows = await tx
          .select()
          .from(s.inventory)
          .where(and(eq(s.inventory.runId, runId), inArray(s.inventory.sku, skus)))
          .for('update')
        const onHand = new Map(rows.map((r) => [r.sku, r.quantity]))
        const shortages = lines
          .map((l) => ({ sku: l.sku, needed: l.qty, onHand: onHand.get(l.sku) ?? 0 }))
          .filter((x) => x.onHand < x.needed)
        if (shortages.length > 0) throw new InsufficientInventoryError(shortages)
        const remaining: Record<string, number> = {}
        for (const l of lines) {
          const next = (onHand.get(l.sku) ?? 0) - l.qty
          await tx
            .update(s.inventory)
            .set({ quantity: next })
            .where(and(eq(s.inventory.runId, runId), eq(s.inventory.sku, l.sku)))
          remaining[l.sku] = next
        }
        return remaining
      })
    },
    async restock(runId, sku, qty) {
      const [row] = await db
        .update(s.inventory)
        .set({ quantity: sql`${s.inventory.quantity} + ${qty}` })
        .where(and(eq(s.inventory.runId, runId), eq(s.inventory.sku, sku)))
        .returning({ quantity: s.inventory.quantity })
      return must(row ?? null, 'inventory sku', sku).quantity
    },
  }

  const getOrder = async (id: string) =>
    one(await db.select().from(s.orders).where(eq(s.orders.id, id)))
  const patchOrder = async (id: string, patch: Partial<typeof s.orders.$inferInsert>) => {
    const [row] = await db.update(s.orders).set(patch).where(eq(s.orders.id, id)).returning()
    return must(row ?? null, 'order', id)
  }

  const orders: OrdersStore = {
    async create({ runId, txId, customerId, customerName, cashierId, now }) {
      const id = ulid()
      const [row] = await db
        .insert(s.orders)
        .values({
          id,
          runId,
          txId,
          customerId,
          customerName,
          cashierId,
          status: 'open',
          items: [],
          totalCents: 0,
          createdAt: now,
        })
        .returning()
      return must(row ?? null, 'order', id)
    },
    get: getOrder,
    async addItem(orderId, item) {
      const cur = must(await getOrder(orderId), 'order', orderId)
      if (cur.status !== 'open')
        throw new Error(`order ${orderId} is ${cur.status}; items can only be added while open`)
      const items = [...cur.items, item]
      return patchOrder(orderId, { items, totalCents: totalOf(items) })
    },
    async removeItem(orderId, index) {
      const cur = must(await getOrder(orderId), 'order', orderId)
      if (cur.status !== 'open')
        throw new Error(`order ${orderId} is ${cur.status}; items can only be removed while open`)
      const items = cur.items.filter((_, i) => i !== index)
      return patchOrder(orderId, { items, totalCents: totalOf(items) })
    },
    setStatus: (orderId, status, patch = {}) => patchOrder(orderId, { status, ...patch }),
    async enqueue(orderId, now) {
      const cur = must(await getOrder(orderId), 'order', orderId)
      if (cur.status !== 'paid')
        throw new Error(`order ${orderId} must be paid before it is queued (status: ${cur.status})`)
      if (cur.items.length === 0) throw new Error(`order ${orderId} has no items`)
      const order = await patchOrder(orderId, {
        status: 'queued',
        queuedAt: now,
        attempts: cur.attempts + 1,
      })
      const ahead = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.orders)
        .where(
          and(
            eq(s.orders.runId, cur.runId),
            eq(s.orders.status, 'queued'),
            sql`${s.orders.queuedAt} <= ${now}`,
          ),
        )
      return { order, position: ahead[0]?.n ?? 1 }
    },
    async claimNext(runId, baristaId, now) {
      return db.transaction(async (tx) => {
        const [next] = await tx
          .select()
          .from(s.orders)
          .where(and(eq(s.orders.runId, runId), eq(s.orders.status, 'queued')))
          .orderBy(asc(s.orders.queuedAt), asc(s.orders.createdAt))
          .limit(1)
          .for('update', { skipLocked: true })
        if (!next) return null
        const [row] = await tx
          .update(s.orders)
          .set({ status: 'claimed', baristaId, claimedAt: now })
          .where(eq(s.orders.id, next.id))
          .returning()
        return row ?? null
      })
    },
    async requeue(orderId, reason) {
      const [row] = await db
        .update(s.orders)
        .set({
          status: 'queued',
          baristaId: null,
          claimedAt: null,
          failReason: reason,
          attempts: sql`${s.orders.attempts} + 1`,
        })
        .where(eq(s.orders.id, orderId))
        .returning()
      return must(row ?? null, 'order', orderId)
    },
    markReady: (orderId, now) => patchOrder(orderId, { status: 'ready', readyAt: now }),
    markDelivered: (orderId, now) => patchOrder(orderId, { status: 'delivered', deliveredAt: now }),
    fail: (orderId, reason) => patchOrder(orderId, { status: 'failed', failReason: reason }),
    queue: (runId) =>
      db
        .select()
        .from(s.orders)
        .where(and(eq(s.orders.runId, runId), eq(s.orders.status, 'queued')))
        .orderBy(asc(s.orders.queuedAt)),
    listByRun: (runId) =>
      db.select().from(s.orders).where(eq(s.orders.runId, runId)).orderBy(asc(s.orders.createdAt)),
    byTx: async (runId, txId) =>
      one(
        await db
          .select()
          .from(s.orders)
          .where(and(eq(s.orders.runId, runId), eq(s.orders.txId, txId))),
      ),
  }

  const payments: PaymentsStore = {
    async charge({ runId, orderId, amountCents, method, now }) {
      const id = ulid()
      await db
        .insert(s.payments)
        .values({ id, runId, orderId, amountCents, method, createdAt: now })
      return { id }
    },
    forOrder: (orderId) => db.select().from(s.payments).where(eq(s.payments.orderId, orderId)),
  }

  const drinks: DrinksStore = {
    async log({ runId, orderId, baristaId, menuItemId, size, modifiers, now }) {
      const id = ulid()
      await db
        .insert(s.drinksMade)
        .values({ id, runId, orderId, baristaId, menuItemId, size, modifiers, madeAt: now })
      return { id }
    },
    forRun: (runId) => db.select().from(s.drinksMade).where(eq(s.drinksMade.runId, runId)),
  }

  const usage: UsageStore = {
    async record(u) {
      await db.insert(s.modelUsage).values({
        id: ulid(),
        runId: u.runId,
        txId: u.txId ?? null,
        agentId: u.agentId,
        role: u.role,
        modelSpec: u.modelSpec,
        step: u.step,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        costUsd: u.costUsd,
        latencyMs: u.latencyMs,
        at: u.now,
      })
    },
    async totalCostUsd(runId) {
      const [row] = await db
        .select({ c: sql<number>`coalesce(sum(${s.modelUsage.costUsd}), 0)::float8` })
        .from(s.modelUsage)
        .where(eq(s.modelUsage.runId, runId))
      return row?.c ?? 0
    },
    forRun: (runId) =>
      db
        .select()
        .from(s.modelUsage)
        .where(eq(s.modelUsage.runId, runId))
        .orderBy(asc(s.modelUsage.at)),
  }

  const judgements: JudgementsStore = {
    async record(j) {
      await db.insert(s.judgements).values({
        id: ulid(),
        runId: j.runId,
        txId: j.txId,
        orderId: j.orderId,
        judgeSpec: j.judgeSpec,
        answers: j.answers,
        blindedTranscript: j.blindedTranscript,
        latencyMs: j.latencyMs,
        at: j.now,
      })
    },
    forRun: (runId) => db.select().from(s.judgements).where(eq(s.judgements.runId, runId)),
  }

  const incidents: IncidentsStore = {
    async record(i) {
      await db.insert(s.incidents).values({
        id: ulid(),
        runId: i.runId,
        txId: i.txId ?? null,
        agentId: i.agentId ?? null,
        kind: i.kind,
        message: i.message,
        at: i.now,
      })
    },
    forRun: (runId) =>
      db
        .select()
        .from(s.incidents)
        .where(eq(s.incidents.runId, runId))
        .orderBy(asc(s.incidents.at)),
  }

  const metrics: MetricsStore = {
    async save(runId, m, now) {
      await db
        .insert(s.runMetrics)
        .values({ runId, metrics: m, computedAt: now })
        .onConflictDoUpdate({ target: s.runMetrics.runId, set: { metrics: m, computedAt: now } })
    },
    get: async (runId) =>
      one(await db.select().from(s.runMetrics).where(eq(s.runMetrics.runId, runId)))?.metrics ??
      null,
  }

  return {
    runs,
    events,
    menu,
    customers,
    inventory,
    orders,
    payments,
    drinks,
    usage,
    judgements,
    incidents,
    metrics,
  }
}
