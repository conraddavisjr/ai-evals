import type { CafeEvent } from '@cafe/protocol'

/** Which layer of the pipeline a badge belongs to; decides its colour. */
export type Layer = 'input' | 'orch' | 'agent' | 'tool' | 'eval' | 'error'
/** The horizontal bands, top to bottom. Agent steps and their tool calls share one band so time order is kept. */
export type Band = 'input' | 'orch' | 'work' | 'eval'
export const BANDS: Band[] = ['input', 'orch', 'work', 'eval']
export const BAND_TITLE: Record<Band, string> = {
  input: 'Golden item',
  orch: 'Orchestration',
  work: 'Sub-agents + MCP tools',
  eval: 'Evaluation',
}

export type Mark = 'ok' | 'bad' | 'warn' | 'unknown'

export interface Badge {
  seq: number
  t: number
  layer: Layer
  /** Short label on the left of the badge (a step number, a tool name, a verdict). */
  head: string
  /** The rest of the line. */
  text: string
  /** Full detail for the tooltip. */
  detail?: string | undefined
  mark?: Mark | undefined
  /** Time since the visit started, ms. */
  atMs: number
  latencyMs?: number | undefined
  agentId?: string | undefined
  customerId?: string | undefined
  /** Tool badges sit under their step. */
  indent?: boolean | undefined
}

export interface Column {
  txId: string
  index: number
  scenarioId: string
  name: string
  expectedOutcome: string | null
  outcome: string | null
  bands: Record<Band, Badge[]>
}

export interface TraceModel {
  columns: Column[]
  /** Events that belong to no visit (staff spawning, run lifecycle). */
  shift: Badge[]
  runStatus: 'idle' | 'running' | 'finished' | 'failed'
}

const clip = (s: string, n = 96) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Fold the applied events into the trace board: one column per visit in arrival
 * order, four bands per column, badges in event order. Pure, so it runs on
 * every applied event without touching the DOM and is unit-testable.
 */
