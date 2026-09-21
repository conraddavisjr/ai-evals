/**
 * The words the UI uses for the moving parts. Underneath the cafe metaphor these
 * are sub-agents with tool slices, an orchestration layer and a judge, and that is
 * how they are labelled now; the cafe role stays in parentheses so the events,
 * the scenes and the docs (which still say cashier and barista) line up.
 *
 * Every label the UI prints for a role or an agent id goes through here. Change
 * the mapping, change every panel.
 */

export type RoleKey = 'cashier' | 'barista' | 'manager' | 'judge' | 'customer'

const ROLE: Record<RoleKey, { short: string; legacy: string | null }> = {
  cashier: { short: 'agent 1', legacy: 'cashier' },
  barista: { short: 'agent 2', legacy: 'barista' },
  manager: { short: 'orchestrator', legacy: 'manager' },
  judge: { short: 'judge', legacy: null },
  customer: { short: 'customer', legacy: null },
}

/** "agent 1 (cashier)", "orchestrator (manager)", "judge". */
export function roleLabel(role: string): string {
  const r = ROLE[role as RoleKey]
  if (!r) return role
  return r.legacy ? `${r.short} (${r.legacy})` : r.short
}

/** "agent 1", "orchestrator": for tight spots like chart rows and legends. */
export function roleShort(role: string): string {
  return ROLE[role as RoleKey]?.short ?? role
}

/** "agent 1 (cashier-1)": the class in front, the instance id in parentheses. */
export function agentLabel(agentId: string): string {
  const m = /^(cashier|barista|manager|judge)-(\d+)$/.exec(agentId)
  if (!m) return agentId
  const r = ROLE[m[1] as RoleKey]
  return `${r.short} (${agentId})`
}

export function isAgentId(id: string | null | undefined): boolean {
  return !!id && /^(cashier|barista|manager|judge)-\d+$/.test(id)
}

/** Plural counts: "2 × agent 1 (cashiers)". */
export function roleCount(role: 'cashier' | 'barista', n: number): string {
  const r = ROLE[role]
  return `${n} × ${r.short} (${r.legacy}${n === 1 ? '' : 's'})`
}

/**
 * What a model spec actually is, in words, so "mock:manager (base)" never leaves
 * anyone guessing which technology answered. Mirrors packages/models/src/registry.ts.
 */
export function describeSpec(spec: string): string {
  if (!spec) return ''
  if (spec.startsWith('mock:')) return 'deterministic mock: scripted rules, no model call, free'
  if (spec === 'gateway:typesafe-ai/jev' || spec.startsWith('gateway:typesafe-ai/jev'))
    return 'TypeSafe Jev (decision model) via the Vercel AI Gateway'
  if (spec.startsWith('gateway:'))
    return `${spec.slice('gateway:'.length)} via the Vercel AI Gateway`
  if (spec.startsWith('anthropic/'))
    return `Anthropic ${spec.slice('anthropic/'.length)}, direct API`
  if (spec.startsWith('openai/')) return `OpenAI ${spec.slice('openai/'.length)}, direct API`
  if (spec.startsWith('google/')) return `Google ${spec.slice('google/'.length)}, direct API`
  if (spec.startsWith('ollama/'))
    return `${spec.slice('ollama/'.length)} on a local OpenAI-compatible server (Ollama)`
  return spec
}
