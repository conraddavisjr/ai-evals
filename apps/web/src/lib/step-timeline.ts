import type { CafeEvent } from '@cafe/protocol'
import { agentLabel, outcomeLabel } from './nomenclature.js'

/**
 * A case, step by step, in the order things happened: when each step started
 * (from the case's arrival), who did it, and how long it took. Durations come
 * from the events themselves (a model call's or tool's latency, the wait on the
 * queue), so the Inspector can show them for any run, simulated or recorded.
 * Pure, so it is unit-tested.
 */
export type StepKind =
  | 'arrive'
  | 'router'
  | 'model'
  | 'tool'
  | 'wait'
  | 'gate'
  | 'review'
  | 'judge'
  | 'checks'
  | 'result'
  | 'error'

export interface TimelineStep {
  seq: number
  kind: StepKind
  /** Start, in ms from the case's arrival. */
  atMs: number
  /** How long the step took, when it is a span rather than a moment. */
  durationMs: number | null
  /** The agent that did it, for links; null for the router, the judge and moments. */
  agentId: string | null
  /** "agent 1 (drafter 1)", "router", "judge". */
  who: string
  /** "step 2 · claude-opus-5", "orders.create", "waiting for agent 2". */
  what: string
  ok: boolean | null
  /** Still going at `now`: its duration so far. */
  running?: boolean
}

export interface CaseTimeline {
  steps: TimelineStep[]
  /** Arrival to leaving, once the case has left. */
  totalMs: number | null
}