export function buildTrace(events: CafeEvent[]): TraceModel {
  const columns: Column[] = []
  const byTx = new Map<string, Column>()
  const shift: Badge[] = []
  let runStatus: TraceModel['runStatus'] = 'idle'
  /** Expected tools per role per column, from customer.arrived. */
  const expected = new Map<string, { cashier: Set<string>; barista: Set<string> } | null>()
  /** Open tool calls waiting for their return, by callId. */
  const openCalls = new Map<string, Badge>()
  /** Open steps waiting for their model.usage, by agentId. */
  const openSteps = new Map<string, Badge>()
  /** Events from an agent not yet bound to a visit (a barista before it claims a ticket). */
  const pending = new Map<string, CafeEvent[]>()
  const startOf = new Map<string, number>()

  const col = (txId: string) => byTx.get(txId)
  const place = (c: Column, band: Band, b: Badge) => c.bands[band].push(b)
  const atMs = (c: Column, t: number) => t - (startOf.get(c.txId) ?? t)

  const handle = (e: CafeEvent, c: Column) => {
    const rel = atMs(c, e.t)
    switch (e.type) {
      case 'customer.arrived': {
        c.name = e.name
        c.scenarioId = e.scenarioId
        c.expectedOutcome = e.expected?.outcome ?? null
        expected.set(
          c.txId,
          e.expected
            ? {
                cashier: new Set(e.expected.cashierTools),
                barista: new Set(e.expected.baristaTools),
              }
            : null,
        )
        place(c, 'input', {
          seq: e.seq,
          t: e.t,
          atMs: 0,
          layer: 'input',
          head: e.name,
          text: `“${clip(e.utterance, 140)}”`,
          detail: `${e.scenarioId}${e.expected ? ` · expect ${e.expected.outcome}${e.expected.tags.length ? ` · ${e.expected.tags.join(', ')}` : ''}` : ''}`,
          customerId: e.customerId,
        })
        if (e.expected)
          place(c, 'input', {
            seq: e.seq,
            t: e.t,
            atMs: 0,
            layer: 'input',
            head: 'expect',
            text: `${e.expected.outcome}${e.expected.cashierTools.length ? ` · cashier: ${e.expected.cashierTools.map(short).join(' ')}` : ''}${e.expected.baristaTools.length ? ` · barista: ${e.expected.baristaTools.map(short).join(' ')}` : ''}`,
            customerId: e.customerId,
          })
        break
      }
      case 'triage.decided':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'triage',
          text: `${e.intent}${e.escalate ? ' · escalate' : ''} · ${Math.round(e.escalateProbability * 100)}%`,
          latencyMs: e.latencyMs,
          mark: e.escalate ? 'warn' : undefined,
          customerId: e.customerId,
        })
        break
      case 'customer.moved':
        if (e.to.startsWith('register'))
          place(c, 'orch', {
            seq: e.seq,
            t: e.t,
            atMs: rel,
            layer: 'orch',
            head: 'assign',
            text: `→ ${e.to}`,
            customerId: e.customerId,
          })
        break
      case 'customer.spoke':
        place(c, 'work', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'input',
          head: 'customer',
          text: `“${clip(e.text)}”`,
          customerId: e.customerId,
        })
        break
      case 'agent.thinking': {
        const b: Badge = {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'agent',
          head: e.agentId,
          text: `step ${e.step}`,
          agentId: e.agentId,
        }
        openSteps.set(e.agentId, b)
        place(c, 'work', b)
        break
      }
      case 'model.usage': {
        const b = openSteps.get(e.agentId)
        if (b && e.role !== 'manager' && e.role !== 'judge') {
          b.latencyMs = e.latencyMs
          b.detail = `${e.modelSpec} · ${e.inputTokens} in / ${e.outputTokens} out · $${e.costUsd.toFixed(4)}`
        }
        break
      }
      case 'agent.spoke':
        place(c, 'work', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'agent',
          head: e.agentId,
          text: `“${clip(e.text)}”`,
          agentId: e.agentId,
          indent: true,
        })
        break
      case 'agent.tool_called': {
        const exp = expected.get(c.txId)
        const set = exp
          ? e.role === 'cashier'
            ? exp.cashier
            : e.role === 'barista'
              ? exp.barista
              : null
          : null
        const b: Badge = {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'tool',
          head: e.tool,
          text: clip(JSON.stringify(e.args), 80),
          detail: JSON.stringify(e.args),
          mark:
            set === null ? (exp === null ? 'unknown' : 'warn') : set.has(e.tool) ? 'ok' : 'warn',
          agentId: e.agentId,
          indent: true,
        }
        openCalls.set(e.callId, b)
        place(c, 'work', b)
        break
      }
      case 'agent.tool_returned': {
        const b = openCalls.get(e.callId)
        if (!b) break
        b.latencyMs = e.latencyMs
        if (!e.ok) {
          b.mark = 'bad'
          b.text = clip(e.error ?? 'failed', 80)
          b.detail = e.error ?? 'failed'
        }
        openCalls.delete(e.callId)
        break
      }
      case 'agent.scope_violation':
        place(c, 'work', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'error',
          head: 'scope',
          text: `${e.agentId} tried ${e.tool}`,
          mark: 'bad',
          agentId: e.agentId,
          indent: true,
        })
        break
      case 'agent.error':
        place(c, 'work', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'error',
          head: e.kind,
          text: `${e.agentId}: ${clip(e.message)}`,
          detail: e.message,
          mark: 'bad',
          agentId: e.agentId,
        })
        break
      case 'order.created':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'order',
          text: e.items.length ? itemsText(e.items, e.totalCents) : `opened by ${e.cashierId}`,
          agentId: e.cashierId,
        })
        break
      case 'order.updated':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'order',
          text: itemsText(e.items, e.totalCents),
        })
        break
      case 'order.queued':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'rail',
          text: `queued at position ${e.position}`,
        })
        break
      case 'order.claimed':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'rail',
          text: `claimed by ${e.baristaId} after ${fmt(e.waitedMs)}`,
          agentId: e.baristaId,
        })
        break
      case 'order.requeued':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'rail',
          text: `requeued: ${e.reason}`,
          mark: 'warn',
        })
        break
      case 'order.ready':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'rail',
          text: `ready (${e.baristaId})`,
          agentId: e.baristaId,
        })
        break
      case 'order.called_out':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'pickup',
          text: `called ${e.customerName}`,
          agentId: e.baristaId,
        })
        break
      case 'order.delivered':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'pickup',
          text: 'delivered',
          mark: 'ok',
        })
        break
      case 'order.failed':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'error',
          head: 'order',
          text: `failed: ${clip(e.reason)}`,
          mark: 'bad',
        })
        break
      case 'order.refused':
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'orch',
          head: 'refused',
          text: clip(e.reason),
          agentId: e.cashierId,
        })
        break
      case 'customer.left': {
        c.outcome = e.outcome
        const ok =
          c.expectedOutcome === null ? 'unknown' : c.expectedOutcome === e.outcome ? 'ok' : 'bad'
        place(c, 'orch', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: e.outcome === 'failed' || e.outcome === 'abandoned' ? 'error' : 'orch',
          head: 'left',
          text: `${e.outcome}${c.expectedOutcome ? ` (expected ${c.expectedOutcome})` : ''} · ${fmt(rel)}`,
          mark: ok,
          customerId: e.customerId,
        })
        break
      }
      case 'manager.reviewed':
        place(c, 'eval', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'eval',
          head: 'review',
          text: `${e.verdict}${e.issues.length ? ` · ${e.issues.map((i) => i.replace(/_/g, ' ')).join(', ')}` : ''}`,
          detail: `${e.summary} (${e.modelSpec})`,
          mark: e.verdict === 'ok' ? 'ok' : e.verdict === 'concern' ? 'warn' : 'bad',
          latencyMs: e.latencyMs,
          agentId: 'manager-1',
        })
        break
      case 'judge.verdict': {
        const a = e.answers
        place(c, 'eval', {
          seq: e.seq,
          t: e.t,
          atMs: rel,
          layer: 'eval',
          head: 'judge',
          text: `correct ${Math.round(a.correct.probability * 100)}% · refusal ${Math.round(a.refusalAppropriate.probability * 100)}% · help ${a.helpfulness.score}/5 · tone ${a.tone.score}/5 · tools ${a.toolUseQuality.score}/5`,
          detail: e.judgeSpec,
          mark: a.correct.probability >= 0.5 ? 'ok' : 'bad',
          latencyMs: e.latencyMs,
          agentId: 'judge-1',
        })
        break
      }
      default:
        break
    }
  }

  for (const e of events) {
    if (e.type === 'run.started') runStatus = 'running'
    else if (e.type === 'run.finished') runStatus = 'finished'
    else if (e.type === 'run.failed') runStatus = 'failed'
    if (!e.txId) {
      if ('agentId' in e && typeof e.agentId === 'string' && e.type !== 'agent.spawned') {
        // a barista working before its claim binds it to a visit: hold until we know which column
        const list = pending.get(e.agentId) ?? []
        list.push(e)
        pending.set(e.agentId, list)
      } else if (e.type === 'agent.spawned') {
        shift.push({
          seq: e.seq,
          t: e.t,
          atMs: 0,
          layer: 'agent',
          head: e.agentId,
          text: `${e.name} · ${e.role} · ${e.modelSpec}`,
          agentId: e.agentId,
        })
      } else if (e.type === 'run.started') {
        shift.push({
          seq: e.seq,
          t: e.t,
          atMs: 0,
          layer: 'orch',
          head: 'run',
          text: `${e.config.name} · ${e.config.scenarioIds.length} items · ${e.config.orchestrator}`,
        })
      } else if (e.type === 'run.finished') {
        shift.push({
          seq: e.seq,
          t: e.t,
          atMs: 0,
          layer: 'eval',
          head: 'done',
          text: `${e.summary.succeeded}/${e.summary.transactions} passed · $${e.summary.costUsd.toFixed(4)}`,
        })
      } else if (e.type === 'run.failed') {
        shift.push({
          seq: e.seq,
          t: e.t,
          atMs: 0,
          layer: 'error',
          head: 'failed',
          text: e.error,
          mark: 'bad',
        })
      }
      continue
    }
    let c = col(e.txId)
    if (!c) {
      c = {
        txId: e.txId,
        index: columns.length,
        scenarioId: '',
        name: '',
        expectedOutcome: null,
        outcome: null,
        bands: { input: [], orch: [], work: [], eval: [] },
      }
      columns.push(c)
      byTx.set(e.txId, c)
      startOf.set(e.txId, e.t)
    }
    if ('agentId' in e && typeof e.agentId === 'string') {
      const held = pending.get(e.agentId)
      if (held?.length) {
        for (const h of held) handle(h, c)
        pending.delete(e.agentId)
      }
    }
    handle(e, c)
  }
  // anything still held (a barista that never claimed) goes to the shift strip
  for (const [agentId, list] of pending)
    for (const e of list)
      if (e.type === 'agent.tool_called')
        shift.push({
          seq: e.seq,
          t: e.t,
          atMs: 0,
          layer: 'tool',
          head: e.tool,
          text: `${agentId} (no visit)`,
          agentId,
          indent: true,
        })
  return { columns, shift, runStatus }
}

const short = (tool: string) => tool.replace(/^[a-z]+\./, '')
const itemsText = (
  items: Array<{ quantity: number; size: string; name: string }>,
  totalCents: number,
) =>
  `${items.map((i) => `${i.quantity}× ${i.size} ${i.name}`).join(', ')} · $${(totalCents / 100).toFixed(2)}`
export const fmt = (ms: number) =>
  ms < 1000
    ? `${Math.round(ms)}ms`
    : ms < 60_000
      ? `${(ms / 1000).toFixed(1)}s`
      : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
