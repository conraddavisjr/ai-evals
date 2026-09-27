import { answersLine, type CafeEvent } from '@cafe/protocol'
import { agentLabel, roleLabel } from './nomenclature.js'

/**
 * Where a case's time went, as rows anyone can read: each agent's own time (its
 * model steps plus its tool calls), the wait before agent 2 picked the work up,
 * and the evaluation calls. Plain milliseconds, no percentages, no cafe beats.
 * Pure, so the Cases tab and the Metrics roll-up share it and it is unit-tested.
 */
export type TimingKind = 'router' | 'agent' | 'wait' | 'gate' | 'review' | 'judge'

export interface ToolTiming {
  tool: string
  ms: number
  ok: boolean
}

export interface TimingRow {
  /** Stable key: the agent id for agents, the kind otherwise. */
  key: string
  kind: TimingKind
  /** "agent 1 (cashier 1)", "router", "judge". */
  step: string
  /** "3 model steps · 6 tool calls". */
  detail: string
  ms: number
  /** An agent's own tool calls, in order. */
  tools: ToolTiming[]
}

export interface CaseTiming {
  rows: TimingRow[]
  /** Arrival to the case being closed, when it has closed. */
  totalMs: number | null
}

export function caseTiming(events: CafeEvent[], txId: string): CaseTiming {
  const rows = new Map<string, TimingRow>()
  const row = (key: string, kind: TimingKind, step: string): TimingRow => {
    let r = rows.get(key)
    if (!r) {
      r = { key, kind, step, detail: '', ms: 0, tools: [] }
      rows.set(key, r)
    }
    return r
  }
  const steps = new Map<string, number>()
  let arrived: number | null = null
  let left: number | null = null
  for (const e of events) {
    if (e.txId !== txId) continue
    switch (e.type) {
      case 'customer.arrived':
        arrived = e.t
        break
      case 'customer.left':
        left = e.t
        break
      case 'triage.decided': {
        const r = row('router', 'router', 'router')
        r.ms += e.latencyMs
        r.detail = `${e.intent}${e.routed ? ' · turned away' : ''}`
        break
      }
      case 'model.usage':
        if (e.role === 'cashier' || e.role === 'barista') {
          const r = row(e.agentId, 'agent', agentLabel(e.agentId))
          r.ms += e.latencyMs
          steps.set(e.agentId, (steps.get(e.agentId) ?? 0) + 1)
        }
        break
      case 'agent.tool_returned':
        if (e.role === 'cashier' || e.role === 'barista') {
          const r = row(e.agentId, 'agent', agentLabel(e.agentId))
          r.ms += e.latencyMs
          r.tools.push({ tool: e.tool, ms: e.latencyMs, ok: e.ok })
        }
        break
      case 'order.claimed': {
        const r = row('wait', 'wait', 'waiting for agent 2')
        r.ms += e.waitedMs
        r.detail = 'on the queue'
        break
      }
      case 'guard.decided': {
        const r = row('gate', 'gate', 'action gate')
        r.ms += e.latencyMs
        r.tools.push({ tool: e.tool, ms: e.latencyMs, ok: e.allowed })
        break
      }
      case 'manager.reviewed': {
        const r = row('review', 'review', 'orchestrator review')
        r.ms += e.latencyMs
        r.detail = e.verdict
        break
      }
      case 'judge.verdict': {
        const r = row('judge', 'judge', 'judge')
        r.ms += e.latencyMs
        r.detail =
          'correct' in e.answers
            ? (answersLine(e.answers).split(' · ')[0] ?? '')
            : `${Object.keys(e.answers).length} answers`
        break
      }
      default:
        break
    }
  }
  for (const r of rows.values()) {
    if (r.kind === 'agent') {
      const n = steps.get(r.key) ?? 0
      r.detail = [
        n ? `${n} step${n === 1 ? '' : 's'}` : '',
        r.tools.length ? `${r.tools.length} tool call${r.tools.length === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    } else if (r.kind === 'gate') {
      const blocked = r.tools.filter((t) => !t.ok).length
      r.detail = `${r.tools.length} check${r.tools.length === 1 ? '' : 's'}${blocked ? ` · ${blocked} blocked` : ''}`
    }
  }
  return {
    rows: [...rows.values()],
    totalMs: arrived !== null && left !== null ? left - arrived : null,
  }
}

/** The label a timing row rolls up under across cases: agents by slot, the rest by kind. */
export function timingGroup(r: TimingRow): string {
  if (r.kind !== 'agent') return r.step
  const role = r.key.split('-')[0] ?? ''
  return role === 'cashier' || role === 'barista' ? roleLabel(role) : r.step
}
