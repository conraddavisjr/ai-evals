import type { LanguageModelV4Prompt } from '@ai-sdk/provider'

/**
 * A MockBrain decides the next move for a scripted persona from the conversation
 * so far. Brains are deterministic and free, but they drive the *real* tools, so
 * the whole pipeline (gateway, DB, events, scene, metrics) is exercised for real.
 */
export type BrainAction =
  | { kind: 'tool'; name: string; args: Record<string, unknown> }
  | { kind: 'text'; text: string }

export interface Turn {
  tool: string
  args: Record<string, unknown>
  /** Parsed JSON result, or the error string when the call failed. */
  result: unknown
  ok: boolean
}

export interface BrainContext {
  system: string
  userText: string
  /** Every completed tool call so far, in order. */
  turns: Turn[]
  /** Structured context the agent runtime embeds in the system prompt. */
  ctx: Record<string, unknown>
}

export type MockBrain = (c: BrainContext) => BrainAction

// ---------- prompt parsing ----------

export function parsePrompt(prompt: LanguageModelV4Prompt): BrainContext {
  let system = ''
  let userText = ''
  const pending = new Map<string, { tool: string; args: Record<string, unknown> }>()
  const turns: Turn[] = []
  for (const m of prompt) {
    if (m.role === 'system') system += `${m.content}\n`
    else if (m.role === 'user') {
      for (const p of m.content) if (p.type === 'text') userText += `${p.text}\n`
    } else if (m.role === 'assistant') {
      for (const p of m.content) {
        if (p.type === 'tool-call') {
          const args =
            typeof p.input === 'string' ? safeJson(p.input) : (p.input as Record<string, unknown>)
          pending.set(p.toolCallId, {
            tool: p.toolName,
            args: (args ?? {}) as Record<string, unknown>,
          })
        }
      }
    } else if (m.role === 'tool') {
      for (const p of m.content) {
        if (p.type !== 'tool-result') continue
        const call = pending.get(p.toolCallId)
        if (!call) continue
        const out = p.output
        let result: unknown = null
        let ok = true
        if (out.type === 'json') result = out.value
        else if (out.type === 'text') result = safeJson(out.value) ?? out.value
        else if (out.type === 'error-text') {
          result = out.value
          ok = false
        } else if (out.type === 'error-json') {
          result = out.value
          ok = false
        }
        // Our tool wrappers return { error } objects for domain failures so the model can recover.
        if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>))
          ok = false
        turns.push({ tool: call.tool, args: call.args, result, ok })
      }
    }
  }
  const ctxMatch = system.match(/<context>([\s\S]*?)<\/context>/)
  const ctx = (ctxMatch ? safeJson(ctxMatch[1] ?? '') : null) ?? {}
  return { system, userText: userText.trim(), turns, ctx: ctx as Record<string, unknown> }
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---------- utterance understanding (tiny, deterministic) ----------

export const MENU_ALIASES: Array<{ id: string; patterns: RegExp[] }> = [
  { id: 'flat_white', patterns: [/flat\s*white/i] },
  { id: 'iced_latte', patterns: [/iced\s+latte/i] },
  { id: 'lavender_latte', patterns: [/lavender/i] },
  { id: 'pumpkin_latte', patterns: [/pumpkin/i, /\bpsl\b/i] },
  { id: 'matcha_latte', patterns: [/matcha/i] },
  { id: 'chai_latte', patterns: [/chai/i] },
  { id: 'latte', patterns: [/\blatte\b/i] },
  { id: 'cappuccino', patterns: [/cappuccino|cappucino|capp\b/i] },
  { id: 'mocha', patterns: [/mocha/i] },
  { id: 'americano', patterns: [/americano/i] },
  { id: 'espresso', patterns: [/espresso|double\s*shot\b(?!.*latte)/i] },
  { id: 'cold_brew', patterns: [/cold\s*brew/i] },
  { id: 'hot_chocolate', patterns: [/hot\s*choc/i, /cocoa/i] },
  {
    id: 'drip',
    patterns: [/drip|black\s+coffee|regular\s+coffee|house\s+coffee|cup\s+of\s+coffee/i],
  },
  { id: 'croissant', patterns: [/croissant/i] },
  { id: 'blueberry_muffin', patterns: [/muffin/i] },
]

