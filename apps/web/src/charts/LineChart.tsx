import { useRef, useState } from 'react'
import { labelledTicks, linear, niceTicks } from './scale.js'
import { TooltipLayer, useTooltip } from './Tooltip.js'
import { useWidth } from './useSize.js'

export interface LinePoint {
  x: number
  y: number
  label?: string | undefined
}

export interface LineSeries {
  name: string
  color: string
  points: LinePoint[]
}

/**
 * 2px lines with 8px markers, a crosshair on hover that snaps to the nearest x
 * and reports every series there. One y axis: series must share a unit.
 */
export function LineChart({
  series,
  xLabel,
  formatY = (v) => String(v),
  formatX = (v) => String(v),
  height = 180,
  step = false,
}: {
  series: LineSeries[]
  xLabel?: string
  formatY?: (v: number) => string
  formatX?: (v: number) => string
  height?: number
  /** Draw as a step function (cumulative totals). */
  step?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const { tip, show, hide } = useTooltip()
  const [hoverX, setHoverX] = useState<number | null>(null)
  const m = { left: 52, right: 12, top: 10, bottom: 26 }
  const plotW = Math.max(60, width - m.left - m.right)
  const plotH = height - m.top - m.bottom
  const xs = series.flatMap((s) => s.points.map((p) => p.x))
  const ys = series.flatMap((s) => s.points.map((p) => p.y))
  const xMin = xs.length ? Math.min(...xs) : 0
  const xMax = xs.length ? Math.max(...xs) : 1
  const yMax = Math.max(1e-9, ...ys)
  const x = linear([xMin, xMax === xMin ? xMin + 1 : xMax], [m.left, m.left + plotW])
  const y = linear([0, yMax * 1.08], [m.top + plotH, m.top])
  const path = (pts: LinePoint[]) =>
    pts
      .map((p, i) => {
        if (i === 0) return `M${x(p.x)},${y(p.y)}`
        return step ? `H${x(p.x)}V${y(p.y)}` : `L${x(p.x)},${y(p.y)}`
      })
      .join(' ')
  const nearest = (px: number) => {
    let best: number | null = null
    let dist = Number.POSITIVE_INFINITY
    for (const v of new Set(xs)) {
      const d = Math.abs(x(v) - px)
      if (d < dist) {
        dist = d
        best = v
      }
    }
    return best
  }
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Line chart">
        {labelledTicks(niceTicks(0, yMax, 4), formatY).map(({ v: t, label }) => (
          <g key={t} className="grid">
            <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} />
            <text x={m.left - 6} y={y(t) + 4} textAnchor="end">
              {label}
            </text>
          </g>
        ))}
        {labelledTicks(niceTicks(xMin, xMax, Math.min(8, Math.max(2, xs.length))), formatX).map(
          ({ v: t, label }) => (
            <text key={t} className="axis-x" x={x(t)} y={height - 8} textAnchor="middle">
              {label}
            </text>
          ),
        )}
        {xLabel && (
          <text className="axis-title" x={m.left + plotW} y={height - 8} textAnchor="end">
            {xLabel}
          </text>
        )}
        {series.map((s) => (
          <g key={s.name}>
            <path className="line" d={path(s.points)} stroke={s.color} />
            {s.points.map((p) => (
              <circle
                key={p.x}
                className={`marker ${hoverX === p.x ? 'on' : ''}`}
                cx={x(p.x)}
                cy={y(p.y)}
                r={hoverX === p.x ? 5 : 3.5}
                fill={s.color}
              />
            ))}
          </g>
        ))}
        {hoverX !== null && (
          <line className="crosshair" x1={x(hoverX)} x2={x(hoverX)} y1={m.top} y2={m.top + plotH} />
        )}
        <rect
          className="hit"
          x={m.left}
          y={m.top}
          width={plotW}
          height={plotH}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
            const v = nearest(e.clientX - r.left + m.left)
            setHoverX(v)
            if (v === null) return
            show(
              e,
              <span>
                <b>{series[0]?.points.find((p) => p.x === v)?.label ?? formatX(v)}</b>
                {series.map((s) => {
                  const p = s.points.find((q) => q.x === v)
                  return p ? (
                    <span key={s.name} className="tip-row">
                      <i style={{ background: s.color }} />
                      {s.name}: {formatY(p.y)}
                    </span>
                  ) : null
                })}
              </span>,
            )
          }}
          onMouseLeave={() => {
            setHoverX(null)
            hide()
          }}
        />
      </svg>
      <TooltipLayer tip={tip} width={width} />
    </div>
  )
}
