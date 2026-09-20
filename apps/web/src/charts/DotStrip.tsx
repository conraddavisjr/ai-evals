import { useRef } from 'react'
import { fmtMs } from '../format.js'
import { STATUS_BAD } from './palette.js'
import { band, extent, linear, log } from './scale.js'
import { TooltipLayer, useTooltip } from './Tooltip.js'
import { useWidth } from './useSize.js'

export interface DotStripGroup {
  label: string
  samples: number[]
  p50: number
  p95: number
  color: string
  /** Extra detail for the tooltip and the right-hand annotation (e.g. "2 errors"). */
  note?: string | undefined
  noteBad?: boolean | undefined
}

/**
 * One row per category, every sample as a dot, p50 as a filled tick and p95 as an
 * outline tick. Latency distributions read better as points than as boxes when
 * n is small, which it usually is per tool.
 */
export function DotStrip({
  groups,
  format = fmtMs,
  scale = 'log',
  rowHeight = 22,
}: {
  groups: DotStripGroup[]
  format?: (v: number) => string
  scale?: 'log' | 'linear'
  rowHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const { tip, show, hide } = useTooltip()
  const labelW = Math.min(150, Math.max(70, ...groups.map((g) => g.label.length * 6.6 + 10)))
  const noteW = Math.min(
    150,
    Math.max(8, ...groups.map((g) => (g.note ? g.note.length * 6.2 + 20 : 0))),
  )
  const m = { left: labelW, right: noteW, top: 6, bottom: 20 }
  const plotW = Math.max(60, width - m.left - m.right)
  const height = m.top + groups.length * rowHeight + m.bottom
  const all = groups.flatMap((g) => g.samples)
  const [lo, hi] = extent(all, [1, 1000])
  const x =
    scale === 'log'
      ? log([Math.max(1, lo * 0.8), hi * 1.15], [m.left, m.left + plotW])
      : linear([0, hi * 1.1], [m.left, m.left + plotW])
  const rows = band(groups.length, [m.top, m.top + groups.length * rowHeight], 0)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Latency distribution">
        {x.ticks().map((t) => (
          <g key={t} className="grid">
            <line x1={x(t)} x2={x(t)} y1={m.top} y2={m.top + groups.length * rowHeight} />
            <text x={x(t)} y={height - 5} textAnchor="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {groups.map((g, i) => {
          const cy = rows.center(i)
          return (
            <g key={g.label}>
              <text className="row-label" x={m.left - 8} y={cy + 4} textAnchor="end">
                {g.label}
              </text>
              {dedupe(g.samples).map(([v, j]) => (
                <circle
                  key={v}
                  className="dot"
                  cx={x(v)}
                  cy={cy + (((j * 7919) % 9) - 4) * 0.9}
                  r={3.5}
                  fill={g.color}
                  onMouseEnter={(e) => show(e, <span>{format(v)}</span>)}
                  onMouseLeave={hide}
                />
              ))}
              <line
                className="tick-p50"
                x1={x(g.p50)}
                x2={x(g.p50)}
                y1={cy - 8}
                y2={cy + 8}
                stroke={g.color}
              />
              <line
                className="tick-p95"
                x1={x(g.p95)}
                x2={x(g.p95)}
                y1={cy - 8}
                y2={cy + 8}
                stroke={g.color}
              />
              {g.note && (
                <text
                  className={`row-note ${g.noteBad ? 'bad' : ''}`}
                  x={m.left + plotW + 8}
                  y={cy + 4}
                  fill={g.noteBad ? STATUS_BAD : undefined}
                >
                  {g.noteBad ? '! ' : ''}
                  {g.note}
                </text>
              )}
              <rect
                className="hit"
                x={m.left}
                y={cy - rowHeight / 2}
                width={plotW}
                height={rowHeight}
                onMouseEnter={(e) =>
                  show(
                    e,
                    <span>
                      <b>{g.label}</b> · n {g.samples.length} · p50 {format(g.p50)} · p95{' '}
                      {format(g.p95)}
                      {g.note ? ` · ${g.note}` : ''}
                    </span>,
                  )
                }
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

/** Samples with their original index, one dot per distinct value (identical values would overlap anyway). */
function dedupe(samples: number[]): Array<[number, number]> {
  const seen = new Map<number, number>()
  samples.forEach((v, i) => {
    if (!seen.has(v)) seen.set(v, i)
  })
  return [...seen.entries()]
}