const shortSpec = (spec: string) =>
  spec.replace(/^(app|mock|gateway):/, '').replace(/^[a-z]+\//, '')

/** `now` (the playhead's clock) adds a row for each model step still running, with its time so far. */
export function caseTimeline(events: CafeEvent[], txId: string, now?: number): CaseTimeline {
  const own = events.filter((e) => e.txId === txId)
  const arrived = own.find((e) => e.type === 'customer.arrived')
  if (!arrived) return { steps: [], totalMs: null }
  const t0 = arrived.t
  const steps: TimelineStep[] = []
  // A span ends at its event; it started its latency earlier (never before arrival).
  const span = (e: CafeEvent, ms: number) => ({
    atMs: Math.max(0, e.t - ms - t0),
    durationMs: ms,
  })
  const moment = (e: CafeEvent) => ({ atMs: Math.max(0, e.t - t0), durationMs: null })
  const queuedAt = new Map<string, number>()
  let left: number | null = null
  // agent.thinking opens a model step; its model.usage closes it
  const open = new Map<string, { seq: number; t: number; step: number }>()

  for (const e of own) {
    switch (e.type) {
      case 'customer.arrived':
        steps.push({
          seq: e.seq,
          kind: 'arrive',
          ...moment(e),
          agentId: null,
          who: 'case',
          what: 'arrived',
          ok: null,
        })
        break
      case 'triage.decided':
        steps.push({
          seq: e.seq,
          kind: 'router',
          ...span(e, e.latencyMs),
          agentId: null,
          who: 'router',
          what: `${e.intent}${e.routed ? ' · turned away' : ''}${e.escalate ? ' · escalate' : ''}`,
          ok: e.routed ? null : true,
        })
        break
      case 'agent.thinking':
        open.set(e.agentId, { seq: e.seq, t: e.t, step: e.step })
        break
      case 'model.usage':
        open.delete(e.agentId)
        steps.push({
          seq: e.seq,
          kind: 'model',
          ...span(e, e.latencyMs),
          agentId: e.agentId,
          who: agentLabel(e.agentId),
          what: `step ${e.step} · ${shortSpec(e.modelSpec)}${e.inputTokens + e.outputTokens ? ` · ${(e.inputTokens + e.outputTokens).toLocaleString()} tokens` : ''}`,
          ok: true,
        })
        break
      case 'agent.tool_returned':
        steps.push({
          seq: e.seq,
          kind: 'tool',
          ...span(e, e.latencyMs),
          agentId: e.agentId,
          who: agentLabel(e.agentId),
          what: `${e.tool}${e.ok ? '' : ` · failed${e.error ? `: ${e.error}` : ''}`}`,
          ok: e.ok,
        })
        break
      case 'order.queued':
        queuedAt.set(e.orderId, e.t)
        break
      case 'order.claimed':
        steps.push({
          seq: e.seq,
          kind: 'wait',
          ...span(e, e.waitedMs),
          agentId: e.baristaId,
          who: agentLabel(e.baristaId),
          what: 'waiting on the queue, then claimed',
          ok: null,
        })
        break
      case 'guard.decided':
        steps.push({
          seq: e.seq,
          kind: 'gate',
          ...span(e, e.latencyMs),
          agentId: e.agentId,
          who: 'action gate',
          what: `${e.tool} · ${e.allowed ? 'allowed' : 'blocked'}`,
          ok: e.allowed,
        })
        break
      case 'agent.error':
        steps.push({
          seq: e.seq,
          kind: 'error',
          ...moment(e),
          agentId: e.agentId,
          who: agentLabel(e.agentId),
          what: `${e.kind}: ${e.message}`,
          ok: false,
        })
        break
      case 'customer.left':
        left = e.t
        steps.push({
          seq: e.seq,
          kind: 'result',
          ...moment(e),
          agentId: null,
          who: 'case',
          what: `left · ${outcomeLabel(e.outcome)}`,
          ok: e.outcome === 'failed' || e.outcome === 'abandoned' ? false : null,
        })
        break
      case 'manager.reviewed':
        steps.push({
          seq: e.seq,
          kind: 'review',
          ...span(e, e.latencyMs),
          agentId: null,
          who: 'orchestrator review',
          what: e.verdict,
          ok: e.verdict === 'ok',
        })
        break
      case 'judge.verdict':
        steps.push({
          seq: e.seq,
          kind: 'judge',
          ...span(e, e.latencyMs),
          agentId: null,
          who: 'judge',
          what: `${Object.keys(e.answers).length} answers · ${shortSpec(e.judgeSpec)}`,
          ok: null,
        })
        break
      case 'case.scored':
        steps.push({
          seq: e.seq,
          kind: 'checks',
          ...moment(e),
          agentId: null,
          who: 'checks',
          what: e.passed
            ? `all ${e.checks.length} pass`
            : `${e.checks.filter((k) => !k.ok).length} of ${e.checks.length} failed`,
          ok: e.passed,
        })
        break
      default:
        break
    }
  }
  if (now !== undefined && left === null)
    for (const [agentId, o] of open)
      steps.push({
        seq: o.seq,
        kind: 'model',
        atMs: Math.max(0, o.t - t0),
        durationMs: Math.max(0, now - o.t),
        agentId,
        who: agentLabel(agentId),
        what: `step ${o.step} · working…`,
        ok: null,
        running: true,
      })
  steps.sort((a, b) => a.atMs - b.atMs || a.seq - b.seq)
  return { steps, totalMs: left === null ? null : left - t0 }
}

/** An agent's own work across the run: its model steps and tool calls, by case. */
export interface AgentWork {
  steps: number
  modelMs: number
  tools: number
  toolMs: number
  failedTools: number
  byCase: Array<{ txId: string; steps: number; tools: number; ms: number }>
}

export function agentWork(events: CafeEvent[], agentId: string): AgentWork {
  const out: AgentWork = { steps: 0, modelMs: 0, tools: 0, toolMs: 0, failedTools: 0, byCase: [] }
  const cases = new Map<string, { txId: string; steps: number; tools: number; ms: number }>()
  const at = (tx: string | undefined) => {
    if (!tx) return null
    let c = cases.get(tx)
    if (!c) {
      c = { txId: tx, steps: 0, tools: 0, ms: 0 }
      cases.set(tx, c)
    }
    return c
  }
  for (const e of events) {
    if (e.type === 'model.usage' && e.agentId === agentId) {
      out.steps += 1
      out.modelMs += e.latencyMs
      const c = at(e.txId)
      if (c) {
        c.steps += 1
        c.ms += e.latencyMs
      }
    } else if (e.type === 'agent.tool_returned' && e.agentId === agentId) {
      out.tools += 1
      out.toolMs += e.latencyMs
      if (!e.ok) out.failedTools += 1
      const c = at(e.txId)
      if (c) {
        c.tools += 1
        c.ms += e.latencyMs
      }
    }
  }
  out.byCase = [...cases.values()]
  return out
}
