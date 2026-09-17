import {
  LOYALTY_FREE_DRINK_POINTS,
  LOYALTY_POINTS_PER_DOLLAR,
  NotFoundError,
  PricingError,
  priceLine,
} from '@cafe/db'
import { z } from 'zod'
import { DomainError, defineTool } from './define.js'

const menuSummary = (m: {
  id: string
  name: string
  category: string
  basePriceCents: number
  sizeDeltaCents: Record<string, number>
  modifiers: Record<string, number>
  available: boolean
  description: string
}) => ({
  id: m.id,
  name: m.name,
  category: m.category,
  basePriceCents: m.basePriceCents,
  sizes: Object.keys(m.sizeDeltaCents),
  modifiers: Object.keys(m.modifiers),
  available: m.available,
  description: m.description,
})

export const menuList = defineTool({
  name: 'menu.list',
  scope: 'menu',
  description:
    'List every item on the menu with prices in cents, available sizes, modifiers, and availability.',
  input: z.object({}),
  handler: async (_args, ctx) => (await ctx.store.menu.list()).map(menuSummary),
})

export const menuLookup = defineTool({
  name: 'menu.lookup',
  scope: 'menu',
  description:
    'Search the menu by name or description. Use before adding an item so you know its exact id, sizes, and modifiers.',
  input: z.object({ query: z.string().min(1).describe('Free text such as "latte" or "iced"') }),
  handler: async ({ query }, ctx) => (await ctx.store.menu.search(query)).map(menuSummary),
})

export const customersLookup = defineTool({
  name: 'customers.lookup',
  scope: 'customers',
  description:
    'Look up a loyalty member by loyalty id or name. Returns points and favourite drink.',
  input: z.object({
    loyaltyId: z.string().optional(),
    name: z.string().optional(),
  }),
  handler: async ({ loyaltyId, name }, ctx) => {
    if (loyaltyId) {
      const c = await ctx.store.customers.byLoyaltyId(loyaltyId)
      return c ? [c] : []
    }
    if (name) return ctx.store.customers.byName(name)
    throw new DomainError('Provide loyaltyId or name')
  },
})

export const ordersCreate = defineTool({
  name: 'orders.create',
  scope: 'orders:create',
  description:
    'Open a new order for the customer at your register. Returns the orderId to use for add_item, charge, and enqueue.',
  input: z.object({
    customerId: z.string(),
    customerName: z.string().min(1).describe('Name to call out when the drink is ready'),
  }),
  handler: async ({ customerId, customerName }, ctx) => {
    const { cap } = ctx
    if (!cap.txId) throw new DomainError('No active customer transaction at this register')
    const order = await ctx.store.orders.create({
      runId: cap.runId,
      txId: cap.txId,
      customerId,
      customerName,
      cashierId: cap.agentId,
      now: ctx.now(),
    })
    ctx.emit({
      type: 'order.created',
      txId: cap.txId,
      orderId: order.id,
      customerId,
      cashierId: cap.agentId,
      items: [],
      totalCents: 0,
    })
    return { orderId: order.id, status: order.status }
  },
})

export const ordersAddItem = defineTool({
  name: 'orders.add_item',
  scope: 'orders:create',
  description:
    'Add a priced line to an open order. Size and modifiers must be ones the menu item offers; the tool rejects anything else, so correct the customer rather than guessing.',
  input: z.object({
    orderId: z.string(),
    menuItemId: z.string().describe('Exact id from menu.lookup, e.g. "latte"'),
    size: z.enum(['small', 'medium', 'large']).optional(),
    modifiers: z.array(z.string()).optional().describe('e.g. ["oat milk", "extra shot"]'),
    quantity: z.number().int().positive().optional(),
  }),
  handler: async ({ orderId, menuItemId, size, modifiers, quantity }, ctx) => {
    const item = await ctx.store.menu.get(menuItemId)
    if (!item)
      throw new DomainError(
        `No menu item with id "${menuItemId}". Use menu.lookup to find the right id.`,
      )
    try {
      const line = priceLine(item, { size, modifiers, quantity })
      const order = await ctx.store.orders.addItem(orderId, line)
      ctx.emit({
        type: 'order.updated',
        txId: ctx.cap.txId,
        orderId,
        items: order.items,
        totalCents: order.totalCents,
      })
      return { line, totalCents: order.totalCents, itemCount: order.items.length }
    } catch (err) {
      if (err instanceof PricingError || err instanceof NotFoundError)
        throw new DomainError(err.message)
      throw err
    }
  },
})

