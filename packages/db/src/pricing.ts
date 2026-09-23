import type { OrderItem } from '@cafe/protocol'
import type { MenuItemRow } from './store.js'

export class PricingError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_size' | 'unknown_modifier' | 'unavailable',
  ) {
    super(message)
  }
}

/** Price one order line from the catalog row. Throws for sizes/modifiers the menu does not offer. */
export function priceLine(
  item: MenuItemRow,
  opts: {
    size?: string | undefined
    modifiers?: string[] | undefined
    quantity?: number | undefined
  },
): OrderItem {
  if (!item.available) throw new PricingError(`${item.name} is not available today`, 'unavailable')
  const size = (opts.size ?? 'medium') as NonNullable<OrderItem['size']>
  const sizeDelta = item.sizeDeltaCents[size]
  if (sizeDelta === undefined)
    throw new PricingError(`${item.name} does not come in size "${size}"`, 'unknown_size')
  const modifiers = (opts.modifiers ?? []).map((m) => m.trim().toLowerCase())
  let modTotal = 0
  for (const m of modifiers) {
    const delta = item.modifiers[m]
    if (delta === undefined)
      throw new PricingError(`"${m}" is not an option for ${item.name}`, 'unknown_modifier')
    modTotal += delta
  }
  return {
    menuItemId: item.id,
    name: item.name,
    size,
    modifiers,
    quantity: opts.quantity ?? 1,
    unitPriceCents: item.basePriceCents + sizeDelta + modTotal,
  }
}

export const orderTotalCents = (items: OrderItem[]): number =>
  items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0)
