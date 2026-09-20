import { type RunTelemetry, shortScenarioId } from '@cafe/protocol'
import { useEffect, useState } from 'react'
import {
  BarChart,
  DotStrip,
  Legend,
  LineChart,
  ROLE_COLOR,
  roleColor,
  SERIES,
  STATUS_BAD,
} from '../charts/index.js'
import { fmtMs, fmtUsd } from '../format.js'
import { useExperimentApi } from '../harness/index.js'

const ROLE_ORDER = ['cashier', 'barista', 'manager', 'judge']
const LAYER_ORDER = ['tool', 'agent', 'triage', 'review', 'judge', 'run'] as const

/**
 * What the OpenTelemetry spans say about a run: where the time goes per tool and
 * per reasoning step, how cost accumulates visit by visit, and where errors
 * happened. Polls while the run is live.
 */
export function TelemetryPanel({ runId, live }: { runId: string | null; live: boolean }) {
  const api = useExperimentApi()
  const [data, setData] = useState<RunTelemetry | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setErr(null)
    if (!runId || !api) return
    let stop = false
    const load = () =>
      api
        .telemetry(runId)
        .then((t) => {
          if (!stop) setData(t)
        })
        .catch((e) => {
          if (!stop) setErr(e instanceof Error ? e.message : String(e))
        })
    void load()
    const id = live ? setInterval(load, 3000) : null
    return () => {
      stop = true
      if (id) clearInterval(id)
    }
  }, [api, runId, live])

  if (!api) return <p className="muted">This harness does not expose telemetry.</p>
  if (!runId) return <p className="muted">Start or load a shift.</p>
  if (err) return <p className="bad">{err}</p>
  if (!data) return <p className="muted">Loading spans…</p>
  if (data.spanCount === 0)
    return (
      <p className="muted">No spans yet. Spans land as each tool call, step and visit finishes.</p>
    )
  return <TelemetryCharts data={data} />
}

