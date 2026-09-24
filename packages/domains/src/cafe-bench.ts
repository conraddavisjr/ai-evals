import { SCENARIOS } from '@cafe/evals'

/**
 * Labelled gate decisions for the cafe: each happy case's order exactly as asked
 * (approve) and the same order with one detail wrong (block). The state has the
 * shape the live gate reads when the cashier enqueues.
 */
export function cafeGateBench() {
  const items: Array<{ id: string; title: string; state: unknown; label: boolean; note: string }> =
    []
  for (const s of SCENARIOS.filter((x) => x.tags.includes('happy') && x.expected.items.length)) {
    const said = s.customer.utterances[0] ?? ''
    const lines = s.expected.items.map((i) => ({
      name: i.name,
      size: i.size ?? 'medium',
      modifiers: i.modifiers ?? [],
      quantity: 1,
    }))
    const order = (ls: typeof lines) => ({
      customerSaid: said,
      customer: s.customer.name,
      order: { status: 'paid', items: ls, totalCents: s.expected.totalCents ?? null },
    })
    items.push({
      id: `gate:${s.id}:as-asked`,
      title: `${s.title}: the order as asked`,
      state: order(lines),
      label: true,
      note: 'matches what the customer said',
    })
    const [first, ...rest] = lines
    if (!first) continue
    const wrong = first.modifiers.length
      ? { ...first, modifiers: first.modifiers.slice(1) }
      : { ...first, size: first.size === 'large' ? 'small' : 'large' }
    items.push({
      id: `gate:${s.id}:wrong`,
      title: `${s.title}: ${first.modifiers.length ? 'a modifier dropped' : 'the wrong size'}`,
      state: order([wrong, ...rest]),
      label: false,
      note: first.modifiers.length
        ? `missing ${first.modifiers[0]}`
        : `size should be ${first.size}`,
    })
  }
  return items
}
