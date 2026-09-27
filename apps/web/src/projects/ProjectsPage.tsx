import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtUsd, shortModel } from '../format.js'
import { type ProjectInfo, type RunRow, useHarness } from '../harness/index.js'
import { CASE_NOUN, sentence } from '../lib/nomenclature.js'
import './projects.css'

/**
 * Every run, grouped by the project it evaluated. A target project (an app tested
 * over HTTP, from the CLI or CI) lists its runs with where they ran, the branch
 * and commit, and the pull request they belong to; the built-in domains group
 * under Simulations. Opening a run plays it in the Run view like any other.
 */
export function ProjectsPage({ onOpenRun }: { onOpenRun: (run: RunRow) => void }) {
  const api = useHarness()
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshProjects = useCallback(() => {
    if (!api.projects) {
      setError('This harness does not group runs by project.')
      return
    }
    api
      .projects()
      .then((list) => {
        setProjects(list)
        setSelected((cur) => cur ?? list[0]?.id ?? null)
      })
      .catch((err: Error) => setError(err.message))
  }, [api])

  const refreshRuns = useCallback(() => {
    if (!selected) return
    api
      .runs(selected)
      .then(setRuns)
      .catch((err: Error) => setError(err.message))
  }, [api, selected])

  useEffect(() => {
    refreshProjects()
    const id = setInterval(refreshProjects, 10_000)
    return () => clearInterval(id)
  }, [refreshProjects])

  useEffect(() => {
    setRuns(null)
    refreshRuns()
    // live runs update their row as they go
    const id = setInterval(refreshRuns, 4000)
    return () => clearInterval(id)
  }, [refreshRuns])

  const project = projects?.find((p) => p.id === selected) ?? null

  return (
    <div className="projects-page">
      <header className="projects-head">
        <h2>Projects</h2>
        <p className="muted">
          Every evaluation run, grouped by the project it tested. Open one to play it back in any
          view.
        </p>
      </header>
      <div className="projects-cols">
        <nav className="projects-list" aria-label="Projects">
          {projects === null && !error && <p className="muted small pad">Loading…</p>}
          {projects?.length === 0 && <p className="muted small pad">No runs yet.</p>}
          {projects?.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`project-item${p.id === selected ? ' on' : ''}`}
              aria-current={p.id === selected ? 'page' : undefined}
              onClick={() => setSelected(p.id)}
            >
              <span className="project-mark" aria-hidden="true">
                {p.simulated ? '◇' : p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="project-text">
                <span className="project-name">{p.name}</span>
                <span className="muted small">
                  {p.runs} run{p.runs === 1 ? '' : 's'} · {relative(p.lastAt)}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <section className="projects-main">
          {error && <div className="error-box">{error}</div>}
          {project && <ProjectRuns project={project} runs={runs} onOpenRun={onOpenRun} />}
        </section>
      </div>
    </div>
  )
}

function ProjectRuns({
  project,
  runs,
  onOpenRun,
}: {
  project: ProjectInfo
  runs: RunRow[] | null
  onOpenRun: (run: RunRow) => void
}) {
  const target = runs?.find((r) => r.config.target)?.config.target ?? null
  const finished = useMemo(() => (runs ?? []).filter((r) => r.summary), [runs])
  const latest = finished[0]
  const spend = finished.reduce((s, r) => s + (r.summary?.costUsd ?? 0), 0)
  return (
    <>
      <div className="project-title">
        <h3>{project.name}</h3>
        <p className="muted small">
          {project.simulated
            ? 'The built-in domains, played by simulated agents.'
            : target
              ? `Evaluated over HTTP from ${target.pack} · ${target.url}`
              : 'Evaluated over HTTP.'}
        </p>
      </div>
      <div className="project-tiles">
        <Tile
          label="Latest pass rate"
          value={latest?.summary ? pct(passRate(latest)) : '–'}
          tone={latest?.summary ? (passRate(latest) === 1 ? 'good' : 'bad') : null}
        />
        <Tile label="Runs" value={String(project.runs)} />
        <Tile label="Last run" value={relative(project.lastAt)} />
        <Tile label={project.simulated ? 'Model spend' : 'App spend'} value={fmtUsd(spend)} />
      </div>
      {runs === null ? (
        <p className="muted small">Loading runs…</p>
      ) : runs.length === 0 ? (
        <p className="muted small">No runs for this project.</p>
      ) : (
        <div className="runs-table-wrap">
          <table className="runs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Result</th>
                <th>Source</th>
                <th>{project.simulated ? 'Domain' : 'Branch · commit'}</th>
                <th>{project.simulated ? 'Models' : 'Pull request'}</th>
                <th className="num">Spend</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <RunLine key={r.id} run={r} simulated={project.simulated} onOpen={onOpenRun} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function RunLine({
  run,
  simulated,
  onOpen,
}: {
  run: RunRow
  simulated: boolean
  onOpen: (run: RunRow) => void
}) {
  const t = run.config.target
  const cases = run.summary?.transactions ?? run.config.scenarioIds.length
  const live = run.active && (run.status === 'running' || run.status === 'pending')
  const interrupted =
    (!run.active && (run.status === 'running' || run.status === 'pending')) ||
    (run.status === 'failed' && (run.error?.startsWith('interrupted') ?? false))
  const open = () => onOpen(run)
  return (
    <tr
      className="run-line"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      aria-label={`Open the run from ${new Date(run.createdAt).toLocaleString()}`}
    >
      <td>
        <div>{when(run.createdAt)}</div>
        <div className="muted small">{relative(run.createdAt)}</div>
      </td>
      <td>
        {live ? (
          <span className="pill live-pill">
            <i className="dot" aria-hidden="true" /> Live
          </span>
        ) : interrupted ? (
          <span className="pill interrupted">Interrupted</span>
        ) : run.summary ? (
          <ResultBar run={run} />
        ) : (
          <span className={`pill ${run.status}`} title={run.error ?? undefined}>
            {sentence(run.status)}
          </span>
        )}
        <div className="muted small">
          {cases} {cases === 1 ? CASE_NOUN.one : CASE_NOUN.many}
        </div>
      </td>
      <td>
        {simulated ? (
          <span className="source-chip">Simulated</span>
        ) : t?.source === 'ci' ? (
          t.git.runUrl ? (
            <a
              className="source-chip ci"
              href={t.git.runUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              CI ↗
            </a>
          ) : (
            <span className="source-chip ci">CI</span>
          )
        ) : (
          <span className="source-chip">Local</span>
        )}
        {t?.replayOf && (
          <div className="muted small" title={t.replayOf}>
            imported
          </div>
        )}
      </td>
      <td>
        {simulated ? (
          <span>{sentence(run.config.domain)}</span>
        ) : t?.git.branch || t?.git.commit ? (
          <>
            <div className="mono">{t.git.branch ?? 'detached'}</div>
            {t.git.commit && <div className="mono muted small">{t.git.commit.slice(0, 7)}</div>}
          </>
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td>
        {simulated ? (
          <span className="muted small">
            {shortModel(run.config.roles.cashier).replace(/^mock:/, '')} /{' '}
            {shortModel(run.config.roles.barista).replace(/^mock:/, '')}
          </span>
        ) : t?.git.prUrl ? (
          <a
            className="pr-link"
            href={t.git.prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            #{t.git.prNumber ?? 'PR'} ↗
          </a>
        ) : (
          <span
            className="no-pr"
            title={
              t?.source === 'ci'
                ? 'This CI run was not for a pull request (a push or a schedule).'
                : 'A local run from a checkout with no open pull request.'
            }
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="4" cy="4" r="2" />
              <circle cx="4" cy="12" r="2" />
              <path d="M4 6v4" />
              <circle cx="12" cy="12" r="2" strokeDasharray="2 2" />
            </svg>
            No PR
          </span>
        )}
      </td>
      <td className="num mono">{run.summary ? fmtUsd(run.summary.costUsd) : '–'}</td>
    </tr>
  )
}

function ResultBar({ run }: { run: RunRow }) {
  const s = run.summary
  if (!s) return null
  const rate = passRate(run)
  return (
    <div className="result-bar" title={`${s.succeeded} of ${s.transactions} passed`}>
      <span className={`result-num ${rate === 1 ? 'good' : 'bad'}`}>
        {s.succeeded}/{s.transactions}
      </span>
      <span className="bar" aria-hidden="true">
        <i style={{ width: `${Math.round(rate * 100)}%` }} />
      </span>
    </div>
  )
}

function Tile({
  label,
  value,
  tone = null,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad' | null
}) {
  return (
    <div className="project-tile">
      <div className="muted small">{label}</div>
      <div className={`tile-value${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  )
}

const passRate = (r: RunRow) =>
  r.summary?.transactions ? r.summary.succeeded / r.summary.transactions : 0

const pct = (n: number) => `${Math.round(n * 100)}%`

/** "Today 4:27 PM", "Sep 24, 9:02 AM". */
function when(ms: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return `Today ${time}`
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function relative(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
