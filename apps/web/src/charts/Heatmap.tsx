import { type ReactNode, useRef } from 'react'
import { TooltipLayer, useTooltip } from './Tooltip.js'
import { useWidth } from './useSize.js'

export interface HeatCell {
  /** Fill colour; null renders an empty cell. */
  color: string | null
  /** Short text drawn in the cell (a glyph or a number), so identity is never colour alone. */
  text?: string | undefined
  tip?: ReactNode
  bad?: boolean | undefined
}

/**
 * Rows x columns of cells with text inside each; used for item x variant grids.
 * Cells carry a glyph or number so the grid reads in print and for CVD readers.
 */
export function Heatmap({
  rows,
  cols,
  cell,
  cellHeight = 24,
}: {
  rows: string[]
  cols: string[]
  cell: (r: number, c: number) => HeatCell
  cellHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const { tip, show, hide } = useTooltip()
  const labelW = Math.min(210, Math.max(80, ...rows.map((r) => r.length * 6.4 + 10)))
  const maxChars = Math.floor((labelW - 10) / 6.4)
  const clip = (r: string) =>
    r.length > maxChars ? `${r.slice(0, Math.max(3, maxChars - 1))}…` : r
  const headH = 28
  const plotW = Math.max(40 * cols.length, width - labelW - 8)
  const cw = plotW / Math.max(1, cols.length)
  const height = headH + rows.length * cellHeight + 4
  return (
    <div className="chart heatmap" ref={ref}>
      <svg width={Math.max(width, labelW + plotW + 8)} height={height} role="img" aria-label="Grid">
        {cols.map((c, j) => (
          <text
            key={c}
            className="col-label"
            x={labelW + j * cw + cw / 2}
            y={headH - 10}
            textAnchor="middle"
          >
            {c.length > Math.floor(cw / 6.5)
              ? `${c.slice(0, Math.max(3, Math.floor(cw / 6.5) - 1))}…`
              : c}
          </text>
        ))}
        {rows.map((r, i) => (
          <g key={r}>
            <text
              className="row-label"
              x={labelW - 8}
              y={headH + i * cellHeight + cellHeight / 2 + 4}
              textAnchor="end"
            >
              <title>{r}</title>
              {clip(r)}
            </text>
            {cols.map((c, j) => {
              const h = cell(i, j)
              return (
                <g key={c} onMouseEnter={(e) => h.tip && show(e, h.tip)} onMouseLeave={hide}>
                  <rect
                    className={`cell ${h.color ? '' : 'empty'} ${h.bad ? 'bad' : ''}`}
                    x={labelW + j * cw + 1}
                    y={headH + i * cellHeight + 1}
                    width={cw - 2}
                    height={cellHeight - 2}
                    rx={4}
                    fill={h.color ?? 'transparent'}
                  />
                  {h.text && (
                    <text
                      className="cell-text"
                      x={labelW + j * cw + cw / 2}
                      y={headH + i * cellHeight + cellHeight / 2 + 4}
                      textAnchor="middle"
                    >
                      {h.text}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
      <TooltipLayer tip={tip} width={width} />
    </div>
  )
}
