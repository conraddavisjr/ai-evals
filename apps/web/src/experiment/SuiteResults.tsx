import { type SuiteDetail, shortScenarioId } from '@cafe/protocol'
import { useEffect, useState } from 'react'
import { CATEGORICAL, DotStrip, Heatmap, Legend, LineChart, STATUS_BAD } from '../charts/index.js'
import { TelemetryCharts } from '../components/TelemetryPanel.js'
import { fmtMs, fmtUsd, pct } from '../format.js'
import {
  type SuiteMetricsView,
  type SuiteTelemetryView,
  useExperimentApi,
} from '../harness/index.js'
import { sentence } from '../lib/nomenclature.js'

const OUTCOME_COLOR: Record<string, string> = {
  served: '#3f7a4a',
  refused: '#7a6a2e',
  failed: '#7a3b36',
  abandoned: '#5a4a6a',
}

/**
 * The comparison: every variant's roll-up side by side, an item x variant grid
 * (pass/fail with outcome, cost, latency, judge and review on hover), then the
 * telemetry charts overlaid per variant and, on request, each variant's own set.
 */
export function SuiteResults({
  suite,
  onOpenRun,
}: {
  suite: SuiteDetail
  onOpenRun: (runId: string) => void
}) {
  const api = useExperimentApi()
  const [m, setM] = useState<SuiteMetricsView | null>(null)
  const [t, setT] = useState<SuiteTelemetryView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const live = suite.status === 'running' || suite.status === 'pending'

  useEffect(() => {
    if (!api) return
    let stop = false
    const load = () =>
      Promise.all([api.suiteMetrics(suite.id), api.suiteTelemetry(suite.id)])
        .then(([mm, tt]) => {
          if (stop) return
          setM(mm)
          setT(tt)
        })
        .catch((e) => !stop && setErr(e instanceof Error ? e.message : String(e)))
    void load()
    const id = live ? setInterval(load, 4000) : null
    return () => {
      stop = true
      if (id) clearInterval(id)
    }
  }, [api, suite.id, live])

  if (err) return <p className="bad">{err}</p>
  if (!m || !t) return <p className="muted">Loading results…</p>
  const cols = m.variants.map((v) => v.key)
  const colorOf = (i: number) => CATEGORICAL[i % CATEGORICAL.length] ?? STATUS_BAD

  return (
    <div className="suite-results">
      <h3>
        {suite.name} <span className={`pill ${suite.status}`}>{sentence(suite.status)}</span>
      </h3>

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>variant</th>
              <th>run</th>
              <th>pass</th>
              <th>refusal</th>
              <th>tool P/R</th>
              <th>scope</th>
              <th>e2e p50 / p95</th>
              <th>judge</th>
              <th>review ok/concern/esc</th>
              <th>errors</th>
              <th>cost</th>
            </tr>
          </thead>
          <tbody>
            {m.variants.map((v, i) => {
              const r = v.result
              const tel = t.variants.find((x) => x.key === v.key)?.result
              return (
                <tr key={v.key}>
                  <td>
                    <i className="swatch" style={{ background: colorOf(i) }} /> {v.key}
                  </td>
                  <td>
                    {v.runId ? (
                      <button
                        type="button"
                        className="link mono"
                        onClick={() => onOpenRun(v.runId ?? '')}
                      >
                        {v.runId.slice(-8)}
                      </button>
                    ) : (
                      <span className="muted">{v.status}</span>
                    )}
                  </td>
                  <td>{pct(r?.taskSuccessRate)}</td>
                  <td>{pct(r?.refusalAccuracy)}</td>
                  <td>
                    {pct(r?.meanToolPrecision)} / {pct(r?.meanToolRecall)}
                  </td>
                  <td>{r?.scopeViolations ?? '–'}</td>
                  <td>{r ? `${fmtMs(r.endToEnd.p50)} / ${fmtMs(r.endToEnd.p95)}` : '–'}</td>
                  <td>{r?.judgeMeans ? pct(r.judgeMeans.correct) : '–'}</td>
                  <td>
                    {r?.reviewCounts
                      ? `${r.reviewCounts.ok}/${r.reviewCounts.concern}/${r.reviewCounts.escalate}`
                      : '–'}
                  </td>
                  <td>{tel?.errors.total ?? '–'}</td>
                  <td>{r ? fmtUsd(r.costUsd) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="chart-block">
        <h4>Items × variants</h4>
        <p className="sub">
          ✓ passed ground truth, ✗ did not; colour is the outcome. Hover a cell for cost, time,
          judge and review.
        </p>
        <Heatmap
          rows={m.matrix.map((r) => r.title)}
          cols={cols}
          cellHeight={26}
          cell={(ri, ci) => {
            const row = m.matrix[ri]
            const key = cols[ci] ?? ''
            const c = row?.cells[key]
            if (!c) return { color: null, text: '' }
            return {
              color: OUTCOME_COLOR[c.outcome ?? ''] ?? '#4a5a66',
              text: `${c.taskSuccess ? '✓' : '✗'} ${c.outcome ?? '?'}`,
              bad: !c.taskSuccess,
              tip: (
                <span>
                  <b>{row?.title}</b> · {key}
                  <br />
                  {c.outcome} · {c.taskSuccess ? 'pass' : 'fail'} · {fmtMs(c.durationMs)} ·{' '}
                  {fmtUsd(c.costUsd)}
                  <br />
                  errors {c.errors} · judge{' '}
                  {c.judgeCorrect === null ? '–' : `${Math.round(c.judgeCorrect * 100)}%`} · review{' '}
                  {c.reviewVerdict ?? '–'}
                </span>
              ),
            }
          }}
        />
      </section>

      <section className="chart-block">
        <h4>Errors per item, per variant</h4>
        {t.errorMatrix.length === 0 ? (
          <div className="chart-empty">No telemetry yet.</div>
        ) : (
          <Heatmap
            rows={t.errorMatrix.map((r) => shortScenarioId(r.scenarioId))}
            cols={cols}
            cellHeight={22}
            cell={(ri, ci) => {
              const n = t.errorMatrix[ri]?.cells[cols[ci] ?? ''] ?? 0
              return {
                color: n === 0 ? '#1c3f4d' : n === 1 ? '#7a3b36' : '#9c3f38',
                text: String(n),
                bad: n > 0,
              }
            }}
          />
        )}
      </section>

      <section className="chart-block">
        <h4>Cost over the run, per variant</h4>
        {t.variants.every(
          (v) => !v.result || v.result.costTrajectory.every((c) => c.cumulativeUsd === 0),
        ) ? (
          <div className="chart-empty">All variants ran on free (mock) models.</div>
        ) : (
          <>
            <Legend items={t.variants.map((v, i) => ({ label: v.key, color: colorOf(i) }))} />
            <LineChart
              step
              series={t.variants
                .filter((v) => v.result)
                .map((v, i) => ({
                  name: v.key,
                  color: colorOf(i),
                  points: (v.result?.costTrajectory ?? []).map((c) => ({
                    x: c.visitIndex + 1,
                    y: c.cumulativeUsd,
                    label: `#${c.visitIndex + 1} ${shortScenarioId(c.scenarioId)}`,
                  })),
                }))}
              formatY={fmtUsd}
              formatX={(v) => `#${v}`}
              xLabel="case"
            />
          </>
        )}
      </section>

      <section className="chart-block">
        <h4>Tool latency, per variant</h4>
        <p className="sub">
          All tool calls pooled per variant: does one model drive the tools harder?
        </p>
        <DotStrip
          groups={t.variants
            .filter((v) => v.result)
            .map((v, i) => {
              const samples = (v.result?.tools ?? []).flatMap((x) => x.samples)
              const sorted = [...samples].sort((a, b) => a - b)
              const q = (p: number) =>
                sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
              const errors = (v.result?.tools ?? []).reduce((a, x) => a + x.errors, 0)
              return {
                label: v.key,
                samples,
                p50: q(0.5),
                p95: q(0.95),
                color: colorOf(i),
                note: errors ? `${errors} err${errors === 1 ? '' : 's'}` : undefined,
                noteBad: errors > 0,
              }
            })}
        />
      </section>

      <section className="chart-block">
        <h4>Per variant detail</h4>
        <div className="segmented">
          {t.variants.map((v) => (
            <button
              key={v.key}
              type="button"
              className={detailKey === v.key ? 'on' : ''}
              onClick={() => setDetailKey(detailKey === v.key ? null : v.key)}
            >
              {v.key}
            </button>
          ))}
        </div>
        {detailKey &&
          (() => {
            const v = t.variants.find((x) => x.key === detailKey)
            return v?.result ? (
              <TelemetryCharts data={v.result} compact />
            ) : (
              <p className="muted">No telemetry for this variant yet.</p>
            )
          })()}
      </section>
    </div>
  )
}
