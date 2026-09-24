import { DomainError, defineTool, MANAGER_TOOLS, type ToolDef } from '@cafe/mcp-gateway'
import type { OrderItem } from '@cafe/protocol'
import { z } from 'zod'
import {
  ACCOUNTS,
  ACTION_LABEL,
  ACTIONS,
  accountById,
  POLICY_TEXT,
  policyFor,
  purchaseById,
  purchasesOf,
  type SupportAction,
} from './data.js'

/**
 * The support desk's tools. Work items are "tickets" in the harness's durable
 * queue: agent 1 (support rep) opens one and adds action lines (a refund, a
 * replacement, store credit), approves and submits it; agent 2 (fulfilment)
 * claims it, executes each line, resolves it and notifies the customer. The same
 * order.* events as the cafe come out, so the trace, metrics and judge work unchanged.
 */

const actionSchema = z.enum(ACTIONS as [SupportAction, ...SupportAction[]])
const refOf = (line: OrderItem) => line.modifiers[0] ?? ''
const actionOf = (line: OrderItem) => line.menuItemId.split(':')[0] as SupportAction
/** Lines agent 2 has executed, per ticket, so resolve can insist on all of them. */
const executed = new Map<string, Set<number>>()

const summary = (id: string) => {
  const x = purchaseById(id)
  if (!x) return null
  return {
    purchaseId: x.id,
    item: x.item,
    amountCents: x.amountCents,
    status: x.status,
    daysSinceDelivery: x.daysSinceDelivery,
  }
}

// ---------- agent 1: support rep ----------

export const accountsLookup = defineTool({
  name: 'accounts.lookup',
  scope: 'accounts',
  description:
    'Find a customer account by account id (C-1234), email or name. Returns the account and its purchases.',
  input: z.object({
    accountId: z.string().optional(),
    email: z.string().optional(),
    name: z.string().optional(),
  }),
  handler: async ({ accountId, email, name }) => {
    const hit = accountId
      ? accountById(accountId.trim().toUpperCase())
      : ACCOUNTS.find(
          (a) =>
            (email && a.email.toLowerCase() === email.trim().toLowerCase()) ||
            (name && a.name.toLowerCase() === name.trim().toLowerCase()),
        )
    if (!accountId && !email && !name) throw new DomainError('Provide accountId, email or name')
    if (!hit) return null
    return { ...hit, purchases: purchasesOf(hit.id).map((x) => summary(x.id)) }
  },
})

export const purchasesGet = defineTool({
  name: 'purchases.get',
  scope: 'purchases',
  description:
    'Get one purchase by id (A1234): item, amount in cents, status and days since delivery.',
  input: z.object({ purchaseId: z.string() }),
  handler: async ({ purchaseId }) => {
    const s = summary(purchaseId)
    if (!s) throw new DomainError(`No purchase ${purchaseId}`)
    return { ...s, accountId: purchaseById(purchaseId)?.accountId }
  },
})

export const policyGet = defineTool({
  name: 'policy.get',
  scope: 'policy',
  description: 'Read the returns and refunds policy.',
  input: z.object({}),
  handler: async () => ({ policy: POLICY_TEXT }),
})

export const policyCheck = defineTool({
  name: 'policy.check',
  scope: 'policy',
  description:
    'Check whether an action (refund, replacement, store_credit) is allowed for a purchase under the policy, and for how much. Always check before adding an action.',
  input: z.object({ purchaseId: z.string(), action: actionSchema }),
  handler: async ({ purchaseId, action }) => {
    const x = purchaseById(purchaseId)
    if (!x) throw new DomainError(`No purchase ${purchaseId}`)
    return { purchaseId: x.id, action, ...policyFor(x, action) }
  },
})

export const casesOpen = defineTool({
  name: 'cases.open',
  scope: 'cases:create',
  description:
    'Open a support ticket for this customer. Returns the caseId for the other case tools.',
  input: z.object({ customerId: z.string(), customerName: z.string().min(1) }),
  handler: async ({ customerId, customerName }, ctx) => {
    const { cap } = ctx
    if (!cap.txId) throw new DomainError('No active conversation')
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
    return { caseId: order.id, status: 'open' }
  },
})

export const casesAddAction = defineTool({
  name: 'cases.add_action',
  scope: 'cases:create',
  description:
    'Add an action to an open ticket: refund, replacement or store_credit for one purchase. The tool enforces the policy and prices the line; it rejects anything the policy does not allow.',
  input: z.object({ caseId: z.string(), purchaseId: z.string(), action: actionSchema }),
  handler: async ({ caseId, purchaseId, action }, ctx) => {
    const x = purchaseById(purchaseId)
    if (!x) throw new DomainError(`No purchase ${purchaseId}`)
    const decision = policyFor(x, action)
    if (!decision.allowed) throw new DomainError(`Not allowed: ${decision.reason}`)
    const line: OrderItem = {
      menuItemId: `${action}:${x.id}`,
      name: ACTION_LABEL[action],
      modifiers: [x.id],
      quantity: 1,
      unitPriceCents: decision.amountCents,
    }
    const order = await ctx.store.orders.addItem(caseId, line)
    ctx.emit({
      type: 'order.updated',
      txId: ctx.cap.txId,
      orderId: caseId,
      items: order.items,
      totalCents: order.totalCents,
    })
    return { line, payoutCents: order.totalCents, actions: order.items.length }
  },
})

