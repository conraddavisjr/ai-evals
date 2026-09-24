export interface LegendItem {
  label: string
  color: string
  /** Set for a status entry so identity is never colour alone. */
  glyph?: string
}

/** Present whenever a chart has two or more series. */
export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.glyph ? `${i.glyph} ` : ''}
          {i.label}
        </span>
      ))}
    </div>
  )
}