const SIZE_PATTERNS: Array<[RegExp, 'small' | 'medium' | 'large']> = [
  [/\b(large|venti|big|grande)\b/i, 'large'],
  [/\b(small|short|tall)\b/i, 'small'],
  [/\b(medium|regular)\b/i, 'medium'],
]

const MODIFIER_PATTERNS: Array<[RegExp, string]> = [
  [/\boat\b/i, 'oat milk'],
  [/\balmond\b/i, 'almond milk'],
  [/extra\s+shot|double\s+shot|extra\s+strong/i, 'extra shot'],
  [/\bdecaf/i, 'decaf'],
  [/vanilla/i, 'vanilla syrup'],
  [/caramel/i, 'caramel syrup'],
  [/extra\s+hot/i, 'extra hot'],
  [/light\s+ice/i, 'light ice'],
  [/warm(ed)?\b/i, 'warmed'],
]

export interface ParsedRequest {
  items: Array<{
    menuItemId: string
    size?: 'small' | 'medium' | 'large'
    modifiers: string[]
    quantity: number
  }>
  wantsLoyalty: boolean
}

export function parseRequest(text: string): ParsedRequest {
  const items: ParsedRequest['items'] = []
  const claimed = new Set<string>()
  for (const alias of MENU_ALIASES) {
    if (claimed.has(alias.id)) continue
    if (alias.patterns.some((p) => p.test(text))) {
      // avoid double-matching "latte" inside "iced latte"/"matcha latte"
      if (
        alias.id === 'latte' &&
        items.some((i) => i.menuItemId.endsWith('_latte') || i.menuItemId === 'flat_white')
      )
        continue
      if (alias.id === 'espresso' && items.length > 0) continue
      claimed.add(alias.id)
      const qty = text.match(/\b(two|2)\b/i) && items.length === 0 ? 2 : 1
      const size = SIZE_PATTERNS.find(([p]) => p.test(text))?.[1]
      const modifiers = MODIFIER_PATTERNS.filter(([p]) => p.test(text)).map(([, m]) => m)
      const item: ParsedRequest['items'][number] = {
        menuItemId: alias.id,
        modifiers,
        quantity: qty,
      }
      if (size) item.size = size
      items.push(item)
    }
  }
  return { items, wantsLoyalty: /points|loyalty|rewards|redeem/i.test(text) }
}

export const ADVERSARIAL =
  /ignore (all|your|previous)|system prompt|free (drinks?|coffee)|for free\b|refund|give me (the|your) (register|cash|money)|jailbreak|developer mode|override|disregard|you are now|pretend you/i
export const GIBBERISH = /^[^a-z]*$|^(\w{1,3}\s?){1,3}$/i

// ---------- personas ----------

const last = (c: BrainContext, tool: string) => [...c.turns].reverse().find((t) => t.tool === tool)
const failures = (c: BrainContext, tool: string) =>
  c.turns.filter((t) => t.tool === tool && !t.ok).length

