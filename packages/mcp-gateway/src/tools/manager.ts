import { z } from 'zod'
import { DomainError, defineTool } from './define.js'

export const ordersQueueStatus = defineTool({
  name: 'orders.queue_status',
  scope: 'orders:admin',
  description:
    'See every ticket on the rail with how long it has waited, plus tickets currently being made.',
  input: z.object({}),
  handler: async (_args, ctx) => {
    const now = ctx.now()
    const all = await ctx.store.orders.listByRun(ctx.cap.runId)
    return {
      queued: all
        .filter((o) => o.status === 'queued')
        .map((o) => ({
          orderId: o.id,
          customerName: o.customerName,
          waitedMs: o.queuedAt ? now - o.queuedAt : 0,
          attempts: o.attempts,
        })),
      inProgress: all
        .filter((o) => o.status === 'claimed')
        .map((o) => ({
          orderId: o.id,
          baristaId: o.baristaId,
          customerName: o.customerName,
          elapsedMs: o.claimedAt ? now - o.claimedAt : 0,
        })),
    }
  },
})

export const staffingList = defineTool({
  name: 'staffing.list',
  scope: 'staffing',
  description: 'List staff on shift, where they are, and whether they are busy.',
  input: z.object({}),
  handler: async (_args, ctx) => ctx.services.staffing?.list() ?? [],
})

export const staffingSpawnBarista = defineTool({
  name: 'staffing.spawn_barista',
  scope: 'staffing',
  description: 'Call in another barista to help with the queue.',
  input: z.object({}),
  handler: async (_args, ctx) => {
    if (!ctx.services.staffing)
      throw new DomainError('Staffing service unavailable in this context')
    return ctx.services.staffing.spawnBarista()
  },
})

export const ordersRequeue = defineTool({
  name: 'orders.requeue',
  scope: 'orders:admin',
  description: 'Put a stuck in-progress ticket back on the rail so another barista can take it.',
  input: z.object({ orderId: z.string(), reason: z.string() }),
  handler: async ({ orderId, reason }, ctx) => {
    const order = await ctx.store.orders.get(orderId)
    if (!order) throw new DomainError(`Order ${orderId} not found`)
    if (order.status !== 'claimed')
      throw new DomainError(`Only claimed orders can be requeued (status: ${order.status})`)
    await ctx.store.orders.requeue(orderId, reason)
    ctx.emit({ type: 'order.requeued', txId: order.txId, orderId, reason })
    return { orderId, status: 'queued' }
  },
})

export const inventoryRestock = defineTool({
  name: 'inventory.restock',
  scope: 'inventory:restock',
  description: 'Add stock for an ingredient sku from the back room.',
  input: z.object({ sku: z.string(), qty: z.number().positive() }),
  handler: async ({ sku, qty }, ctx) => {
    const remaining = await ctx.store.inventory.restock(ctx.cap.runId, sku, qty)
    ctx.emit({ type: 'inventory.changed', txId: ctx.cap.txId, sku, delta: qty, remaining })
    return { sku, remaining }
  },
})

export const incidentsLog = defineTool({
  name: 'incidents.log',
  scope: 'incidents',
  description: 'Write an incident note (customer complaint, staff problem, safety issue).',
  input: z.object({ kind: z.string(), message: z.string().min(3), agentId: z.string().optional() }),
  handler: async ({ kind, message, agentId }, ctx) => {
    await ctx.store.incidents.record({
      runId: ctx.cap.runId,
      txId: ctx.cap.txId,
      agentId,
      kind,
      message,
      now: ctx.now(),
    })
    return { logged: true }
  },
})

export const MANAGER_TOOLS = [
  ordersQueueStatus,
  staffingList,
  staffingSpawnBarista,
  ordersRequeue,
  inventoryRestock,
  incidentsLog,
]