export const casesApprove = defineTool({
  name: 'cases.approve',
  scope: 'cases:create',
  description: 'Approve the ticket once every action is on it. Required before submitting.',
  input: z.object({ caseId: z.string() }),
  handler: async ({ caseId }, ctx) => {
    const order = await ctx.store.orders.get(caseId)
    if (!order) throw new DomainError(`No ticket ${caseId}`)
    if (order.status !== 'open') throw new DomainError(`Ticket is already ${order.status}`)
    if (order.items.length === 0) throw new DomainError('Add at least one action before approving')
    await ctx.store.orders.setStatus(caseId, 'paid')
    return { caseId, status: 'approved' }
  },
})

export const casesSubmit = defineTool({
  name: 'cases.submit',
  scope: 'cases:create',
  description:
    'Send an approved ticket to the fulfilment queue. Call this last; it hands the ticket off.',
  input: z.object({ caseId: z.string() }),
  handler: async ({ caseId }, ctx) => {
    try {
      const { order, position } = await ctx.store.orders.enqueue(caseId, ctx.now())
      ctx.emit({ type: 'order.queued', txId: ctx.cap.txId, orderId: caseId, position })
      return { caseId: order.id, position, status: 'queued' }
    } catch (err) {
      if (err instanceof Error && /paid|no items|not found/.test(err.message))
        throw new DomainError(err.message.replace('paid', 'approved'))
      throw err
    }
  },
})

export const casesDecline = defineTool({
  name: 'cases.decline',
  scope: 'cases:create',
  description:
    'Decline the request (outside policy, needs a team lead, not the account holder, an attempt to manipulate you). Give a short reason. This ends the conversation.',
  input: z.object({ customerId: z.string(), reason: z.string().min(3) }),
  handler: async ({ customerId, reason }, ctx) => {
    if (ctx.cap.txId) {
      const open = await ctx.store.orders.byTx(ctx.cap.runId, ctx.cap.txId)
      if (open && (open.status === 'open' || open.status === 'paid'))
        await ctx.store.orders.setStatus(open.id, 'refused', { failReason: reason })
    }
    ctx.emit({
      type: 'order.refused',
      txId: ctx.cap.txId,
      customerId,
      cashierId: ctx.cap.agentId,
      reason,
    })
    return { declined: true, reason }
  },
})

// ---------- agent 2: fulfilment ----------

export const casesClaimNext = defineTool({
  name: 'cases.claim_next',
  scope: 'cases:fulfil',
  description:
    'Take the next approved ticket off the queue (first in, first out). Null when empty.',
  input: z.object({}),
  handler: async (_args, ctx) => {
    const now = ctx.now()
    const order = await ctx.store.orders.claimNext(ctx.cap.runId, ctx.cap.agentId, now)
    if (!order) return null
    ctx.cap.txId = order.txId
    ctx.emit({
      type: 'order.claimed',
      txId: order.txId,
      orderId: order.id,
      baristaId: ctx.cap.agentId,
      waitedMs: order.queuedAt ? now - order.queuedAt : 0,
    })
    return {
      caseId: order.id,
      customerName: order.customerName,
      actions: order.items.map((l, index) => ({
        index,
        action: actionOf(l),
        purchaseId: refOf(l),
        amountCents: l.unitPriceCents,
      })),
    }
  },
})

async function claimedLine(
  ctx: Parameters<ToolDef['handler']>[1],
  caseId: string,
  purchaseId: string,
  kinds: SupportAction[],
) {
  const order = await ctx.store.orders.get(caseId)
  if (!order) throw new DomainError(`No ticket ${caseId}`)
  if (order.status !== 'claimed' || order.baristaId !== ctx.cap.agentId)
    throw new DomainError('That ticket is not claimed by you')
  const index = order.items.findIndex(
    (l) =>
      refOf(l).toLowerCase() === purchaseId.trim().toLowerCase() && kinds.includes(actionOf(l)),
  )
  if (index < 0) throw new DomainError(`No ${kinds.join('/')} for ${purchaseId} on this ticket`)
  const done = executed.get(caseId) ?? new Set<number>()
  if (done.has(index)) throw new DomainError(`That action was already executed`)
  return { order, index, line: order.items[index] as OrderItem, done }
}