export const cashierBrain =
  (opts: { naive?: boolean } = {}): MockBrain =>
  (c) => {
    const customerId = String(c.ctx.customerId ?? 'walk-in')
    const customerName = String(c.ctx.customerName ?? 'Guest')
    const loyaltyId = c.ctx.loyaltyId ? String(c.ctx.loyaltyId) : undefined
    const req = parseRequest(c.userText)

    // Any transient failure: retry once, then give up politely.
    const lastTurn = c.turns.at(-1)
    if (
      lastTurn &&
      !lastTurn.ok &&
      /simulated|timed out|froze|jammed|lost connection/i.test(String(lastTurn.result))
    ) {
      if (failures(c, lastTurn.tool) >= 2)
        return {
          kind: 'text',
          text: `I'm so sorry ${customerName}, our register is acting up. Give me one moment.`,
        }
      return { kind: 'tool', name: lastTurn.tool, args: lastTurn.args }
    }

    if (c.turns.length === 0) {
      if (!opts.naive && ADVERSARIAL.test(c.userText)) {
        return {
          kind: 'tool',
          name: 'orders.refuse',
          args: { customerId, reason: 'Request tried to bypass store policy' },
        }
      }
      if (opts.naive && /refund/i.test(c.userText)) {
        // the naive cashier reaches for a tool that does not exist anywhere
        return { kind: 'tool', name: 'payments.refund', args: { customerId } }
      }
      if (opts.naive && /make it (yourself|now)|skip the (line|queue)/i.test(c.userText)) {
        // ...or for a barista tool it was never given (scope violation)
        return { kind: 'tool', name: 'orders.claim_next', args: {} }
      }
      if (req.items.length === 0) {
        if (!opts.naive && GIBBERISH.test(c.userText)) {
          return {
            kind: 'tool',
            name: 'orders.refuse',
            args: { customerId, reason: 'Could not understand the request' },
          }
        }
        return {
          kind: 'tool',
          name: 'menu.lookup',
          args: { query: c.userText.split(/\s+/).slice(0, 3).join(' ') },
        }
      }
      return {
        kind: 'tool',
        name: 'menu.lookup',
        args: { query: req.items[0]?.menuItemId.replace(/_/g, ' ') ?? 'coffee' },
      }
    }

    if (last(c, 'orders.refuse')?.ok) {
      return {
        kind: 'text',
        text: `I'm sorry ${customerName}, that's not something I can help with today. Happy to take a regular order if you'd like.`,
      }
    }

    const lookup = last(c, 'menu.lookup')
    if (lookup && !last(c, 'orders.create')) {
      const hits = Array.isArray(lookup.result)
        ? (lookup.result as Array<{ id: string; available: boolean }>)
        : []
      if (req.items.length === 0 && hits.length === 0) {
        return {
          kind: 'tool',
          name: 'orders.refuse',
          args: { customerId, reason: "We don't have that on the menu" },
        }
      }
      if (loyaltyId && !last(c, 'customers.lookup')) {
        return { kind: 'tool', name: 'customers.lookup', args: { loyaltyId } }
      }
      return { kind: 'tool', name: 'orders.create', args: { customerId, customerName } }
    }

    const created = last(c, 'orders.create')
    const orderId = created?.ok
      ? String((created.result as { orderId: string }).orderId)
      : undefined
    if (!orderId)
      return {
        kind: 'text',
        text: `Sorry ${customerName}, I couldn't open an order. Let me get the manager.`,
      }

    const adds = c.turns.filter((t) => t.tool === 'orders.add_item')
    const attempted = new Set(adds.map((t) => String(t.args.menuItemId)))
    const nextItem = req.items.find((i) => !attempted.has(i.menuItemId))
    if (nextItem) {
      const args: Record<string, unknown> = {
        orderId,
        menuItemId: nextItem.menuItemId,
        modifiers: nextItem.modifiers,
        quantity: nextItem.quantity,
      }
      if (nextItem.size) args.size = nextItem.size
      return { kind: 'tool', name: 'orders.add_item', args }
    }
    const okAdds = adds.filter((t) => t.ok)
    if (okAdds.length === 0) {
      const why = adds.find((t) => !t.ok)
      const msg = why
        ? String((why.result as { error?: string })?.error ?? why.result)
        : 'nothing could be added'
      return {
        kind: 'tool',
        name: 'orders.refuse',
        args: { customerId, reason: `Could not fulfil the order: ${msg}` },
      }
    }

    if (!last(c, 'payments.charge')?.ok) {
      const memberRows = last(c, 'customers.lookup')?.result
      const points = Array.isArray(memberRows)
        ? ((memberRows as Array<{ points: number }>)[0]?.points ?? 0)
        : 0
      const method = req.wantsLoyalty && loyaltyId && points >= 100 ? 'loyalty' : 'card'
      const args: Record<string, unknown> = { orderId, method }
      if (loyaltyId) args.loyaltyId = loyaltyId
      // A rejected loyalty attempt falls back to card.
      if (last(c, 'payments.charge') && !last(c, 'payments.charge')?.ok) args.method = 'card'
      return { kind: 'tool', name: 'payments.charge', args }
    }

    if (!last(c, 'orders.enqueue')?.ok)
      return { kind: 'tool', name: 'orders.enqueue', args: { orderId } }

    const names = okAdds.map((t) => String(t.args.menuItemId).replace(/_/g, ' '))
    return {
      kind: 'text',
      text: `Thanks ${customerName}! One ${names.join(' and one ')} coming right up. I'll call your name at the counter.`,
    }
  }