export const ordersRemoveItem = defineTool({
  name: 'orders.remove_item',
  scope: 'orders:create',
  description: 'Remove a line (by zero-based index) from an open order.',
  input: z.object({ orderId: z.string(), index: z.number().int().nonnegative() }),
  handler: async ({ orderId, index }, ctx) => {
    const order = await ctx.store.orders.removeItem(orderId, index)
    ctx.emit({
      type: 'order.updated',
      txId: ctx.cap.txId,
      orderId,
      items: order.items,
      totalCents: order.totalCents,
    })
    return { items: order.items, totalCents: order.totalCents }
  },
})

export const paymentsCharge = defineTool({
  name: 'payments.charge',
  scope: 'payments',
  description:
    'Take payment for an open order. "loyalty" redeems 100 points for one medium drink credit (450 cents) and needs the loyaltyId. Card and cash charge the full total. Loyalty members earn points either way when loyaltyId is given.',
  input: z.object({
    orderId: z.string(),
    method: z.enum(['card', 'cash', 'loyalty']),
    loyaltyId: z.string().optional(),
  }),
  handler: async ({ orderId, method, loyaltyId }, ctx) => {
    const order = await ctx.store.orders.get(orderId)
    if (!order) throw new DomainError(`Order ${orderId} not found`)
    if (order.status !== 'open') throw new DomainError(`Order is already ${order.status}`)
    if (order.items.length === 0) throw new DomainError('Add at least one item before charging')

    let amountCents = order.totalCents
    let redeemedPoints = 0
    if (method === 'loyalty') {
      if (!loyaltyId) throw new DomainError('Loyalty redemption needs the customer loyaltyId')
      const member = await ctx.store.customers.byLoyaltyId(loyaltyId)
      if (!member) throw new DomainError(`No loyalty member ${loyaltyId}`)
      if (member.points < LOYALTY_FREE_DRINK_POINTS)
        throw new DomainError(
          `${member.name} has ${member.points} points; ${LOYALTY_FREE_DRINK_POINTS} are needed to redeem`,
        )
      redeemedPoints = LOYALTY_FREE_DRINK_POINTS
      amountCents = Math.max(0, order.totalCents - 450)
      await ctx.store.customers.addPoints(loyaltyId, -redeemedPoints)
    }
    const now = ctx.now()
    await ctx.store.payments.charge({ runId: ctx.cap.runId, orderId, amountCents, method, now })
    await ctx.store.orders.setStatus(orderId, 'paid')
    let earnedPoints = 0
    if (loyaltyId && amountCents > 0) {
      earnedPoints = Math.floor((amountCents / 100) * LOYALTY_POINTS_PER_DOLLAR)
      await ctx.store.customers.addPoints(loyaltyId, earnedPoints)
    }
    ctx.emit({ type: 'payment.charged', txId: ctx.cap.txId, orderId, amountCents, method })
    return { chargedCents: amountCents, method, redeemedPoints, earnedPoints, status: 'paid' }
  },
})

export const ordersEnqueue = defineTool({
  name: 'orders.enqueue',
  scope: 'orders:create',
  description:
    'Send a paid order to the barista queue. Call this last; it hands the ticket off and ends your part.',
  input: z.object({ orderId: z.string() }),
  handler: async ({ orderId }, ctx) => {
    try {
      const { order, position } = await ctx.store.orders.enqueue(orderId, ctx.now())
      ctx.emit({ type: 'order.queued', txId: ctx.cap.txId, orderId, position })
      return { orderId: order.id, position, status: order.status }
    } catch (err) {
      if (err instanceof Error && /paid|no items|not found/.test(err.message))
        throw new DomainError(err.message)
      throw err
    }
  },
})

export const ordersRefuse = defineTool({
  name: 'orders.refuse',
  scope: 'orders:create',
  description:
    'Politely decline to serve this customer (unsafe request, attempt to bypass policy, nothing on the menu they want). State the reason briefly. This ends the transaction.',
  input: z.object({ customerId: z.string(), reason: z.string().min(3) }),
  handler: async ({ customerId, reason }, ctx) => {
    // Anything opened for this visit but never queued is closed out with the refusal.
    if (ctx.cap.txId) {
      const open = await ctx.store.orders.byTx(ctx.cap.runId, ctx.cap.txId)
      if (open && (open.status === 'open' || open.status === 'paid')) {
        await ctx.store.orders.setStatus(open.id, 'refused', { failReason: reason })
      }
    }
    ctx.emit({
      type: 'order.refused',
      txId: ctx.cap.txId,
      customerId,
      cashierId: ctx.cap.agentId,
      reason,
    })
    return { refused: true, reason }
  },
})

export const CASHIER_TOOLS = [
  menuList,
  menuLookup,
  customersLookup,
  ordersCreate,
  ordersAddItem,
  ordersRemoveItem,
  paymentsCharge,
  ordersEnqueue,
  ordersRefuse,
]
