import { BENCH_TASK_INFO, BENCH_TASKS, type BenchReport, type BenchTask } from '@cafe/protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BenchScatter } from '../charts/BenchScatter.js'
import { CATEGORICAL, Legend } from '../charts/index.js'
import { fmtMs, shortModel } from '../format.js'
import {
  type BenchView,
  type DomainInfo,
  type ModelsInfo,
  type RunRow,
  useExperimentApi,
  useHarness,
} from '../harness/index.js'
import { describeSpec, sentence } from '../lib/nomenclature.js'
import './bench.css'

const MAX_SPECS = 5
const JEV = 'gateway:typesafe-ai/jev'
/** One-click additions: the decision model and the LLMs it is usually weighed against. */
const QUICK: Array<{ label: string; spec: string }> = [
  { label: 'Jev', spec: JEV },
  { label: 'Claude Haiku', spec: 'anthropic/claude-haiku-4-5-20251001' },
  { label: 'Claude Sonnet', spec: 'anthropic/claude-sonnet-5' },
  { label: 'GPT-5 mini', spec: 'openai/gpt-5-mini' },
  { label: 'Gemini Flash', spec: 'google/gemini-2.5-flash' },
]

/** Which provider key a spec needs, for the "not configured" warning. */
function providerOf(spec: string): string | null {
  if (spec.startsWith('mock:')) return null
  if (spec.startsWith('gateway:')) return 'gateway'
  return spec.split('/')[0] ?? null
}

/**
 * The decision bench: the same labelled yes/no decisions asked of up to five
 * evaluation models, with no agents in the loop. It is where Jev is compared with
 * LLMs on the decisions a decision model is built for: turning manipulation away at
 * the door, approving or blocking an action, and judging a finished case.
 */
