import { InsufficientInventoryError, MODIFIER_INGREDIENTS } from '@cafe/db'
import { z } from 'zod'
import { DomainError, defineTool } from './define.js'

const MILK_SKUS = new Set(['whole_milk'])

/** Apply modifiers to a recipe's ingredient list (milk swaps, extra shots, syrups). */
export function resolveIngredients(
  base: Array<{ sku: string; qty: number }>,
  modifiers: string[],
  size: string,
): Array<{ sku: string; qty: number }> {
  const sizeFactor = size === 'small' ? 0.75 : size === 'large' ? 1.3 : 1
  let lines = base.map((l) => ({
    sku: l.sku,
    qty: MILK_SKUS.has(l.sku) ? Math.round(l.qty * sizeFactor) : l.qty,
  }))
  for (const raw of modifiers) {
    const m = raw.trim().toLowerCase()
    const rule = MODIFIER_INGREDIENTS[m]
    if (!rule) continue
    if (rule.replaceMilkWith) {
      const swap = rule.replaceMilkWith
      lines = lines.map((l) => (MILK_SKUS.has(l.sku) ? { sku: swap, qty: l.qty } : l))
    }
    if (rule.add) lines = [...lines, ...rule.add]
  }
  // merge duplicates
  const merged = new Map<string, number>()
  for (const l of lines) merged.set(l.sku, (merged.get(l.sku) ?? 0) + l.qty)
  return [...merged].map(([sku, qty]) => ({ sku, qty }))
}

export const ordersClaimNext = defineTool({
  name: 'orders.claim_next',
  scope: 'orders:fulfil',
  description:
    'Take the next ticket off the rail (first in, first out). Returns null when the rail is empty.',
  input: z.object({}),
  handler: async (_args, ctx) => {
    const now = ctx.now()
    const order = await ctx.store.orders.claimNext(ctx.cap.runId, ctx.cap.agentId, now)
    if (!order) return null
    // From here on, everything this barista does is part of that customer's visit.
    ctx.cap.txId = order.txId
    ctx.emit({
      type: 'order.claimed',
      txId: order.txId,
      orderId: order.id,
      baristaId: ctx.cap.agentId,
      waitedMs: order.queuedAt ? now - order.queuedAt : 0,
    })
    return {
      orderId: order.id,
      txId: order.txId,
      customerName: order.customerName,
      items: order.items,
      attempts: order.attempts,
    }
  },
})

export const recipesGet = defineTool({
  name: 'recipes.get',
  scope: 'recipes',
  description:
    'Get the recipe for a menu item: ordered steps, base ingredients (for a medium), and prep time.',
  input: z.object({ menuItemId: z.string() }),
  handler: async ({ menuItemId }, ctx) => {
    const r = await ctx.store.menu.recipe(menuItemId)
    if (!r) throw new DomainError(`No recipe for "${menuItemId}"`)
    return r
  },
})

export const inventoryCheck = defineTool({
  name: 'inventory.check',
  scope: 'inventory',
  description: 'Check quantities on hand for the given ingredient skus.',
  input: z.object({ skus: z.array(z.string()).min(1) }),
  handler: ({ skus }, ctx) => ctx.store.inventory.check(ctx.cap.runId, skus),
})

export const inventoryConsume = defineTool({
  name: 'inventory.consume',
  scope: 'inventory',
  description:
    'Deduct ingredients for a drink you are making. Pass the menuItemId plus the size and modifiers from the ticket and the tool computes the exact lines. Fails atomically if anything is short.',
  input: z.object({
    menuItemId: z.string(),
    size: z.enum(['small', 'medium', 'large']).default('medium'),
    modifiers: z.array(z.string()).default([]),
    quantity: z.number().int().positive().default(1),
  }),
  handler: async ({ menuItemId, size, modifiers, quantity }, ctx) => {
    const recipe = await ctx.store.menu.recipe(menuItemId)
    if (!recipe) throw new DomainError(`No recipe for "${menuItemId}"`)
    const lines = resolveIngredients(recipe.ingredients, modifiers, size).map((l) => ({
      sku: l.sku,
      qty: l.qty * quantity,
    }))
    try {
      const remaining = await ctx.store.inventory.consume(ctx.cap.runId, lines)
      for (const l of lines) {
        ctx.emit({
          type: 'inventory.changed',
          txId: ctx.cap.txId,
          sku: l.sku,
          delta: -l.qty,
          remaining: remaining[l.sku] ?? 0,
        })
      }
      return { consumed: lines, remaining }
    } catch (err) {
      if (err instanceof InsufficientInventoryError) throw new DomainError(err.message)
      throw err
    }
  },
})

export const drinksLogMade = defineTool({
  name: 'drinks.log_made',
  scope: 'orders:fulfil',
  description: 'Record that you finished making one drink on the ticket. Call once per line item.',
  input: z.object({
    orderId: z.string(),
    menuItemId: z.string(),
    size: z.enum(['small', 'medium', 'large']).default('medium'),
    modifiers: z.array(z.string()).default([]),
  }),
  handler: async ({ orderId, menuItemId, size, modifiers }, ctx) => {
    const { id } = await ctx.store.drinks.log({
      runId: ctx.cap.runId,
      orderId,
      baristaId: ctx.cap.agentId,
      menuItemId,
      size,
      modifiers,
      now: ctx.now(),
    })
    return { drinkId: id }
  },
})

export const ordersMarkReady = defineTool({
  name: 'orders.mark_ready',
  scope: 'orders:fulfil',
  description: 'Mark the whole ticket ready once every drink is made.',
  input: z.object({ orderId: z.string() }),
  handler: async ({ orderId }, ctx) => {
    const order = await ctx.store.orders.get(orderId)
    if (!order) throw new DomainError(`Order ${orderId} not found`)
    if (order.status !== 'claimed')
      throw new DomainError(`Order is ${order.status}, not claimed by you`)
    if (order.baristaId !== ctx.cap.agentId)
      throw new DomainError('That ticket belongs to another barista')
    await ctx.store.orders.markReady(orderId, ctx.now())
    ctx.emit({ type: 'order.ready', txId: order.txId, orderId, baristaId: ctx.cap.agentId })
    return { orderId, status: 'ready' }
  },
})

export const ordersCallOut = defineTool({
  name: 'orders.call_out',
  scope: 'orders:fulfil',
  description:
    'Walk the drinks to the pickup counter and call the customer name. Completes the order.',
  input: z.object({ orderId: z.string() }),
  handler: async ({ orderId }, ctx) => {
    const order = await ctx.store.orders.get(orderId)
    if (!order) throw new DomainError(`Order ${orderId} not found`)
    if (order.status !== 'ready')
      throw new DomainError(`Order is ${order.status}; mark it ready first`)
    ctx.emit({
      type: 'order.called_out',
      txId: order.txId,
      orderId,
      baristaId: ctx.cap.agentId,
      customerName: order.customerName,
    })
    await ctx.store.orders.markDelivered(orderId, ctx.now())
    ctx.emit({ type: 'order.delivered', txId: order.txId, orderId })
    return { orderId, customerName: order.customerName, status: 'delivered' }
  },
})

export const BARISTA_TOOLS = [
  ordersClaimNext,
  recipesGet,
  inventoryCheck,
  inventoryConsume,
  drinksLogMade,
  ordersMarkReady,
  ordersCallOut,
]