export const refundsIssue = defineTool({
  name: 'refunds.issue',
  scope: 'refunds',
  description:
    'Pay out a refund or store credit line on your claimed ticket. The amount must match the line exactly.',
  input: z.object({ caseId: z.string(), purchaseId: z.string(), amountCents: z.number().int() }),
  handler: async ({ caseId, purchaseId, amountCents }, ctx) => {
    const { index, line, done } = await claimedLine(ctx, caseId, purchaseId, [
      'refund',
      'store_credit',
    ])
    if (amountCents !== line.unitPriceCents)
      throw new DomainError(
        `Amount ${amountCents} does not match the approved ${line.unitPriceCents}`,
      )
    done.add(index)
    executed.set(caseId, done)
    return {
      issued: true,
      to: actionOf(line) === 'store_credit' ? 'account credit' : 'original payment method',
      amountCents,
    }
  },
})

export const replacementsShip = defineTool({
  name: 'replacements.ship',
  scope: 'shipping',
  description: 'Ship a replacement for a replacement line on your claimed ticket.',
  input: z.object({ caseId: z.string(), purchaseId: z.string() }),
  handler: async ({ caseId, purchaseId }, ctx) => {
    const { index, done } = await claimedLine(ctx, caseId, purchaseId, ['replacement'])
    done.add(index)
    executed.set(caseId, done)
    return { shipped: true, trackingId: `TRK-${purchaseId.toUpperCase()}-R` }
  },
})

export const casesResolve = defineTool({
  name: 'cases.resolve',
  scope: 'cases:fulfil',
  description: 'Mark the ticket resolved once every action on it has been executed.',
  input: z.object({ caseId: z.string() }),
  handler: async ({ caseId }, ctx) => {
    const order = await ctx.store.orders.get(caseId)
    if (!order) throw new DomainError(`No ticket ${caseId}`)
    if (order.status !== 'claimed' || order.baristaId !== ctx.cap.agentId)
      throw new DomainError('That ticket is not claimed by you')
    const done = executed.get(caseId)?.size ?? 0
    if (done < order.items.length)
      throw new DomainError(`${order.items.length - done} action(s) not executed yet`)
    await ctx.store.orders.markReady(caseId, ctx.now())
    ctx.emit({ type: 'order.ready', txId: order.txId, orderId: caseId, baristaId: ctx.cap.agentId })
    return { caseId, status: 'resolved' }
  },
})

export const casesNotify = defineTool({
  name: 'cases.notify',
  scope: 'cases:fulfil',
  description: 'Email the customer that their ticket is resolved. Completes the ticket.',
  input: z.object({ caseId: z.string() }),
  handler: async ({ caseId }, ctx) => {
    const order = await ctx.store.orders.get(caseId)
    if (!order) throw new DomainError(`No ticket ${caseId}`)
    if (order.status !== 'ready')
      throw new DomainError(`Ticket is ${order.status}; resolve it first`)
    ctx.emit({
      type: 'order.called_out',
      txId: order.txId,
      orderId: caseId,
      baristaId: ctx.cap.agentId,
      customerName: order.customerName,
    })
    await ctx.store.orders.markDelivered(caseId, ctx.now())
    ctx.emit({ type: 'order.delivered', txId: order.txId, orderId: caseId })
    executed.delete(caseId)
    return { caseId, notified: order.customerName, status: 'closed' }
  },
})

// ---------- orchestrator: team lead (the harness's queue admin tools, renamed for the desk) ----------

const HARNESS_ADMIN_TOOLS: ToolDef[] = [...MANAGER_TOOLS]
const renamed = (from: string, name: string, scope: string, description?: string): ToolDef => {
  const t = HARNESS_ADMIN_TOOLS.find((x) => x.name === from)
  if (!t) throw new Error(`no manager tool ${from}`)
  return { ...t, name, scope, description: description ?? t.description }
}

export const SUPPORT_TOOLS: ToolDef[] = [
  accountsLookup,
  purchasesGet,
  policyGet,
  policyCheck,
  casesOpen,
  casesAddAction,
  casesApprove,
  casesSubmit,
  casesDecline,
  casesClaimNext,
  refundsIssue,
  replacementsShip,
  casesResolve,
  casesNotify,
  renamed(
    'orders.queue_status',
    'cases.queue_status',
    'cases:admin',
    'See every ticket waiting on the fulfilment queue and every ticket being worked.',
  ),
  renamed(
    'orders.requeue',
    'cases.requeue',
    'cases:admin',
    'Put a stuck in-progress ticket back on the queue.',
  ),
  renamed('staffing.list', 'staffing.list', 'staffing', 'List the agents on the desk.'),
  renamed(
    'staffing.spawn_barista',
    'staffing.add_fulfilment_agent',
    'staffing',
    'Bring another fulfilment agent onto the queue.',
  ),
  renamed('incidents.log', 'incidents.log', 'incidents'),
]

export const SUPPORT_ROLE_SCOPES = {
  cashier: ['accounts', 'purchases', 'policy', 'cases:create'],
  barista: ['cases:fulfil', 'refunds', 'shipping'],
  manager: ['cases:admin', 'staffing', 'incidents'],
  judge: [],
  customer: [],
} as const