export function BenchPage({ models, domains }: { models: ModelsInfo; domains: DomainInfo[] }) {
  const api = useExperimentApi()
  const harness = useHarness()
  const [domain, setDomain] = useState(domains[0]?.id ?? 'cafe')
  const pack = domains.find((d) => d.id === domain)
  const [specs, setSpecs] = useState<string[]>(() => [pack?.defaultRoles.manager ?? 'mock:manager'])
  const [tasks, setTasks] = useState<BenchTask[]>(['door', 'gate'])
  const [judgeRunId, setJudgeRunId] = useState<string>('')
  const [runs, setRuns] = useState<RunRow[]>([])
  const [benches, setBenches] = useState<Array<Omit<BenchView, 'report' | 'error'>>>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<BenchView | null>(null)
  const [draftSpec, setDraftSpec] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    api
      ?.benches()
      .then((b) => {
        setBenches(b)
        setSelected((s) => s ?? b[0]?.id ?? null)
      })
      .catch(() => {})
    harness
      .runs()
      .then(setRuns)
      .catch(() => {})
  }, [api, harness])
  useEffect(refresh, [refresh])

  // follow the selected bench; poll while it runs
  useEffect(() => {
    if (!api || !selected) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () =>
      api
        .bench(selected)
        .then((b) => {
          if (stop) return
          setView(b)
          if (b.status === 'running') timer = setTimeout(load, 700)
          else refresh()
        })
        .catch(() => {})
    void load()
    return () => {
      stop = true
      if (timer) clearTimeout(timer)
    }
  }, [api, selected, refresh])

  const judgeRuns = useMemo(
    () =>
      runs.filter(
        (r) =>
          r.status === 'finished' &&
          (r.config.domain ?? 'cafe') === domain &&
          r.config.judgeEnabled,
      ),
    [runs, domain],
  )

  const chooseDomain = (id: string) => {
    const next = domains.find((d) => d.id === id)
    setDomain(id)
    setJudgeRunId('')
    // scripted mocks belong to a domain; swap them, keep live models
    setSpecs((s) => s.map((x) => (x.startsWith('mock:') && next ? next.defaultRoles.manager : x)))
  }
  const addSpec = (spec: string) => {
    const v = spec.trim()
    if (!v || specs.includes(v) || specs.length >= MAX_SPECS) return
    setSpecs([...specs, v])
    setDraftSpec('')
  }
  const toggleTask = (t: BenchTask) =>
    setTasks(tasks.includes(t) ? tasks.filter((x) => x !== t) : [...tasks, t])

  const liveSpecs = specs.filter((s) => !s.startsWith('mock:'))
  const missingKeys = [
    ...new Set(liveSpecs.map(providerOf).filter((p) => p && !models.providersConfigured[p])),
  ]
  const needsRun = tasks.includes('judge') && !judgeRunId
  const canRun =
    specs.length > 0 &&
    tasks.length > 0 &&
    !needsRun &&
    (liveSpecs.length === 0 || models.allowLive)

  const start = async () => {
    if (!api) return
    setBusy(true)
    setError(null)
    try {
      const { id } = await api.startBench({
        domain,
        specs,
        tasks,
        ...(tasks.includes('judge') && judgeRunId ? { judgeRunId } : {}),
      })
      setSelected(id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!api) return <p className="muted">This harness does not expose the decision bench.</p>
  return (
    <div className="bench-page">
      <header className="bench-head">
        <h2>Decision bench</h2>
        <p className="muted">
          The same labelled yes/no decisions, asked of up to {MAX_SPECS} evaluation models side by
          side. No agents in the loop, so it is fast and cheap: the place to compare a decision
          model like Jev with LLMs.
        </p>
      </header>
      <div className="bench-cols">
        <aside className="bench-config run-config">
          <section>
            <h3>Where a decision model sits in the harness</h3>
            <ul className="bench-points">
              <li>
                <b>Door guardrail and routing</b>: classify each case on arrival; with routing on,
                manipulation never reaches agent 1.
              </li>
              <li>
                <b>Action gate</b>: approve or block a payout or hand-off before the tool runs.
                Inline in the agent loop, so latency counts.
              </li>
              <li>
                <b>Orchestrator review and judge</b>: file each case and score it, with calibrated
                probabilities rather than prose.
              </li>
            </ul>
            <p className="muted small">
              Jev answers typed questions (yes/no, a choice, a score) with probabilities in 70-500
              ms and costs input tokens only. It does not write text or call tools, so agents 1 and
              2 stay on chat models.
            </p>
          </section>

          <section>
            <h3>Bench</h3>
            <label className="row">
              <span>domain</span>
              <select value={domain} onChange={(e) => chooseDomain(e.target.value)}>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="bench-tasks">
              <legend className="muted small">decisions</legend>
              {BENCH_TASKS.map((t) => (
                <label key={t} className="check">
                  <input
                    type="checkbox"
                    checked={tasks.includes(t)}
                    onChange={() => toggleTask(t)}
                  />{' '}
                  <b>{BENCH_TASK_INFO[t].label}</b>{' '}
                  <span className="muted">{BENCH_TASK_INFO[t].question}</span>
                </label>
              ))}
            </fieldset>
            {tasks.includes('judge') && (
              <label className="row">
                <span>judge reads</span>
                <select value={judgeRunId} onChange={(e) => setJudgeRunId(e.target.value)}>
                  <option value="">pick a finished run…</option>
                  {judgeRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.createdAt).toLocaleString()} · {r.config.name} ·{' '}
                      {shortModel(r.config.roles.cashier)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tasks.includes('judge') && (
              <p className="muted small">
                Each judged case of that run is re-asked with the ground truth removed from the
                transcript; the label is the ground truth. A run with flawed agents (the naive or
                forgetful mocks) gives a balanced set.
              </p>
            )}
          </section>

          <section>
            <h3>
              Models{' '}
              <span className="muted">
                ({specs.length}/{MAX_SPECS})
              </span>
            </h3>
            <ul className="bench-specs">
              {specs.map((s, i) => (
                <li key={s}>
                  <i style={{ background: CATEGORICAL[i] }} aria-hidden="true" />
                  <div>
                    <code>{s}</code>
                    <div className="muted small">
                      {s.startsWith('mock:')
                        ? 'keyword rules written for this dataset: a floor, not a model'
                        : describeSpec(s)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="link"
                    aria-label={`Remove ${s}`}
                    onClick={() => setSpecs(specs.filter((x) => x !== s))}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="bench-quick">
              {QUICK.filter((q) => !specs.includes(q.spec)).map((q) => (
                <button
                  key={q.spec}
                  type="button"
                  disabled={specs.length >= MAX_SPECS}
                  title={q.spec}
                  onClick={() => addSpec(q.spec)}
                >
                  + {q.label}
                </button>
              ))}
            </div>
            <div className="row">
              <input
                list="bench-specs"
                placeholder="any model spec"
                value={draftSpec}
                onChange={(e) => setDraftSpec(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSpec(draftSpec)}
                spellCheck={false}
              />
              <button
                type="button"
                disabled={specs.length >= MAX_SPECS}
                onClick={() => addSpec(draftSpec)}
              >
                add
              </button>
              <datalist id="bench-specs">
                {Object.values(models.presets)
                  .flat()
                  .map((s) => (
                    <option key={s} value={s} />
                  ))}
              </datalist>
            </div>
            {liveSpecs.length > 0 && !models.allowLive && (
              <p className="bad small">
                Live models are off on the server (CAFE_ALLOW_LIVE_MODELS).
              </p>
            )}
            {missingKeys.length > 0 && (
              <p className="bad small">
                No key configured for {missingKeys.join(', ')}
                {missingKeys.includes('gateway') ? ' (Jev needs AI_GATEWAY_API_KEY)' : ''}; those
                calls will fail and show as errors.
              </p>
            )}
          </section>

          <div className="start-row">
            <div className="muted small">
              {liveSpecs.length
                ? `${liveSpecs.length} live model(s): real calls, real cost`
                : 'all mock: free'}
            </div>
            <button
              type="button"
              className="primary big"
              disabled={!canRun || busy}
              onClick={start}
            >
              {busy ? 'Starting…' : 'Run bench'}
            </button>
          </div>
          {needsRun && <p className="muted small">Pick a run for the judge task.</p>}
          {error && <div className="error-box">{error}</div>}

          <section>
            <h3>Recent benches</h3>
            {benches.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              <ul className="runs">
                {benches.map((b) => (
                  <li key={b.id} className={b.id === selected ? 'current' : ''}>
                    <button type="button" className="link" onClick={() => setSelected(b.id)}>
                      {new Date(b.createdAt).toLocaleTimeString()} · {b.config.domain} ·{' '}
                      {b.config.specs.map(shortModel).join(' vs ')}
                    </button>
                    <span className={`pill ${b.status === 'running' ? 'running' : b.status}`}>
                      {sentence(b.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <section className="bench-results">
          {!view && <p className="muted">Run a bench to see models compared here.</p>}
          {view?.status === 'running' && (
            <div className="bench-progress">
              <span>
                Running · {view.progress?.done ?? 0}/{view.progress?.total ?? '?'} decisions
              </span>
              <div className="bar">
                <i
                  style={{
                    width: `${((view.progress?.done ?? 0) / Math.max(1, view.progress?.total ?? 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
          {view?.status === 'failed' && <div className="error-box">{view.error}</div>}
          {view?.report && <BenchResults report={view.report} />}
        </section>
      </div>
    </div>
  )
}

const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`)

function BenchResults({ report }: { report: BenchReport }) {
  const colorOf = (spec: string) => CATEGORICAL[report.specs.indexOf(spec)] ?? CATEGORICAL[0]
  return (
    <>
      <Legend items={report.specs.map((s) => ({ label: s, color: colorOf(s) }))} />
      {report.tasks.map((task) => {
        const scores = report.scores.filter((s) => s.task === task)
        const best = Math.max(...scores.map((s) => s.accuracy ?? -1))
        const points = scores.flatMap((s) =>
          s.accuracy !== null && s.latency
            ? [
                {
                  spec: s.spec,
                  label: shortModel(s.spec).replace(/^mock:/, 'mock '),
                  color: colorOf(s.spec),
                  accuracy: s.accuracy,
                  p50: Math.max(1, s.latency.p50),
                  p95: Math.max(1, s.latency.p95),
                  brier: s.brier,
                  costUsd: s.costUsd,
                },
              ]
            : [],
        )
        const rows = report.items.filter((i) => i.task === task)
        const contested = rows.filter((r) => {
          const ds = report.specs.map((s) => r.answers[s]?.p).filter((p): p is number => p != null)
          const wrong = ds.some((p) => p >= 0.5 !== r.label)
          return wrong
        })
        return (
          <article key={task} className="bench-task">
            <h3>
              {BENCH_TASK_INFO[task].label}{' '}
              <span className="muted">
                · {BENCH_TASK_INFO[task].question} · {rows.length} decisions
              </span>
            </h3>
            {points.length > 0 && (
              <BenchScatter points={points} title={BENCH_TASK_INFO[task].label} />
            )}
            <div className="table-scroll">
              <table className="bench-table">
                <thead>
                  <tr>
                    <th>model</th>
                    <th title="decision at P ≥ 50% against the label">accuracy</th>
                    <th title="of the yes answers, how many were right">precision</th>
                    <th title="of the yes items, how many it caught">recall</th>
                    <th title="mean squared error of P: lower is better calibrated; 0.25 is a coin at 50%">
                      Brier
                    </th>
                    <th>p50</th>
                    <th>p95</th>
                    <th>cost</th>
                    <th>errors</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((s) => (
                    <tr key={s.spec}>
                      <td>
                        <i className="swatch" style={{ background: colorOf(s.spec) }} />
                        <code>{s.spec}</code>
                      </td>
                      <td className={s.accuracy !== null && s.accuracy === best ? 'best' : ''}>
                        {pct(s.accuracy)}
                      </td>
                      <td>{pct(s.precision)}</td>
                      <td>{pct(s.recall)}</td>
                      <td>{s.brier === null ? '-' : s.brier.toFixed(3)}</td>
                      <td>{s.latency ? fmtMs(s.latency.p50) : '-'}</td>
                      <td>{s.latency ? fmtMs(s.latency.p95) : '-'}</td>
                      <td>${s.costUsd.toFixed(4)}</td>
                      <td className={s.errors ? 'bad' : ''}>{s.errors || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.agreement.some((a) => a.task === task) && (
              <p className="muted small">
                Agreement:{' '}
                {report.agreement
                  .filter((a) => a.task === task)
                  .map((a) => `${shortModel(a.a)} vs ${shortModel(a.b)} ${pct(a.rate)}`)
                  .join(' · ')}
              </p>
            )}
            <details
              className="bench-contested"
              open={contested.length > 0 && contested.length <= 8}
            >
              <summary>
                {contested.length} decision{contested.length === 1 ? '' : 's'} at least one model
                got wrong
              </summary>
              <table className="bench-table">
                <thead>
                  <tr>
                    <th>decision</th>
                    <th>right answer</th>
                    {report.specs.map((s) => (
                      <th key={s} title={s}>
                        <i className="swatch" style={{ background: colorOf(s) }} />
                        {shortModel(s).replace(/^mock:/, '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contested.map((r) => (
                    <tr key={r.id}>
                      <td title={r.note}>
                        {r.title}
                        {r.note && <div className="muted small">{r.note}</div>}
                      </td>
                      <td>{r.label ? 'yes' : 'no'}</td>
                      {report.specs.map((s) => {
                        const a = r.answers[s]
                        if (!a || a.p === null)
                          return (
                            <td key={s} className="bad" title={a?.error}>
                              ✗ error
                            </td>
                          )
                        const right = a.p >= 0.5 === r.label
                        return (
                          <td key={s} className={right ? 'ok' : 'bad'}>
                            {right ? '✓' : '✗'} {Math.round(a.p * 100)}%
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </article>
        )
      })}
    </>
  )
}
