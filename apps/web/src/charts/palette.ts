/**
 * Chart colours for the dark panel surface (#10262f). These are darker steps of the
 * app's hues so marks sit in the OKLCH lightness band that reads on a dark
 * surface; validated with the dataviz palette checks (CVD-safe adjacent pairs).
 * Colour follows the entity: a role always gets the same hue, never its rank.
 */
export const SERIES = {
  gold: '#b58c36',
  water: '#3597bf',
  copper: '#c9764a',
  lavender: '#9478d0',
  moss: '#5f9a52',
} as const

/** Reserved status colour: errors only, always beside a label or glyph. */
export const STATUS_BAD = '#d9584f'

export const ROLE_COLOR: Record<string, string> = {
  cashier: SERIES.moss,
  barista: SERIES.copper,
  manager: SERIES.gold,
  judge: SERIES.lavender,
  customer: SERIES.water,
}

/** Fixed order for anything without an entity colour (never cycled past five: fold into "other"). */
export const CATEGORICAL = [
  SERIES.gold,
  SERIES.water,
  SERIES.copper,
  SERIES.lavender,
  SERIES.moss,
] as const

export const roleColor = (role: string | null | undefined): string =>
  (role && ROLE_COLOR[role]) || SERIES.water
