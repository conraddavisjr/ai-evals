import { allTimelines, shortScenarioId } from '@cafe/protocol'
import { Fragment, useState } from 'react'
import { fmtMs } from '../format.js'
import { caseTiming, type TimingRow } from '../lib/case-timing.js'
import { CASE_NOUN, caseLabel, reviewLabel, verdictOf, verdictPill } from '../lib/nomenclature.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'

const ISSUE_LABEL: Record<string, string> = {
  wrong_result: 'wrong result',
  wasted_tool_calls: 'wasted tool calls',
  scope_breach: 'scope breach',
  unrecovered_error: 'unrecovered error',
  poor_tone: 'poor tone',
}

/** What each orchestrator review verdict means, for its tooltip. */
export const REVIEW_MEANING: Record<string, string> = {
  ok: 'The orchestrator found nothing to follow up.',
  concern:
    'The result was right, but the agents were sloppy getting there (wasted or repeated calls, errors, a skipped check). The judge scores the result, so a high judge score can sit next to a concern.',
  escalate: 'The result was wrong, a policy was breached, or something needs a person to look.',
}

/**
 * The Cases tab: one entry per golden case, in arrival order. Each shows its
 * verdict, the orchestrator's review (with why) and the judge, then a small table
 * of where the case's time went. Opening a case shows its details beside the list.
 */
export function TransactionList({
  player,
  onOpen,
  openId,
}: {
  player: TimelinePlayer
  /** Open a case's details (by its customer id) beside the list. */
  onOpen: (customerId: string) => void
  /** The case whose details are open, to highlight it. */
  openId?: string | null | undefined
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
        const verdict = state.verdicts[tl.txId]
        const review = state.reviews[tl.txId]
        const timing = caseTiming(state.applied, tl.txId)
        const title = cust?.title ?? (tl.scenarioId ? shortScenarioId(tl.scenarioId) : '')
        const open = !!cust && cust.customerId === openId
        return (
          <section
            key={tl.txId}
            className={`tx verdict-${verdictOf(tl.outcome, cust?.expected?.outcome)}${open ? ' open' : ''}`}
          >
            <div className="tx-head">
              <button
                type="button"
                className="tx-open"
                disabled={!cust}
                onClick={() => cust && onOpen(cust.customerId)}
                title={`Open ${caseLabel(index)}'s details`}
              >
                <span className="tx-case">{caseLabel(index)}</span>
                <span className="tx-title">{title}</span>
                <span className="tx-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              <VerdictPill outcome={tl.outcome} expected={cust?.expected?.outcome} />
            </div>
            <div className="tx-meta">
              <span className="mono">{fmtMs(timing.totalMs ?? tl.totalMs ?? now - tl.startT)}</span>
              {review && (
                <span title={REVIEW_MEANING[review.verdict]}>
                  <span className={`pill review-${review.verdict}`}>
                    {reviewLabel(review.verdict)}
                  </span>
                  {review.verdict !== 'ok' && (
                    <span className="muted small">
                      {' '}
                      {review.issues.length
                        ? review.issues.map((i) => ISSUE_LABEL[i] ?? i).join(', ')
                        : processNote(timing.rows)}
                    </span>
                  )}
                </span>
              )}
              {verdict && (
                <span
                  className="muted small"
                  title="The judge's confidence that the case was handled correctly"
                >
                  judge {Math.round(verdict.answers.correct.probability * 100)}% correct
                </span>
              )}
            </div>
            {timing.rows.length > 0 && <TimingTable rows={timing.rows} />}
          </section>
        )
      })}
    </div>
  )
}

/** Step, what it did, how long: an agent's row opens to its tool calls. */
function TimingTable({ rows }: { rows: TimingRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <table className="timing">
      <thead>
        <tr>
          <th>step</th>
          <th>work</th>
          <th className="num">time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const expandable = r.kind === 'agent' && r.tools.length > 0
          const isOpen = open === r.key
          return (
            <Fragment key={r.key}>
              <tr className={`kind-${r.kind}`}>
                <td>
                  {expandable ? (
                    <button
                      type="button"
                      className="link timing-toggle"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.key)}
                    >
                      <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {r.step}
                    </button>
                  ) : (
                    r.step
                  )}
                </td>
                <td className="muted">{r.detail}</td>
                <td className="num mono">{fmtMs(r.ms)}</td>
              </tr>
              {isOpen &&
                r.tools.map((t, i) => (
                  // the same tool can run twice in a row; position is part of identity here
                  // biome-ignore lint/suspicious/noArrayIndexKey: calls have no id in this view
                  <tr key={`${r.key}-${i}`} className={`tool-row${t.ok ? '' : ' bad'}`}>
                    <td>
                      <span className="mcp-tag">MCP</span> {t.tool}
                    </td>
                    <td className="muted">{t.ok ? 'ok' : 'failed'}</td>
                    <td className="num mono">{fmtMs(t.ms)}</td>
                  </tr>
                ))}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

/** Green when the case did what its golden expectation says (even a refusal), red when it deviated. */
export function VerdictPill({
  outcome,
  expected,
}: {
  outcome: string | null | undefined
  expected: string | null | undefined
}) {
  const v = verdictPill(outcome, expected)
  return (
    <span className={v.cls} title={v.title}>
      {v.text}
    </span>
  )
}

/**
 * When the review flags no specific issue, say what in the case's own trail
 * could have earned it: failed tool calls the agents recovered from.
 */
function processNote(rows: TimingRow[]): string {
  const failed = rows.flatMap((r) => (r.kind === 'agent' ? r.tools.filter((t) => !t.ok) : []))
  if (failed.length === 0) return 'no specific issue flagged'
  const names = [...new Set(failed.map((t) => t.tool))].join(', ')
  return `${failed.length} failed tool call${failed.length === 1 ? '' : 's'}, recovered (${names})`
}
