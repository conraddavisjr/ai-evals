import type { CafeEvent } from './events.js'

/**
 * Beats are the coarse phases of one transaction (one customer visit). The scene
 * animates beats, the step-through mode pauses on them, and the waterfall shows
 * how the transaction's time splits across them. They are derived purely from
 * event timestamps so replay and live views agree.
 */
export const BEATS = [
  'arrive',
  'order_taken',
  'queued',
  'making',
  'called_out',
  'left',
  'judged',
] as const
export type Beat = (typeof BEATS)[number]

export interface BeatSpan {
  beat: Beat
  startT: number
  /** Null while the beat is still in progress (live view). */
  endT: number | null
  durationMs: number | null
  /** Who is "on the clock" for this beat, when applicable. */
  agentId?: string
}

export interface TransactionTimeline {
  txId: string
  customerId: string | null
  customerName: string | null
  orderId: string | null
  scenarioId: string | null
  startT: number
  endT: number | null
  totalMs: number | null
  beats: BeatSpan[]
  outcome: 'served' | 'refused' | 'abandoned' | 'failed' | null
  /** Percent of totalMs per beat; only for finished transactions. */
  percentages: Partial<Record<Beat, number>>
}

const FIRST = <T>(xs: T[], pred: (x: T) => boolean): T | undefined => xs.find(pred)

/** Build the beat timeline for one transaction from that transaction's events (any order). */
export function beatsOf(events: CafeEvent[], txId: string): TransactionTimeline | null {
  const evs = events.filter((e) => e.txId === txId).sort((a, b) => a.seq - b.seq)
  if (evs.length === 0) return null

  const arrived = FIRST(evs, (e) => e.type === 'customer.arrived')
  if (arrived?.type !== 'customer.arrived') return null

  const cashierStart = FIRST(evs, (e) => e.type === 'agent.thinking' && e.role === 'cashier')
  const created = FIRST(evs, (e) => e.type === 'order.created')
  const refused = FIRST(evs, (e) => e.type === 'order.refused')
  const queued = FIRST(evs, (e) => e.type === 'order.queued')
  const claimed = FIRST(evs, (e) => e.type === 'order.claimed')
  const ready = FIRST(evs, (e) => e.type === 'order.ready')
  const delivered = FIRST(evs, (e) => e.type === 'order.delivered')
  const orderFailed = FIRST(evs, (e) => e.type === 'order.failed')
  const left = FIRST(evs, (e) => e.type === 'customer.left')
  const verdict = FIRST(evs, (e) => e.type === 'judge.verdict')

  const at = (e: CafeEvent | undefined) => (e ? e.t : null)
  const agentOf = (e: CafeEvent | undefined): string | undefined => {
    if (!e) return undefined
    if ('agentId' in e && typeof e.agentId === 'string') return e.agentId
    if ('baristaId' in e && typeof e.baristaId === 'string') return e.baristaId
    if ('cashierId' in e && typeof e.cashierId === 'string') return e.cashierId
    return undefined
  }

  const beats: BeatSpan[] = []
  const push = (beat: Beat, startT: number | null, endT: number | null, agentId?: string) => {
    if (startT === null) return
    const span: BeatSpan = { beat, startT, endT, durationMs: endT === null ? null : endT - startT }
    if (agentId) span.agentId = agentId
    beats.push(span)
  }

  // arrive: walking in until a cashier starts on them
  const orderTakenStart = at(cashierStart) ?? at(created) ?? at(refused)
  push('arrive', arrived.t, orderTakenStart)
  // order_taken: cashier works until order is queued (or refused)
  const orderTakenEnd = at(queued) ?? at(refused) ?? (created ? at(orderFailed) : null)
  push('order_taken', orderTakenStart, orderTakenEnd, agentOf(cashierStart) ?? agentOf(created))
  // queued: waiting on the rail
  if (queued) push('queued', queued.t, at(claimed) ?? at(orderFailed))
  // making: barista on the clock
  if (claimed) push('making', claimed.t, at(ready) ?? at(orderFailed), agentOf(claimed))
  // called_out: ready until handed over
  if (ready) push('called_out', ready.t, at(delivered) ?? at(orderFailed), agentOf(ready))
  // left: hand-over until out the door
  const leftStart = at(delivered) ?? at(refused) ?? at(orderFailed)
  push('left', leftStart, at(left))
  // judged: after they leave until the verdict lands
  if (left) push('judged', left.t, at(verdict))

  const endT = at(verdict) ?? at(left)
  const totalMs = endT === null ? null : endT - arrived.t
  const percentages: Partial<Record<Beat, number>> = {}
  if (totalMs && totalMs > 0) {
    for (const b of beats)
      if (b.durationMs !== null) percentages[b.beat] = (b.durationMs / totalMs) * 100
  }

  return {
    txId,
    customerId: arrived.customerId,
    customerName: arrived.name,
    orderId: created?.type === 'order.created' ? created.orderId : null,
    scenarioId: arrived.scenarioId,
    startT: arrived.t,
    endT,
    totalMs,
    beats,
    outcome: left?.type === 'customer.left' ? left.outcome : null,
    percentages,
  }
}

/** All transaction ids in a run, in arrival order. */
export function transactionIds(events: CafeEvent[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'customer.arrived' && e.txId && !seen.has(e.txId)) {
      seen.add(e.txId)
      out.push(e.txId)
    }
  }
  return out
}

export function allTimelines(events: CafeEvent[]): TransactionTimeline[] {
  return transactionIds(events)
    .map((tx) => beatsOf(events, tx))
    .filter((t): t is TransactionTimeline => t !== null)
}
