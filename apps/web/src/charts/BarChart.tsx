import { useRef } from 'react'
import { band, labelledTicks, linear, niceTicks } from './scale.js'
import { TooltipLayer, useTooltip } from './Tooltip.js'
import { useWidth } from './useSize.js'

export interface BarDatum {
  label: string
  /** One value, or one per series for a stacked bar (series order fixed by `series`). */
  values: number[]
  note?: string | undefined
}

export interface BarSeries {
  name: string
  color: string
}

/**
 * Horizontal bars, optionally stacked. Rounded data-ends, a 2px surface gap
 * between stacked segments, value labels only at the ends (no number on every
 * segment).
 */
export function BarChart({
  data,
  series,
  format = (v) => String(Math.round(v)),
  rowHeight = 22,
}: {
  data: BarDatum[]
  series: BarSeries[]
  format?: (v: number) => string
  rowHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const { tip, show, hide } = useTooltip()
  const labelW = Math.min(150, Math.max(70, ...data.map((d) => d.label.length * 6.6 + 10)))
  const m = { left: labelW, right: 56, top: 6, bottom: 20 }
  const plotW = Math.max(60, width - m.left - m.right)
  const height = m.top + data.length * rowHeight + m.bottom
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0))
  const max = Math.max(1e-9, ...totals)
  const x = linear([0, max * 1.05], [m.left, m.left + plotW])
  const rows = band(data.length, [m.top, m.top + data.length * rowHeight], 0.35)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Bar chart">
        {labelledTicks(niceTicks(0, max, 4), format).map(({ v: t, label }) => (
          <g key={t} className="grid">
            <line x1={x(t)} x2={x(t)} y1={m.top} y2={m.top + data.length * rowHeight} />
            <text x={x(t)} y={height - 5} textAnchor="middle">
              {label}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const y = rows.at(i)
          let acc = 0
          const total = totals[i] ?? 0
          return (
            <g key={d.label}>
              <text
                className="row-label"
                x={m.left - 8}
                y={y + rows.width / 2 + 4}
                textAnchor="end"
              >
                {d.label}
              </text>
              {d.values.map((v, s) => {
                const x0 = x(acc)
                acc += v
                const x1 = x(acc)
                const last = s === d.values.length - 1
                const w = Math.max(0, x1 - x0 - (last ? 0 : 2))
                if (w <= 0) return null
                return (
                  <rect
                    key={series[s]?.name ?? s}
                    className={`bar ${last ? 'end' : ''}`}
                    x={x0}
                    y={y}
                    width={w}
                    height={rows.width}
                    fill={series[s]?.color}
                    onMouseEnter={(e) =>
                      show(
                        e,
                        <span>
                          <b>{d.label}</b>
                          {series.length > 1 ? ` · ${series[s]?.name}` : ''} · {format(v)}
                          {d.note ? ` · ${d.note}` : ''}
                        </span>,
                      )
                    }
                    onMouseLeave={hide}
                  />
                )
              })}
              <text className="value-label" x={x(total) + 6} y={y + rows.width / 2 + 4}>
                {format(total)}
              </text>
            </g>
          )
        })}
      </svg>
      <TooltipLayer tip={tip} width={width} />
    </div>
  )
}
