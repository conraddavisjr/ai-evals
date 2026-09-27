import { probabilityOf, type RunMetrics, shortScenarioId } from '@cafe/protocol'
import { useEffect, useMemo, useState } from 'react'
import { fmtMs, fmtUsd, pct, shortModel } from '../format.js'
import { type RunRow, useHarness } from '../harness/index.js'
import { caseTiming, timingGroup } from '../lib/case-timing.js'
import { roleLabel, roleShort } from '../lib/nomenclature.js'
import { latencyStatsOf } from '../lib/stats.js'
import { targetMetrics } from '../lib/target-metrics.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import { usePlayer } from '../playback/usePlayer.js'
import { useDrawer } from './Drawer.js'
import { JUDGE_EXPLAIN, JudgeDrill } from './drilldowns.js'
import { TelemetryPanel } from './TelemetryPanel.js'

/**
 * A target run's summary, computed from its events: it is there for a past run
 * the moment it loads, and fills in while a live run streams.
 */
function TargetSummary({ player }: { player: TimelinePlayer }) {
  usePlayer(player)
  const m = useMemo(() => targetMetrics(player.events), [player.events, player.events.length])
  if (m.cases === 0) return <p className="muted">No cases yet.</p>
  const rate = m.scored ? m.passed / m.scored : 0
  return (
    <div>
      {m.scored < m.cases && (
        <p className="muted small">
          {m.scored} of {m.cases} cases scored so far; the figures fill in as the rest finish.
        </p>
      )}
      <div className="tiles">
        <Tile
          label="pass rate"
          value={`${pct(rate)}`}
          sub={`${m.passed} of ${m.scored} cases`}
          good={rate === 1}
        />
        <Tile label="false refusals" value={String(m.falseRefusals)} good={m.falseRefusals === 0} />
        <Tile
          label="missed refusals"
          value={String(m.missedRefusals)}
          good={m.missedRefusals === 0}
        />
        <Tile
          label="contract errors"
          value={String(m.contractErrors)}
          good={m.contractErrors === 0}
        />
        <Tile label="e2e p50 / p95" value={`${fmtMs(m.endToEnd.p50)} / ${fmtMs(m.endToEnd.p95)}`} />
        <Tile
          label="app spend"
          value={fmtUsd(m.costUsd)}
          sub={`${(m.inputTokens + m.outputTokens).toLocaleString()} tokens`}
        />
      </div>

      <h4>By tag</h4>
      <table className="grid">
        <thead>
          <tr>
            <th>tag</th>
            <th>cases</th>
            <th>passed</th>
            <th>rate</th>
          </tr>
        </thead>
        <tbody>
          {m.byTag.map((t) => (
            <tr key={t.tag} className={t.passed === t.cases ? '' : 'bad'}>
              <td>{t.tag}</td>
              <td>{t.cases}</td>
              <td>{t.passed}</td>
              <td>{pct(t.passed / t.cases)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {m.failingChecks.length > 0 && (
        <>
          <h4>Failing checks</h4>
          <table className="grid">
            <tbody>
              {m.failingChecks.map((f) => (
                <tr key={f.label} className="bad">
                  <td>{f.label}</td>
                  <td>
                    {f.count} case{f.count === 1 ? '' : 's'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {m.judge.length > 0 && (
        <>
          <h4>Judge</h4>
          <p className="muted small">
            Means over the cases the judge read (it is only asked once the deterministic checks
            pass). Hover a question for its wording.
          </p>
          <table className="grid">
            <thead>
              <tr>
                <th>question</th>
                <th>mean</th>
                <th>cases</th>
              </tr>
            </thead>
            <tbody>
              {m.judge.map((q) => (
                <tr key={q.id}>
                  <td title={q.instructions ?? undefined}>
                    {q.id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}
                  </td>
                  <td>{q.type === 'boolean' ? `${pct(q.mean)} yes` : `${q.mean.toFixed(2)}/5`}</td>
                  <td>{q.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4>Where the time goes</h4>
      <StepTiming player={player} />

      <h4>Per case</h4>
      <div className="table-scroll">
        <table className="grid small">
          <thead>
            <tr>
              <th>case</th>
              <th>outcome</th>
              <th>checks</th>
              <th>total</th>
              <th>spend</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.txId} className={r.passed === false ? 'bad' : ''}>
                <td title={[r.scenarioId, ...r.checks.failed].join('; ')}>{r.title}</td>
                <td>
                  {r.outcome ?? 'in progress'}
                  {r.reason ? ` (${r.reason})` : ''}
                </td>
                <td>
                  {r.passed === null
                    ? '–'
                    : `${r.passed ? '✓' : '✗'} ${r.checks.passed}/${r.checks.total}`}
                </td>
                <td>{r.totalMs === null ? '–' : fmtMs(r.totalMs)}</td>
                <td>{fmtUsd(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Summary (the roll-up once a shift closes) or Telemetry (span-based, live). */
export function MetricsDashboard({
  runId,
  status,
  player = null,
}: {
  runId: string | null
  status: string
  /** For "jump" links in drill-downs; optional so the dashboard works without a stage. */
  player?: TimelinePlayer | null
}) {
  const [view, setView] = useState<'summary' | 'telemetry'>('summary')
  return (
    <div className="metrics">
      <div className="segmented metrics-switch" role="tablist" aria-label="Metrics view">
        {(
          [
            ['summary', 'Summary'],
            ['telemetry', 'Telemetry'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? 'on' : ''}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'summary' ? (
        player?.state.config?.target ? (
          <TargetSummary player={player} />
        ) : (
          <MetricsSummary runId={runId} status={status} player={player} />
        )
      ) : (
        <TelemetryPanel runId={runId} live={status === 'running'} player={player} />
      )}
    </div>
  )
}

function MetricsSummary({
  runId,
  status,
  player,
}: {
  runId: string | null
  status: string
  player: TimelinePlayer | null
}) {
  const drawer = useDrawer()
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

  const judgeCell = (metric: keyof typeof JUDGE_EXPLAIN, text: string) =>
    metrics ? (
      <button
        type="button"
        className="link metric-link"
        title="See the cases behind this figure"
        onClick={() =>
          drawer.open({
            title: JUDGE_EXPLAIN[metric]?.title ?? metric,
            subtitle: 'where the gaps are, case by case',
            body: <JudgeDrill metrics={metrics} metric={metric} player={player} />,
          })
        }
      >
        {text}
      </button>
    ) : (
      text
    )

  return (
    <div>
      {!runId && <p className="muted">Start or load a run.</p>}
      {runId && status !== 'finished' && (
        <p className="muted">
          Metrics land when the run closes. Watch the Cases tab for live waterfalls.
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
              <p className="muted small">
                Means over the cases. The probabilities are the judge's confidence, not a share:
                click a figure to see which cases it doubted and why.
              </p>
              <table className="grid">
                <tbody>
                  <tr>
                    <th>P(correct)</th>
                    <td>{judgeCell('correct', pct(metrics.judgeMeans.correct))}</td>
                    <th>refusal appropriate</th>
                    <td>
                      {judgeCell('refusalAppropriate', pct(metrics.judgeMeans.refusalAppropriate))}
                    </td>
                  </tr>
                  <tr>
                    <th>helpfulness</th>
                    <td>
                      {judgeCell('helpfulness', `${metrics.judgeMeans.helpfulness.toFixed(2)}/5`)}
                    </td>
                    <th>tone</th>
                    <td>{judgeCell('tone', `${metrics.judgeMeans.tone.toFixed(2)}/5`)}</td>
                  </tr>
                  <tr>
                    <th>tool use</th>
                    <td>
                      {judgeCell(
                        'toolUseQuality',
                        `${metrics.judgeMeans.toolUseQuality.toFixed(2)}/5`,
                      )}
                    </td>
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
                <th>mean steps / case</th>
              </tr>
            </thead>
            <tbody>
              {(['cashier', 'barista', 'manager', 'judge'] as const).map((r) => (
                <tr key={r}>
                  <td>{roleLabel(r)}</td>
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
          {player ? <StepTiming player={player} /> : <p className="muted">No timings yet.</p>}

          <h4>Per case</h4>
          <div className="table-scroll">
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
                    <td title={[t.scenarioId, ...t.taskSuccessReasons].join('; ')}>
                      {shortScenarioId(t.scenarioId)}
                    </td>
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
                    <td>
                      {t.judge
                        ? ((p) => (p === null ? '–' : pct(p)))(probabilityOf(t.judge, 'correct'))
                        : '–'}
                    </td>
                    <td>{fmtUsd(t.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {compare.length > 1 && (
        <>
          <h4>Compare runs</h4>
          <div className="table-scroll">
            <table className="grid small">
              <thead>
                <tr>
                  <th>when</th>
                  <th>
                    {(['cashier', 'barista', 'manager', 'judge'] as const)
                      .map(roleShort)
                      .join(' / ')}
                  </th>
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
          </div>
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

/**
 * Each step's time across the run's cases (the same rows as the Cases tab):
 * the router, each agent, the wait for agent 2, the gate, the review, the judge.
 */
function StepTiming({ player }: { player: TimelinePlayer }) {
  // the run's figures, not the playhead's: everything received so far
  usePlayer(player)
  const events = player.events
  const txIds = [
    ...new Set(events.flatMap((e) => (e.type === 'customer.arrived' && e.txId ? [e.txId] : []))),
  ]
  const groups = new Map<string, number[]>()
  for (const tx of txIds)
    for (const r of caseTiming(events, tx).rows) {
      const g = timingGroup(r)
      groups.set(g, [...(groups.get(g) ?? []), r.ms])
    }
  if (groups.size === 0) return <p className="muted">No timings yet.</p>
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>step</th>
          <th>cases</th>
          <th>p50</th>
          <th>p95</th>
          <th>max</th>
        </tr>
      </thead>
      <tbody>
        {[...groups].map(([g, ms]) => {
          const st = latencyStatsOf(ms)
          return (
            <tr key={g}>
              <td>{g}</td>
              <td>{ms.length}</td>
              <td>{fmtMs(st.p50)}</td>
              <td>{fmtMs(st.p95)}</td>
              <td>{fmtMs(st.max)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
