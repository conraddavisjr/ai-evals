import { type DomainVocabulary, vocabularyFor } from '@cafe/protocol'

/**
 * The words the UI uses for the moving parts. Underneath any business these are
 * sub-agents with tool slices, an orchestration layer and a judge, and that is how
 * they are labelled; the domain's own word for the role (cashier, support rep)
 * stays in parentheses so the transcript and the domain's docs line up.
 *
 * Every label the UI prints for a role, an agent id, an outcome or a beat goes
 * through here, and follows the active domain (the loaded run's, else the draft's).
 */

export type RoleKey = 'cashier' | 'barista' | 'manager' | 'judge' | 'customer'

const SHORT: Record<RoleKey, string> = {
  cashier: 'agent 1',
  barista: 'agent 2',
  manager: 'orchestrator',
  judge: 'judge',
  customer: 'customer',
}

let active: DomainVocabulary = vocabularyFor('cafe')
let activeId = 'cafe'

/** Point every label at a domain's words. The app calls this when the run or the draft changes domain. */
export function setActiveDomain(id: string | null | undefined): void {
  activeId = id ?? 'cafe'
  active = vocabularyFor(activeId)
}

/** The active domain's words: business name, work item, outcomes, beats. */
export function words(): DomainVocabulary {
  return active
}

export function activeDomainId(): string {
  return activeId
}

const domainRole = (role: string): string | null =>
  role === 'cashier' || role === 'barista' || role === 'manager' ? active.roles[role] : null

/** "agent 1 (cashier)", "orchestrator (team lead)", "judge". */
export function roleLabel(role: string): string {
  const short = SHORT[role as RoleKey]
  if (!short) return role
  const own = domainRole(role)
  return own ? `${short} (${own})` : short
}

/** "agent 1", "orchestrator": for tight spots like chart rows and legends. */
export function roleShort(role: string): string {
  return SHORT[role as RoleKey] ?? role
}

/** "agent 1 (cashier 2)", "agent 2 (fulfilment 1)": the class in front, the domain's name and instance in parentheses. */
export function agentLabel(agentId: string): string {
  const m = /^(cashier|barista|manager|judge)-(\d+)$/.exec(agentId)
  if (!m) return agentId
  const role = m[1] as RoleKey
  return `${SHORT[role]} (${domainRole(role) ?? role} ${m[2]})`
}

export function isAgentId(id: string | null | undefined): boolean {
  return !!id && /^(cashier|barista|manager|judge)-\d+$/.test(id)
}

/** Counts: "2 × agent 1 (cashier)". */
export function roleCount(role: 'cashier' | 'barista', n: number): string {
  return `${n} × ${SHORT[role]} (${active.roles[role]})`
}

/** "served" in the cafe, "resolved" at the support desk. */
export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return 'in progress'
  return (active.outcomes as Record<string, string>)[outcome] ?? outcome
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

/**
 * One entry of a golden dataset, and one run of it, is a "case" everywhere in the
 * UI; the persona inside it (a customer name, a ticket author) is data, not the label.
 */
export const CASE_NOUN = { one: 'case', many: 'cases' } as const

/** "Case 3" for the third case to arrive (index is zero-based). */
export function caseLabel(index: number): string {
  return `Case ${index + 1}`
}

/** "1× medium Latte (oat milk)", "1× Refund (A1001)": a work-item line in any domain. */
export function lineText(i: {
  quantity: number
  name: string
  size?: string | undefined
  modifiers?: string[] | undefined
}): string {
  return `${i.quantity}× ${i.size ? `${i.size} ` : ''}${i.name}${i.modifiers?.length ? ` (${i.modifiers.join(', ')})` : ''}`
}

/**
 * Did the case do what its golden expectation says? Like a test: a case that was
 * expected to be refused (or to fail) and was, passes. Anything else is a deviation.
 */
export type Verdict = 'pass' | 'fail' | 'pending' | 'unknown'

export function verdictOf(
  outcome: string | null | undefined,
  expected: string | null | undefined,
): Verdict {
  if (!outcome) return 'pending'
  if (!expected) return 'unknown'
  return outcome === expected ? 'pass' : 'fail'
}

/** The pill for a case: its outcome in the domain's words, green when expected, red when not. */
export function verdictPill(
  outcome: string | null | undefined,
  expected: string | null | undefined,
): { cls: string; text: string; title: string } {
  const v = verdictOf(outcome, expected)
  const label = outcomeLabel(outcome)
  const want = expected ? `expected ${outcomeLabel(expected)}` : 'no expectation recorded'
  if (v === 'pass')
    return { cls: 'pill verdict-pass', text: `✓ ${label}`, title: `${label}, as expected` }
  if (v === 'fail')
    return { cls: 'pill verdict-fail', text: `✗ ${label}`, title: `${label}; ${want}` }
  if (v === 'unknown') return { cls: `pill ${outcome}`, text: label, title: want }
  return { cls: 'pill open', text: label, title: want }
}
