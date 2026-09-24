import { allTimelines, shortScenarioId } from '@cafe/protocol'
import { fmtCents, fmtMs } from '../format.js'
import { CASE_NOUN, caseLabel, outcomeLabel } from '../lib/nomenclature.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import { OrderWaterfall } from './OrderWaterfall.js'

export function TransactionList({
  player,
  onSelect,
}: {
  player: TimelinePlayer
  onSelect: (id: string | null) => void
}) {
  const state = player.state
  const timelines = allTimelines(state.applied)
  const now = player.clockEpoch()
  if (timelines.length === 0)
    return (
      <p className="muted">
        No {CASE_NOUN.many} yet. Start a run and each golden case appears here as it arrives.
      </p>
    )
  return (
    <div className="tx-list">
      {timelines.map((tl, index) => {
        const cust = tl.customerId ? state.customers[tl.customerId] : undefined
        const order = tl.orderId ? state.orders[tl.orderId] : undefined
        const verdict = state.verdicts[tl.txId]
        const review = state.reviews[tl.txId]
        const arrived = state.applied.find(
          (e) => e.txId === tl.txId && e.type === 'customer.arrived',
        )
        return (
          <div key={tl.txId} className={`tx ${tl.outcome ?? 'open'}`}>
            <div className="tx-head">
              <button
                type="button"
                className="link"
                onClick={() => {
                  if (arrived) player.seekToSeq(arrived.seq)
                  player.pause()
                  if (tl.customerId) onSelect(tl.customerId)
                }}
                title={`Jump to this ${CASE_NOUN.one}${tl.customerName ? ` (persona: ${tl.customerName})` : ''}`}
              >
                {caseLabel(index)}
              </button>
              <span className="tx-title" title={tl.scenarioId ?? undefined}>
                {(arrived?.type === 'customer.arrived' && arrived.title) ||
                  (tl.scenarioId ? shortScenarioId(tl.scenarioId) : '')}
              </span>
              <span className={`pill ${tl.outcome ?? 'open'}`}>{outcomeLabel(tl.outcome)}</span>
              <span className="muted">{fmtMs(tl.totalMs ?? now - tl.startT)}</span>
              {order && <span className="muted">{fmtCents(order.totalCents)}</span>}
              {review && (
                <span
                  className={`pill review-${review.verdict}`}
                  title={`orchestrator review: ${review.summary}`}
                >
                  {review.verdict}
                </span>
              )}
              {verdict && (
                <span
                  className={`pill ${verdict.answers.correct.probability >= 0.5 ? 'served' : 'failed'}`}
                  title="judge: P(correct)"
                >
                  judge {Math.round(verdict.answers.correct.probability * 100)}%
                </span>
              )}
            </div>
            {cust?.triage && (
              <div className="muted small">
                triage: {cust.triage.intent}
                {cust.triage.escalate ? ' · escalate' : ''}
              </div>
            )}
            <OrderWaterfall tl={tl} now={now} />
          </div>
        )
      })}
    </div>
  )
}
