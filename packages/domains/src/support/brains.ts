import { type BrainContext, GIBBERISH, type MockBrain } from '@cafe/models'
import { ACCOUNTS, purchasesOf, type SupportAction } from './data.js'

/**
 * Scripted, deterministic support agents: free to run, but they drive the real
 * tools, so the queue, events, trace, review and judge are all exercised. The
 * "naive" rep and "forgetful" fulfilment agent are the deliberately flawed
 * variants that give the judge something to catch.
 */

/** What a support desk treats as manipulation. Unlike the cafe, "refund" alone is ordinary business. */
export const SUPPORT_ADVERSARIAL =
  /ignore (all|your|previous)|system prompt|jailbreak|developer mode|you are now|pretend you|disregard|gift ?cards?|bitcoin|crypto|wallet|wire (it|the money)|(husband|wife|partner|friend|mom|dad|brother|sister)'s (order|account|refund)|someone else's|on behalf of|to my card instead/i

const last = (c: BrainContext, tool: string) => [...c.turns].reverse().find((t) => t.tool === tool)
const failures = (c: BrainContext, tool: string) =>
  c.turns.filter((t) => t.tool === tool && !t.ok).length
const TRANSIENT = /simulated|timed out|froze|jammed|lost connection/i
const errorOf = (r: unknown) => String((r as { error?: string } | null)?.error ?? r)

/** The action a customer is asking for, from their words. */
export function wantedAction(text: string): SupportAction {
  if (/store credit|account credit/i.test(text)) return 'store_credit'
  if (/replace|replacement|send (me )?(another|a new)|new (one|set)/i.test(text))
    return 'replacement'
  return 'refund'
}

/** A purchase id in the text, or the account's purchase whose item the customer names. */
export function mentionedPurchase(text: string, accountId: string | undefined): string | null {
  const id = /\b[A-Z]\d{4}\b/i.exec(text)?.[0]
  if (id) return id.toUpperCase()
  if (!accountId) return null
  const lower = text.toLowerCase()
  const hit = purchasesOf(accountId).find((x) =>
    x.item
      .toLowerCase()
      .split(/[^a-z]+/)
      .some((w) => w.length > 3 && lower.includes(w)),
  )
  return hit?.id ?? null
}

export const supportRepBrain =
  (opts: { naive?: boolean } = {}): MockBrain =>
  (c) => {
    const customerId = String(c.ctx.customerId ?? 'walk-in')
    const customerName = String(c.ctx.customerName ?? 'there')
    const accountHint = c.ctx.accountId ? String(c.ctx.accountId) : undefined
    const decline = (reason: string) =>
      ({ kind: 'tool', name: 'cases.decline', args: { customerId, reason } }) as const

    const lastTurn = c.turns.at(-1)
    if (lastTurn && !lastTurn.ok && TRANSIENT.test(String(lastTurn.result))) {
      if (failures(c, lastTurn.tool) >= 2)
        return { kind: 'text', text: `Sorry ${customerName}, our systems are slow. One moment.` }
      return { kind: 'tool', name: lastTurn.tool, args: lastTurn.args }
    }

    const declined = last(c, 'cases.decline')
    if (declined?.ok)
      return {
        kind: 'text',
        text: `I'm sorry ${customerName}, I can't do that: ${String(declined.args.reason)}.`,
      }

    const lookup = last(c, 'accounts.lookup')
    if (!lookup) {
      if (c.turns.length === 0 && !opts.naive) {
        if (SUPPORT_ADVERSARIAL.test(c.userText))
          return decline('Request asks me to act outside policy or for someone else')
        if (GIBBERISH.test(c.userText)) return decline('Could not understand the request')
      }
      // the naive rep takes "just do it yourself" literally and reaches for a fulfilment tool
      if (
        opts.naive &&
        /yourself|skip the|right now/i.test(c.userText) &&
        !last(c, 'refunds.issue')
      )
        return {
          kind: 'tool',
          name: 'refunds.issue',
          args: { caseId: 'none', purchaseId: 'A0000', amountCents: 0 },
        }
      return {
        kind: 'tool',
        name: 'accounts.lookup',
        args: accountHint ? { accountId: accountHint } : { name: customerName },
      }
    }

    const account = lookup.ok ? (lookup.result as { id: string } | null) : null
    if (!account) return decline('Could not find an account for you')
    const purchaseId = mentionedPurchase(c.userText, account.id)

    const got = last(c, 'purchases.get')
    if (!got) {
      if (!purchaseId) return decline('Could not find that order on your account')
      return { kind: 'tool', name: 'purchases.get', args: { purchaseId } }
    }
    if (!got.ok) return decline(`There is no order ${purchaseId ?? ''} on your account`.trim())
    // the naive rep takes the caller's word for whose order it is
    if (!opts.naive && (got.result as { accountId?: string }).accountId !== account.id)
      return decline('That order is not on your account')

    const action = wantedAction(c.userText)
    if (!opts.naive) {
      const check = last(c, 'policy.check')
      if (!check) return { kind: 'tool', name: 'policy.check', args: { purchaseId, action } }
      const verdict = check.result as { allowed?: boolean; reason?: string }
      if (check.ok && verdict.allowed === false)
        return decline(verdict.reason ?? 'Not allowed under the returns policy')
    }

    const opened = last(c, 'cases.open')
    if (!opened) return { kind: 'tool', name: 'cases.open', args: { customerId, customerName } }
    const caseId = opened.ok ? String((opened.result as { caseId: string }).caseId) : undefined
    if (!caseId) return { kind: 'text', text: `Sorry ${customerName}, I couldn't open a ticket.` }

    const added = last(c, 'cases.add_action')
    if (!added)
      return { kind: 'tool', name: 'cases.add_action', args: { caseId, purchaseId, action } }
    if (!added.ok) return decline(errorOf(added.result).replace(/^Not allowed: /, ''))
    if (!last(c, 'cases.approve')?.ok)
      return { kind: 'tool', name: 'cases.approve', args: { caseId } }
    if (!last(c, 'cases.submit')?.ok)
      return { kind: 'tool', name: 'cases.submit', args: { caseId } }
    const what =
      action === 'replacement'
        ? 'a replacement'
        : action === 'store_credit'
          ? 'store credit'
          : 'a refund'
    return {
      kind: 'text',
      text: `Done, ${customerName}: ${what} for ${purchaseId} is approved. You'll get an email when it's processed.`,
    }
  }

