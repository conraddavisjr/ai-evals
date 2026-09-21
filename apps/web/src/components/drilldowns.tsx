import type { RunMetrics, RunTelemetry, SpanSummary, TransactionMetrics } from '@cafe/protocol'
import { shortScenarioId } from '@cafe/protocol'
import { useEffect, useState } from 'react'
import { fmtMs, fmtUsd, pct } from '../format.js'
import type { ExperimentClient } from '../harness/index.js'
import { AgentGlyph } from '../lib/AgentGlyph.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'

/** Seek the stage to an event and hold there; every drill-down's "jump" does this. */
export function jumpTo(player: TimelinePlayer, seq: number) {
  player.seekToSeq(seq)
  player.pause()
}

/** The event that opened a visit, for jumping to a transaction. */
export function arrivalSeq(player: TimelinePlayer, txId: string): number | null {
  const e = player.events.find((x) => x.txId === txId && x.type === 'customer.arrived')
  return e?.seq ?? null
}

/**
 * Behind a latency row: the slowest spans of that tool or step, with where they
 * happened and a jump into the trace.
 */
export function LatencyDrill({
  api,
  runId,
  player,
  kind,
  stats,
  filter,
  items,
}: {
  api: ExperimentClient
  runId: string
  player: TimelinePlayer | null
  kind: 'tool' | 'step'
  stats: { count: number; p50: number; p95: number; p99: number; max: number; mean: number }
  /** Which spans of that kind belong to this row. */
  filter: (s: SpanSummary) => boolean
  items: RunTelemetry['items']
}) {
  const [rows, setRows] = useState<SpanSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api
      .spans(runId, { kinds: [kind], limit: 20_000 })
      .then((all) => setRows(all.filter(filter).sort((a, b) => b.durationMs - a.durationMs)))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [api, runId, kind, filter])
  const scenarioOf = (txId: string | null) =>
    txId ? (items.find((i) => i.txId === txId)?.scenarioId ?? null) : null
  const seqFor = (s: SpanSummary): number | null => {
    if (!player) return null
    if (kind === 'tool') {
      const callId = s.attributes['cafe.call_id']
      const e = player.events.find((x) => x.type === 'agent.tool_called' && x.callId === callId)
      return e?.seq ?? null
    }
    const step = Number(s.attributes['cafe.step'])
    const e = player.events.find(
      (x) =>
        x.type === 'agent.thinking' &&
        x.agentId === s.agentId &&
        x.step === step &&
        x.txId === (s.txId ?? undefined),
    )
    return e?.seq ?? null
  }
  return (
    <div>
      <p className="explain">
        {kind === 'tool'
          ? 'Every call to this tool in the run, slowest first. Latency is measured inside the gateway: scope check, chaos, handler. Jump opens the trace at that call.'
          : 'Every model step at this position in a turn, slowest first: the time the model took to answer, excluding tool execution. Jump opens the trace at that step.'}
      </p>
      <div className="stat-row">
        <span>
          n <b>{stats.count}</b>
        </span>
        <span>
          p50 <b>{fmtMs(stats.p50)}</b>
        </span>
        <span>
          p95 <b>{fmtMs(stats.p95)}</b>
        </span>
        <span>
          p99 <b>{fmtMs(stats.p99)}</b>
        </span>
        <span>
          max <b>{fmtMs(stats.max)}</b>
        </span>
        <span>
          mean <b>{fmtMs(stats.mean)}</b>
        </span>
      </div>
      {err && <p className="bad">{err}</p>}
      {!rows ? (
        <p className="muted">Loading spans…</p>
      ) : (
        <div className="table-scroll">
          <table className="grid small">
            <thead>
              <tr>
                <th>latency</th>
                <th>visit</th>
                <th>agent</th>
                <th>{kind === 'tool' ? 'result' : 'tokens'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((s) => {
                const seq = seqFor(s)
                const over = s.durationMs >= stats.p95
                return (
                  <tr key={s.spanId} className={s.status === 'error' ? 'bad' : ''}>
                    <td className={over ? 'mono' : ''} title={over ? 'at or above p95' : undefined}>
                      {over ? '▲ ' : ''}
                      {fmtMs(s.durationMs)}
                    </td>
                    <td>
                      {s.txId ? shortScenarioId(scenarioOf(s.txId) ?? s.txId.slice(-6)) : '–'}
                    </td>
                    <td>
                      {s.agentId && <AgentGlyph />}
                      {s.agentId ?? s.role ?? '–'}
                      {kind === 'step' ? ` · step ${String(s.attributes['cafe.step'] ?? '')}` : ''}
                    </td>
                    <td
                      title={
                        typeof s.attributes['exception.message'] === 'string'
                          ? (s.attributes['exception.message'] as string)
                          : undefined
                      }
                    >
                      {kind === 'tool'
                        ? s.status === 'error'
                          ? `✗ ${String(s.attributes['cafe.tool_code'] ?? 'error')}`
                          : '✓'
                        : `${s.inputTokens ?? 0} in / ${s.outputTokens ?? 0} out`}
                    </td>
                    <td>
                      {seq !== null && player && (
                        <button type="button" className="jump" onClick={() => jumpTo(player, seq)}>
                          jump
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const JUDGE_EXPLAIN: Record<string, { title: string; text: string }> = {
  correct: {
    title: 'P(correct)',
    text: 'The judge answers "was this visit handled correctly?" with a probability, not a tally. 95% means it is confident but not certain; the missing 5% is its own doubt, not a share that went anywhere. The run figure is the mean over visits, so the gaps are the visits it doubted most.',
  },
  refusalAppropriate: {
    title: 'P(refusal appropriate)',
    text: 'For every visit the judge estimates whether refusing (or serving) was the right call. It is asked even when nothing was refused, so a served visit scores on "was it right not to refuse". The mean hides which visits it was unsure about; they are listed here.',
  },
  helpfulness: {
    title: 'Helpfulness',
    text: 'A 1 to 5 score per visit (very poor to excellent). The run figure is the mean; the distribution and the lowest-scored visits are here.',
  },
  tone: {
    title: 'Tone',
    text: 'A 1 to 5 score per visit for how the staff spoke to the customer. Mean over visits.',
  },
  toolUseQuality: {
    title: 'Tool use quality',
    text: 'A 1 to 5 score per visit for whether the staff used the right tools in a sensible order. Mean over visits; scope violations and errors pull it down.',
  },
}

const judgeValue = (t: TransactionMetrics, key: string): number | null => {
  const j = t.judge
  if (!j) return null
  if (key === 'correct') return j.correct.probability
  if (key === 'refusalAppropriate') return j.refusalAppropriate.probability
  if (key === 'helpfulness') return j.helpfulness.score
  if (key === 'tone') return j.tone.score
  if (key === 'toolUseQuality') return j.toolUseQuality.score
  return null
}

/** Behind a judge mean: where the gaps are, visit by visit. */
export function JudgeDrill({
  metrics,
  metric,
  player,
}: {
  metrics: RunMetrics
  metric: keyof typeof JUDGE_EXPLAIN
  player: TimelinePlayer | null
}) {
  const info = JUDGE_EXPLAIN[metric]
  const isProb = metric === 'correct' || metric === 'refusalAppropriate'
  const rows = metrics.perTransaction
    .map((t) => ({ t, v: judgeValue(t, metric) }))
    .filter((r): r is { t: TransactionMetrics; v: number } => r.v !== null)
    .sort((a, b) => a.v - b.v)
  const mean = rows.length ? rows.reduce((a, r) => a + r.v, 0) / rows.length : null
  const hist = isProb
    ? null
    : [1, 2, 3, 4, 5].map((s) => ({ s, n: rows.filter((r) => r.v === s).length }))
  return (
    <div>
      <p className="explain">{info?.text}</p>
      <div className="stat-row">
        <span>
          visits judged <b>{rows.length}</b>
        </span>
        <span>
          mean <b>{mean === null ? '–' : isProb ? pct(mean) : `${mean.toFixed(2)}/5`}</b>
        </span>
        {isProb && (
          <span>
            below 50% <b>{rows.filter((r) => r.v < 0.5).length}</b>
          </span>
        )}
      </div>
      {hist && (
        <div className="stat-row">
          {hist.map((h) => (
            <span key={h.s}>
              {h.s}/5 <b>{h.n}</b>
            </span>
          ))}
        </div>
      )}
      <h4>Visits, lowest first</h4>
      <div className="table-scroll">
        <table className="grid small">
          <thead>
            <tr>
              <th>{isProb ? 'p' : 'score'}</th>
              <th>visit</th>
              <th>outcome</th>
              <th>ground truth</th>
              <th>review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, v }) => {
              const seq = player ? arrivalSeq(player, t.txId) : null
              return (
                <tr key={t.txId} className={(isProb ? v < 0.5 : v <= 2) ? 'bad' : ''}>
                  <td>{isProb ? pct(v) : `${v}/5`}</td>
                  <td>{shortScenarioId(t.scenarioId)}</td>
                  <td>{t.outcome ?? '–'}</td>
                  <td title={t.taskSuccessReasons.join('; ')}>
                    {t.taskSuccess ? '✓ pass' : `✗ ${t.taskSuccessReasons[0] ?? 'fail'}`}
                  </td>
                  <td>
                    {t.review
                      ? `${t.review.verdict}${t.review.issues.length ? ` · ${t.review.issues.map((i) => i.replace(/_/g, ' ')).join(', ')}` : ''}`
                      : '–'}
                  </td>
                  <td>
                    {seq !== null && player && (
                      <button type="button" className="jump" onClick={() => jumpTo(player, seq)}>
                        jump
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Cost of this run's judging:{' '}
        {fmtUsd(metrics.perTransaction.reduce((a, t) => a + t.costUsd, 0))} across all roles.
      </p>
    </div>
  )
}

export { JUDGE_EXPLAIN }
