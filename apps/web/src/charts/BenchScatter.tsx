import { useRef } from 'react'
import { fmtMs } from '../format.js'
import { linear, log } from './scale.js'
import { TooltipLayer, useTooltip } from './Tooltip.js'
import { useWidth } from './useSize.js'

export interface BenchPoint {
  spec: string
  label: string
  color: string
  accuracy: number
  p50: number
  p95: number
  brier: number | null
  costUsd: number
}

/**
 * Accuracy against latency, one mark per model: the dot sits at the median
 * latency, the whisker runs to p95. Up and to the left is better. One y-axis
 * (accuracy); latency is log because decision models and LLMs sit orders of
 * magnitude apart.
 */
export function BenchScatter({ points, title }: { points: BenchPoint[]; title: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const { tip, show, hide } = useTooltip()
  const height = 190
  const m = { left: 42, right: 18, top: 12, bottom: 28 }
  const lo = Math.max(1, Math.min(...points.map((p) => p.p50)) * 0.6)
  const hi = Math.max(lo * 10, Math.max(...points.map((p) => p.p95)) * 1.6)
  const x = log([lo, hi], [m.left, width - m.right])
  const y = linear([0, 1], [height - m.bottom, m.top])
  const pct = (v: number) => `${Math.round(v * 100)}%`
  // direct labels sit right of the dot, or left when it is near the edge
  const labelLeft = (p: BenchPoint) => x(p.p50) > width - m.right - 120
  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${title}: accuracy against median latency per model`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t} className="grid">
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
            <text x={m.left - 6} y={y(t) + 3.5} textAnchor="end">
              {pct(t)}
            </text>
          </g>
        ))}
        {x.ticks().map((t) => (
          <text key={t} x={x(t)} y={height - 8} textAnchor="middle">
            {fmtMs(t)}
          </text>
        ))}
        {points.map((p) => {
          const cx = x(p.p50)
          const cy = y(p.accuracy)
          const tipBody = (
            <span>
              <b>{p.spec}</b>
              <br />
              accuracy {pct(p.accuracy)}
              {p.brier !== null ? ` · Brier ${p.brier.toFixed(3)}` : ''}
              <br />
              p50 {fmtMs(p.p50)} · p95 {fmtMs(p.p95)} · ${p.costUsd.toFixed(5)}
            </span>
          )
          return (
            <g key={p.spec}>
              {p.p95 > p.p50 && (
                <line
                  x1={cx}
                  x2={x(p.p95)}
                  y1={cy}
                  y2={cy}
                  stroke={p.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={0.6}
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={5.5}
                fill={p.color}
                stroke="var(--panel)"
                strokeWidth={2}
              />
              <text
                className="value-label"
                x={labelLeft(p) ? cx - 10 : cx + 10}
                y={cy - 8}
                textAnchor={labelLeft(p) ? 'end' : 'start'}
              >
                {p.label} {pct(p.accuracy)}
              </text>
              <circle
                cx={cx}
                cy={cy}
                r={14}
                fill="transparent"
                onMouseEnter={(e) => show(e, tipBody)}
                onMouseLeave={hide}
              />
            </g>
          )
        })}
      </svg>
      <TooltipLayer tip={tip} width={width} />
    </div>
  )
}