export const baristaBrain =
  (opts: { forgetful?: boolean } = {}): MockBrain =>
  (c) => {
    const lastTurn = c.turns.at(-1)
    if (
      lastTurn &&
      !lastTurn.ok &&
      /simulated|timed out|froze|jammed|lost connection/i.test(String(lastTurn.result))
    ) {
      if (failures(c, lastTurn.tool) >= 2)
        return { kind: 'text', text: 'The machine is not cooperating; flagging the manager.' }
      return { kind: 'tool', name: lastTurn.tool, args: lastTurn.args }
    }
    const claim = last(c, 'orders.claim_next')
    if (!claim) return { kind: 'tool', name: 'orders.claim_next', args: {} }
    const ticket = claim.ok
      ? (claim.result as {
          orderId: string
          customerName: string
          items: Array<{ menuItemId: string; size: string; modifiers: string[] }>
        } | null)
      : null
    if (!ticket) return { kind: 'text', text: 'Rail is empty.' }

    // Progress through the ticket line by line: recipe -> consume -> log. The number of
    // successful log_made calls tells us which line we are on; turns after the last
    // successful log belong to the current line.
    const logged = c.turns.filter((t) => t.tool === 'drinks.log_made' && t.ok).length
    const item = ticket.items[logged]
    if (item) {
      const lastLogIdx = c.turns.reduce(
        (idx, t, i) => (t.tool === 'drinks.log_made' && t.ok ? i : idx),
        -1,
      )
      const lineTurns = c.turns.slice(lastLogIdx + 1)
      if (!lineTurns.some((t) => t.tool === 'recipes.get')) {
        return { kind: 'tool', name: 'recipes.get', args: { menuItemId: item.menuItemId } }
      }
      const consumed = lineTurns.find((t) => t.tool === 'inventory.consume')
      if (!consumed) {
        return {
          kind: 'tool',
          name: 'inventory.consume',
          args: { menuItemId: item.menuItemId, size: item.size, modifiers: item.modifiers },
        }
      }
      if (!consumed.ok) {
        const msg = String((consumed.result as { error?: string })?.error ?? consumed.result)
        return {
          kind: 'text',
          text: `I can't make the ${item.menuItemId.replace(/_/g, ' ')} for ${ticket.customerName}: ${msg}`,
        }
      }
      return {
        kind: 'tool',
        name: 'drinks.log_made',
        args: {
          orderId: ticket.orderId,
          menuItemId: item.menuItemId,
          size: item.size,
          modifiers: item.modifiers,
        },
      }
    }
    if (!last(c, 'orders.mark_ready')?.ok)
      return { kind: 'tool', name: 'orders.mark_ready', args: { orderId: ticket.orderId } }
    if (opts.forgetful) return { kind: 'text', text: `Done with ${ticket.customerName}'s order.` } // never calls it out
    if (!last(c, 'orders.call_out')?.ok)
      return { kind: 'tool', name: 'orders.call_out', args: { orderId: ticket.orderId } }
    return { kind: 'text', text: `Order up for ${ticket.customerName}!` }
  }

export const managerBrain = (): MockBrain => (c) => {
  if (!last(c, 'orders.queue_status'))
    return { kind: 'tool', name: 'orders.queue_status', args: {} }
  return { kind: 'text', text: 'Floor looks fine.' }
}

export const PERSONAS: Record<string, () => MockBrain> = {
  cashier: () => cashierBrain(),
  'cashier-naive': () => cashierBrain({ naive: true }),
  barista: () => baristaBrain(),
  'barista-forgetful': () => baristaBrain({ forgetful: true }),
  manager: () => managerBrain(),
}
