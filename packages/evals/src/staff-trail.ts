import type { CafeEvent } from '@cafe/protocol'

export interface StaffStep {
  tool: string
  args: Record<string, unknown>
  ok: boolean
  latencyMs: number
  error?: string | undefined
}

/** Everything one member of staff did during a visit, in order. */
export interface StaffActivity {
  agentId: string
  role: string
  modelSpec: string | null
  steps: StaffStep[]
  said: string[]
  errors: string[]
  scopeViolations: number
  /** Model steps (one per LLM call) and their latencies, from model.usage. */
  modelSteps: number
  modelLatenciesMs: number[]
}

/**
 * Group a visit's events by agent. The judge blinds the result (roles only), the
 * manager review reads it unblinded; both must see the same tool trail.
 */
export function staffActivity(events: CafeEvent[]): StaffActivity[] {
  const evs = [...events].sort((a, b) => a.seq - b.seq)
  const byAgent = new Map<
    string,
    StaffActivity & { calls: Map<string, { tool: string; args: Record<string, unknown> }> }
  >()
  for (const e of evs) {
    if (!('agentId' in e) || typeof e.agentId !== 'string' || e.role === 'customer') continue
    let a = byAgent.get(e.agentId)
    if (!a) {
      a = {
        agentId: e.agentId,
        role: e.role,
        modelSpec: null,
        steps: [],
        said: [],
        errors: [],
        scopeViolations: 0,
        modelSteps: 0,
        modelLatenciesMs: [],
        calls: new Map(),
      }
      byAgent.set(e.agentId, a)
    }
    if (e.type === 'agent.tool_called') a.calls.set(e.callId, { tool: e.tool, args: e.args })
    else if (e.type === 'agent.tool_returned') {
      const c = a.calls.get(e.callId)
      a.steps.push({
        tool: e.tool,
        args: c?.args ?? {},
        ok: e.ok,
        latencyMs: e.latencyMs,
        error: e.ok ? undefined : e.error,
      })
    } else if (e.type === 'agent.spoke') a.said.push(e.text)
    else if (e.type === 'agent.error') a.errors.push(`${e.kind}: ${e.message}`)
    else if (e.type === 'agent.scope_violation') a.scopeViolations += 1
    else if (e.type === 'model.usage') {
      a.modelSpec = e.modelSpec
      a.modelSteps += 1
      a.modelLatenciesMs.push(e.latencyMs)
    }
  }
  return [...byAgent.values()].map(({ calls: _calls, ...a }) => a)
}

/** cashier, cashier#2, barista ... : stable labels that carry no identity. */
export function roleLabels(staff: StaffActivity[]): string[] {
  const counts = new Map<string, number>()
  return staff.map((a) => {
    const n = (counts.get(a.role) ?? 0) + 1
    counts.set(a.role, n)
    return n === 1 ? a.role : `${a.role}#${n}`
  })
}
