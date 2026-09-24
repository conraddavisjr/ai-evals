import type { Beat, TransactionTimeline } from '@cafe/protocol'
import { fmtMs } from '../format.js'
import { words } from '../lib/nomenclature.js'

export const BEAT_COLORS: Record<Beat, string> = {
  arrive: '#5f7a8a',
  order_taken: '#7fb069',
  queued: '#ffd27a',
  making: '#d28a5a',
  called_out: '#37a3c9',
  left: '#5f7a8a',
  judged: '#b79bea',
}
/** The active domain's word for a beat: "barista" in the cafe, "fulfilment" at the support desk. */
export const beatLabel = (b: string): string => (words().beats as Record<string, string>)[b] ?? b

/** A tiny flame-chart of one visit: where did the time go? */
export function OrderWaterfall({
  tl,
  now,
  compact = false,
}: {
  tl: TransactionTimeline
  now?: number
  compact?: boolean
}) {
  const total = tl.totalMs ?? (now !== undefined ? Math.max(1, now - tl.startT) : 1)
  return (
    <div className={`waterfall ${compact ? 'compact' : ''}`} title={`${fmtMs(total)} total`}>
      <div className="bar">
        {tl.beats.map((b) => {
          const dur = b.durationMs ?? (now !== undefined ? Math.max(0, now - b.startT) : 0)
          const w = (dur / total) * 100
          return (
            <div
              key={b.beat}
              className={`seg ${b.endT === null ? 'open' : ''}`}
              style={{ width: `${w}%`, background: BEAT_COLORS[b.beat] }}
              title={`${beatLabel(b.beat)}: ${fmtMs(dur)} (${w.toFixed(0)}%)`}
            />
          )
        })}
      </div>
      {!compact && (
        <div className="legend">
          {tl.beats.map((b) => {
            const dur = b.durationMs ?? (now !== undefined ? Math.max(0, now - b.startT) : 0)
            const p = (dur / total) * 100
            return (
              <span key={b.beat}>
                <i style={{ background: BEAT_COLORS[b.beat] }} /> {beatLabel(b.beat)} {fmtMs(dur)}{' '}
                <em>({p.toFixed(0)}%)</em>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
