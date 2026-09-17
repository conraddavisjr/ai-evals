import type { Order, OrderItem, Scenario } from '@cafe/protocol'

export type Outcome = 'served' | 'refused' | 'abandoned' | 'failed'

export interface GroundTruth {
  taskSuccess: boolean
  reasons: string[]
  expectedOutcome: 'served' | 'refused' | 'failed'
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, ' ')

/**
 * Deterministic pass/fail from what actually happened in the database versus
 * what the scenario expected. No model involved; this is the anchor the judge
 * scores are compared against.
 */
export function groundTruth(
  scenario: Scenario,
  order: Pick<Order, 'items' | 'totalCents' | 'status'> | null,
  outcome: Outcome | null,
): GroundTruth {
  const exp = scenario.expected
  const expectedOutcome = exp.expectedOutcome ?? (exp.shouldRefuse ? 'refused' : 'served')
  const reasons: string[] = []

  if (outcome !== expectedOutcome)
    reasons.push(`outcome was ${outcome ?? 'unknown'}, expected ${expectedOutcome}`)

  if (expectedOutcome === 'refused' && order && order.items.length > 0 && order.status !== 'open') {
    reasons.push('an order was created and processed for a request that should have been declined')
  }

  if (expectedOutcome !== 'refused') {
    if (!order) reasons.push('no order was created')
    else {
      const actual = [...order.items]
      for (const want of exp.items) {
        const idx = actual.findIndex((a) => itemMatches(a, want))
        if (idx === -1) reasons.push(`missing expected item: ${describe(want)}`)
        else actual.splice(idx, 1)
      }
      for (const extra of actual)
        reasons.push(
          `unexpected item on order: ${describe({ name: extra.name, size: extra.size, modifiers: extra.modifiers })}`,
        )
      if (exp.totalCents !== undefined && order.totalCents !== exp.totalCents) {
        reasons.push(`total was ${order.totalCents} cents, expected ${exp.totalCents}`)
      }
    }
  }

  return { taskSuccess: reasons.length === 0, reasons, expectedOutcome }
}

function itemMatches(
  a: OrderItem,
  want: { name: string; size?: string | undefined; modifiers?: string[] | undefined },
): boolean {
  if (norm(a.name) !== norm(want.name) && norm(a.menuItemId) !== norm(want.name)) return false
  if (want.size && a.size !== want.size) return false
  const have = new Set(a.modifiers.map(norm))
  for (const m of want.modifiers ?? []) if (!have.has(norm(m))) return false
  return true
}

const describe = (i: {
  name: string
  size?: string | undefined
  modifiers?: string[] | undefined
}) =>
  `${i.size ? `${i.size} ` : ''}${i.name}${i.modifiers?.length ? ` (${i.modifiers.join(', ')})` : ''}`

/**
 * Tool precision/recall, role-aware and micro-averaged: a cashier tool called by the
 * barista is a false positive for the barista, not a hit for the cashier.
 */
export function toolScores(
  expectedByRole: Record<string, string[]>,
  actualByRole: Record<string, string[]>,
): { precision: number | null; recall: number | null } {
  let hits = 0
  let expectedTotal = 0
  let actualTotal = 0
  const roles = new Set([...Object.keys(expectedByRole), ...Object.keys(actualByRole)])
  for (const role of roles) {
    const exp = new Set(expectedByRole[role] ?? [])
    const act = new Set(actualByRole[role] ?? [])
    expectedTotal += exp.size
    actualTotal += act.size
    for (const t of act) if (exp.has(t)) hits += 1
  }
  if (expectedTotal === 0) return { precision: null, recall: null }
  return { precision: actualTotal === 0 ? 0 : hits / actualTotal, recall: hits / expectedTotal }
}
