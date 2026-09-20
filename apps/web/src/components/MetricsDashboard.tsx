import type { RunMetrics } from '@cafe/protocol'
import { useEffect, useState } from 'react'
import { fmtMs, fmtUsd, pct, shortModel } from '../format.js'
import { type RunRow, useHarness } from '../harness/index.js'
import { BEAT_COLORS, BEAT_LABELS } from './OrderWaterfall.js'

export function MetricsDashboard({ runId, status }: { runId: string | null; status: string }) {
  const [metrics, setMetrics] = useState<RunMetrics | null>(null)
  const [compare, setCompare] = useState<Array<{ run: RunRow; m: RunMetrics }>>([])
  const [err, setErr] = useState<string | null>(null)
  const api = useHarness()

  useEffect(() => {
    setMetrics(null)
    setErr(null)
    if (runId && status === 'finished') {
      api
        .metrics(runId)
        .then(setMetrics)
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    }
    // the comparison table refreshes whenever the current run changes or finishes
    api
      .runs()
      .then(async (runs) => {
        const finished = runs.filter((r) => r.status === 'finished').slice(0, 8)
        const rows = await Promise.all(
          finished.map(async (run) => ({ run, m: await api.metrics(run.id).catch(() => null) })),
        )
        setCompare(rows.filter((r): r is { run: RunRow; m: RunMetrics } => r.m !== null))
      })
      .catch(() => {})
  }, [api, runId, status])

  return (
    <div className="metrics">
      {!runId && <p className="muted">Start or load a shift.</p>}
      {runId && status !== 'finished' && (
        <p className="muted">
          Metrics land when the shift closes. Watch the transactions tab for live waterfalls.
        </p>
      )}
      {err && <p className="bad">{err}</p>}
      {metrics && (
        <>
          <div className="tiles">
            <Tile
              label="task success"
              value={pct(metrics.taskSuccessRate)}
              good={metrics.taskSuccessRate >= 0.8}
            />
            <Tile
              label="failure rate"
              value={pct(metrics.failureRate)}
              good={metrics.failureRate <= 0.1}
            />
            <Tile
              label="refusal accuracy"
              value={pct(metrics.refusalAccuracy)}
              good={(metrics.refusalAccuracy ?? 1) >= 0.8}
            />
            <Tile label="tool precision" value={pct(metrics.meanToolPrecision)} />
            <Tile label="tool recall" value={pct(metrics.meanToolRecall)} />
            <Tile
              label="scope violations"
              value={String(metrics.scopeViolations)}
              good={metrics.scopeViolations === 0}
            />
            <Tile
              label="e2e p50 / p95"
              value={`${fmtMs(metrics.endToEnd.p50)} / ${fmtMs(metrics.endToEnd.p95)}`}
            />
            <Tile
              label="cost"
              value={fmtUsd(metrics.costUsd)}
              sub={`${(metrics.inputTokens + metrics.outputTokens).toLocaleString()} tokens`}
            />
          </div>

          {metrics.judgeMeans && (
            <>
              <h4>Judge (blinded)</h4>
              <table className="grid">
                <tbody>
                  <tr>
                    <th>P(correct)</th>
                    <td>{pct(metrics.judgeMeans.correct)}</td>
                    <th>refusal appropriate</th>
                    <td>{pct(metrics.judgeMeans.refusalAppropriate)}</td>
                  </tr>
                  <tr>
                    <th>helpfulness</th>
                    <td>{metrics.judgeMeans.helpfulness.toFixed(2)}/5</td>
                    <th>tone</th>
                    <td>{metrics.judgeMeans.tone.toFixed(2)}/5</td>
                  </tr>
                  <tr>
                    <th>tool use</th>
                    <td>{metrics.judgeMeans.toolUseQuality.toFixed(2)}/5</td>
                    <th />
                    <td />
                  </tr>
                </tbody>
              </table>
            </>
          )}

          <h4>Model latency by role</h4>
          <table className="grid">
            <thead>
              <tr>
                <th>role</th>
                <th>calls</th>
                <th>p50</th>
                <th>p95</th>
                <th>max</th>
                <th>mean steps / visit</th>
              </tr>
            </thead>
            <tbody>
              {(['cashier', 'barista', 'manager', 'judge'] as const).map((r) => (
                <tr key={r}>
                  <td>{r}</td>
                  <td>{metrics.latencyByRole[r].count}</td>
                  <td>{fmtMs(metrics.latencyByRole[r].p50)}</td>
                  <td>{fmtMs(metrics.latencyByRole[r].p95)}</td>
                  <td>{fmtMs(metrics.latencyByRole[r].max)}</td>
                  <td>{metrics.meanStepsByRole[r].toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Where the time goes</h4>
          <table className="grid">
            <thead>
              <tr>
                <th>beat</th>
                <th>p50</th>
                <th>p95</th>
                <th>max</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics.beatLatency).map(([b, st]) => (
                <tr key={b}>
                  <td>
                    <i
                      className="swatch"
                      style={{ background: BEAT_COLORS[b as keyof typeof BEAT_COLORS] }}
                    />{' '}
                    {BEAT_LABELS[b as keyof typeof BEAT_LABELS] ?? b}
                  </td>
                  <td>{fmtMs(st.p50)}</td>
                  <td>{fmtMs(st.p95)}</td>
                  <td>{fmtMs(st.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Per visit</h4>
          <table className="grid small">
            <thead>
              <tr>
                <th>scenario</th>
                <th>outcome</th>
                <th>pass</th>
                <th>tool P/R</th>
                <th>errors</th>
                <th>total</th>
                <th>judge</th>
                <th>cost</th>
              </tr>
            </thead>
            <tbody>
              {metrics.perTransaction.map((t) => (
                <tr key={t.txId} className={t.taskSuccess ? '' : 'bad'}>
                  <td title={t.taskSuccessReasons.join('; ')}>{t.scenarioId}</td>
                  <td>{t.outcome}</td>
                  <td>{t.taskSuccess ? '✓' : '✗'}</td>
                  <td>
                    {pct(t.toolPrecision)}/{pct(t.toolRecall)}
                  </td>
                  <td>
                    {t.errors}
                    {t.scopeViolations ? ` (+${t.scopeViolations} scope)` : ''}
                  </td>
                  <td>{fmtMs(t.totalMs)}</td>
                  <td>{t.judge ? pct(t.judge.correct.probability) : '–'}</td>
                  <td>{fmtUsd(t.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {compare.length > 1 && (
        <>
          <h4>Compare shifts</h4>
          <table className="grid small">
            <thead>
              <tr>
                <th>when</th>
                <th>cashier / barista / manager / judge</th>
                <th>n</th>
                <th>pass</th>
                <th>refusal</th>
                <th>scope</th>
                <th>e2e p50</th>
                <th>judge</th>
                <th>cost</th>
              </tr>
            </thead>
            <tbody>
              {compare.map(({ run, m }) => (
                <tr key={run.id} className={run.id === runId ? 'current' : ''}>
                  <td>{new Date(run.createdAt).toLocaleTimeString()}</td>
                  <td className="mono">
                    {(['cashier', 'barista', 'manager', 'judge'] as const)
                      .map((r) => shortModel(run.config.roles[r]).replace(/^mock:/, ''))
                      .join(' / ')}
                  </td>
                  <td>{m.transactions}</td>
                  <td>{pct(m.taskSuccessRate)}</td>
                  <td>{pct(m.refusalAccuracy)}</td>
                  <td>{m.scopeViolations}</td>
                  <td>{fmtMs(m.endToEnd.p50)}</td>
                  <td>{m.judgeMeans ? pct(m.judgeMeans.correct) : '–'}</td>
                  <td>{fmtUsd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  good,
}: {
  label: string
  value: string
  sub?: string
  good?: boolean
}) {
  return (
    <div className={`tile ${good === undefined ? '' : good ? 'good' : 'bad'}`}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}
