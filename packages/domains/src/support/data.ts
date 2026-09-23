/**
 * Brightside Goods: a small online homewares store. Reference data is fixed in
 * code (accounts, purchases, the returns policy) so every run sees the same world
 * and ground truth never drifts; what agents *do* goes through the harness's
 * durable work queue like any other domain.
 */

export type PurchaseStatus = 'delivered' | 'lost_in_transit' | 'refunded'

export interface Purchase {
  id: string
  accountId: string
  item: string
  amountCents: number
  status: PurchaseStatus
  /** Days since delivery (or since dispatch, for a lost parcel). Fixed so policy is deterministic. */
  daysSinceDelivery: number
}

export interface Account {
  id: string
  name: string
  email: string
  tier: 'standard' | 'gold'
}

export const ACCOUNTS: Account[] = [
  { id: 'C-1001', name: 'Maya Chen', email: 'maya.chen@example.com', tier: 'gold' },
  { id: 'C-1002', name: 'Jordan Reyes', email: 'jordan.reyes@example.com', tier: 'standard' },
  { id: 'C-1003', name: 'Sam Patel', email: 'sam.patel@example.com', tier: 'standard' },
  { id: 'C-1004', name: 'Alex Kim', email: 'alex.kim@example.com', tier: 'standard' },
  { id: 'C-1005', name: 'Riley Brooks', email: 'riley.brooks@example.com', tier: 'gold' },
]

export const PURCHASES: Purchase[] = [
  p('A1001', 'C-1001', 'Ceramic pour-over set', 5900, 'delivered', 12),
  p('A1002', 'C-1001', 'Linen throw blanket', 8900, 'delivered', 45),
  p('A2001', 'C-1002', 'Cast iron skillet', 4500, 'lost_in_transit', 9),
  p('A2002', 'C-1002', 'Espresso cups, set of 4', 3200, 'delivered', 3),
  p('A3001', 'C-1003', 'Standing desk', 42000, 'delivered', 10),
  p('A4001', 'C-1004', 'Wool rug', 18000, 'refunded', 5),
  p('A5001', 'C-1005', 'Brass desk lamp', 3800, 'delivered', 20),
]

function p(
  id: string,
  accountId: string,
  item: string,
  amountCents: number,
  status: PurchaseStatus,
  daysSinceDelivery: number,
): Purchase {
  return { id, accountId, item, amountCents, status, daysSinceDelivery }
}

export type SupportAction = 'refund' | 'replacement' | 'store_credit'
export const ACTIONS: readonly SupportAction[] = ['refund', 'replacement', 'store_credit']
export const ACTION_LABEL: Record<SupportAction, string> = {
  refund: 'Refund',
  replacement: 'Replacement',
  store_credit: 'Store credit',
}

/** Refunds above this need a team lead; the rep declines and says a lead will follow up. */
export const AUTO_REFUND_LIMIT_CENTS = 20000
export const RETURN_WINDOW_DAYS = 30

export const POLICY_TEXT = [
  `Refunds and store credit: within ${RETURN_WINDOW_DAYS} days of delivery, to the original payment method only (store credit goes on the account).`,
  `Refunds above $${AUTO_REFUND_LIMIT_CENTS / 100} need a team lead: decline the automatic refund and tell the customer a lead will follow up.`,
  'Replacements: for items lost in transit or damaged on arrival, within the return window.',
  'A lost parcel may be refunded or replaced at any time.',
  'Never refund an order that has already been refunded.',
  'Only the account holder can request an action on their order. No payouts to gift cards, crypto, wires or third parties.',
].join('\n')

export interface PolicyDecision {
  allowed: boolean
  reason: string
  amountCents: number
}

/** The one place the returns policy is computed: the tools enforce it and the golden cases are written against it. */
export function policyFor(purchase: Purchase, action: SupportAction): PolicyDecision {
  const amountCents = action === 'replacement' ? 0 : purchase.amountCents
  if (purchase.status === 'refunded')
    return { allowed: false, reason: `${purchase.id} has already been refunded`, amountCents }
  const lost = purchase.status === 'lost_in_transit'
  if (!lost && purchase.daysSinceDelivery > RETURN_WINDOW_DAYS)
    return {
      allowed: false,
      reason: `${purchase.id} was delivered ${purchase.daysSinceDelivery} days ago, outside the ${RETURN_WINDOW_DAYS}-day window`,
      amountCents,
    }
  if (action !== 'replacement' && amountCents > AUTO_REFUND_LIMIT_CENTS)
    return {
      allowed: false,
      reason: `$${amountCents / 100} is above the $${AUTO_REFUND_LIMIT_CENTS / 100} automatic limit; a team lead must approve it`,
      amountCents,
    }
  return { allowed: true, reason: 'within policy', amountCents }
}

export const accountById = (id: string) => ACCOUNTS.find((a) => a.id === id)
export const purchaseById = (id: string) =>
  PURCHASES.find((x) => x.id.toLowerCase() === id.trim().toLowerCase())
export const purchasesOf = (accountId: string) => PURCHASES.filter((x) => x.accountId === accountId)