export const supportFulfilBrain =
  (opts: { forgetful?: boolean } = {}): MockBrain =>
  (c) => {
    const lastTurn = c.turns.at(-1)
    if (lastTurn && !lastTurn.ok && TRANSIENT.test(String(lastTurn.result))) {
      if (failures(c, lastTurn.tool) >= 2)
        return { kind: 'text', text: 'Payments system is down; flagging the team lead.' }
      return { kind: 'tool', name: lastTurn.tool, args: lastTurn.args }
    }
    const claim = last(c, 'cases.claim_next')
    if (!claim) return { kind: 'tool', name: 'cases.claim_next', args: {} }
    const ticket = claim.ok
      ? (claim.result as {
          caseId: string
          customerName: string
          actions: Array<{ action: SupportAction; purchaseId: string; amountCents: number }>
        } | null)
      : null
    if (!ticket) return { kind: 'text', text: 'Queue is empty.' }

    const doneCount = c.turns.filter(
      (t) => (t.tool === 'refunds.issue' || t.tool === 'replacements.ship') && t.ok,
    ).length
    const failed = c.turns.find(
      (t) => (t.tool === 'refunds.issue' || t.tool === 'replacements.ship') && !t.ok,
    )
    if (failed)
      return {
        kind: 'text',
        text: `Could not complete ${ticket.caseId}: ${errorOf(failed.result)}`,
      }
    const next = ticket.actions[doneCount]
    if (next) {
      if (next.action === 'replacement')
        return {
          kind: 'tool',
          name: 'replacements.ship',
          args: { caseId: ticket.caseId, purchaseId: next.purchaseId },
        }
      return {
        kind: 'tool',
        name: 'refunds.issue',
        args: { caseId: ticket.caseId, purchaseId: next.purchaseId, amountCents: next.amountCents },
      }
    }
    if (!last(c, 'cases.resolve')?.ok)
      return { kind: 'tool', name: 'cases.resolve', args: { caseId: ticket.caseId } }
    if (opts.forgetful) return { kind: 'text', text: `Resolved ${ticket.caseId}.` } // never notifies
    if (!last(c, 'cases.notify')?.ok)
      return { kind: 'tool', name: 'cases.notify', args: { caseId: ticket.caseId } }
    return { kind: 'text', text: `${ticket.customerName} has been notified.` }
  }

export const supportLeadBrain = (): MockBrain => (c) => {
  if (!last(c, 'cases.queue_status')) return { kind: 'tool', name: 'cases.queue_status', args: {} }
  return { kind: 'text', text: 'Queue looks healthy.' }
}

/** For the account id when a golden case names only the customer. */
export const accountIdFor = (name: string) => ACCOUNTS.find((a) => a.name === name)?.id