/** The charts themselves, reusable for a suite variant. */
export function TelemetryCharts({
  data,
  compact = false,
}: {
  data: RunTelemetry
  compact?: boolean
}) {
  const roles = ROLE_ORDER.filter((r) => data.costByRole[r] !== undefined)
  const anyCost = Object.values(data.costByRole).some((v) => v > 0)
  return (
    <div className="telemetry">
      <section className="chart-block">
        <h4>Tool call latency</h4>
        <p className="sub">
          Each dot is one call; the thick tick is p50, the dashed tick p95. Log scale.
        </p>
        {data.tools.length === 0 ? (
          <div className="chart-empty">No tool calls yet.</div>
        ) : (
          <DotStrip
            groups={data.tools.map((t) => ({
              label: t.tool,
              samples: t.samples,
              p50: t.p50,
              p95: t.p95,
              color: SERIES.water,
              note: t.errors
                ? `${t.errors} ${Object.keys(t.byCode).join('/')} err${t.errors === 1 ? '' : 's'}`
                : undefined,
              noteBad: t.errors > 0,
            }))}
          />
        )}
      </section>

      <section className="chart-block">
        <h4>Reasoning latency per step</h4>
        <p className="sub">
          Model time for each step of a turn, by role: step 1 reads the task, later steps react to
          tool results.
        </p>
        {data.steps.length === 0 ? (
          <div className="chart-empty">No model steps yet.</div>
        ) : (
          <>
            <Legend
              items={ROLE_ORDER.filter((r) => data.steps.some((s) => s.role === r)).map((r) => ({
                label: r,
                color: roleColor(r),
              }))}
            />
            <DotStrip
              groups={data.steps.map((s) => ({
                label: `${s.role} · step ${s.stepIndex}`,
                samples: s.samples,
                p50: s.p50,
                p95: s.p95,
                color: roleColor(s.role),
              }))}
              rowHeight={20}
            />
          </>
        )}
      </section>

      <section className="chart-block">
        <h4>Cost over the shift</h4>
        <p className="sub">Cumulative spend after each visit, in arrival order.</p>
        {data.costTrajectory.length === 0 ? (
          <div className="chart-empty">No visits yet.</div>
        ) : !anyCost ? (
          <div className="chart-empty">
            {fmtUsd(0)} across {data.costTrajectory.length} visits: mock models are free.
          </div>
        ) : (
          <>
            <LineChart
              step
              height={compact ? 140 : 170}
              series={[
                {
                  name: 'cumulative',
                  color: SERIES.gold,
                  points: data.costTrajectory.map((c) => ({
                    x: c.visitIndex + 1,
                    y: c.cumulativeUsd,
                    label: `#${c.visitIndex + 1} ${shortScenarioId(c.scenarioId)}`,
                  })),
                },
              ]}
              formatY={fmtUsd}
              formatX={(v) => `#${v}`}
              xLabel="visit"
            />
            {roles.length > 0 && anyCost && (
              <>
                <Legend items={roles.map((r) => ({ label: r, color: roleColor(r) }))} />
                <BarChart
                  data={data.costTrajectory.map((c) => ({
                    label: `#${c.visitIndex + 1} ${shortScenarioId(c.scenarioId)}`,
                    values: roles.map((r) => c.byRole[r] ?? 0),
                  }))}
                  series={roles.map((r) => ({ name: r, color: ROLE_COLOR[r] ?? SERIES.water }))}
                  format={fmtUsd}
                  rowHeight={18}
                />
              </>
            )}
          </>
        )}
      </section>

      <section className="chart-block">
        <h4>
          Errors <span className="muted">({data.errors.total})</span>
        </h4>
        <p className="sub">Where things went wrong: by layer of the pipeline, then by kind.</p>
        {data.errors.total === 0 ? (
          <div className="chart-empty">No errors in this run.</div>
        ) : (
          <>
            <BarChart
              data={LAYER_ORDER.filter((l) => data.errors.byLayer[l] > 0).map((l) => ({
                label: l,
                values: [data.errors.byLayer[l]],
              }))}
              series={[{ name: 'errors', color: STATUS_BAD }]}
              rowHeight={18}
            />
            <BarChart
              data={Object.entries(data.errors.byKind)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => ({ label: k, values: [n] }))}
              series={[{ name: 'errors', color: STATUS_BAD }]}
              rowHeight={18}
            />
            <div className="table-scroll">
              <table className="grid small">
                <thead>
                  <tr>
                    <th>when</th>
                    <th>visit</th>
                    <th>layer</th>
                    <th>where</th>
                    <th>kind</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.list.slice(0, 40).map((e) => (
                    <tr key={`${e.t}-${e.kind}-${e.tool ?? ''}`} className="bad">
                      <td>{new Date(e.t).toLocaleTimeString()}</td>
                      <td>{e.scenarioId ? shortScenarioId(e.scenarioId) : '–'}</td>
                      <td>{e.layer}</td>
                      <td>
                        {e.tool ?? (e.role ? `${e.role}${e.step ? ` step ${e.step}` : ''}` : '–')}
                      </td>
                      <td title={e.message ?? undefined}>{e.kind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {!compact && (
        <section className="chart-block">
          <h4>Per visit</h4>
          <p className="sub">One row per golden item: the per-iteration view.</p>
          <div className="table-scroll">
            <table className="grid small">
              <thead>
                <tr>
                  <th>#</th>
                  <th>item</th>
                  <th>outcome</th>
                  <th>pass</th>
                  <th>time</th>
                  <th>tools</th>
                  <th>tool errs</th>
                  <th>agent errs</th>
                  <th>review</th>
                  <th>judge</th>
                  <th>cost</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.txId} className={i.taskSuccess === false ? 'bad' : ''}>
                    <td>{i.visitIndex + 1}</td>
                    <td>{shortScenarioId(i.scenarioId)}</td>
                    <td>{i.outcome ?? '…'}</td>
                    <td>{i.taskSuccess === null ? '…' : i.taskSuccess ? '✓' : '✗'}</td>
                    <td>{fmtMs(i.durationMs)}</td>
                    <td>{i.toolCalls}</td>
                    <td>{i.toolErrors}</td>
                    <td>{i.agentErrors}</td>
                    <td>{i.reviewVerdict ?? '–'}</td>
                    <td>
                      {i.judgeCorrect === null ? '–' : `${Math.round(i.judgeCorrect * 100)}%`}
                    </td>
                    <td>{fmtUsd(i.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
