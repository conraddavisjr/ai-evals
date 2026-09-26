import { useEffect, useMemo, useState } from 'react'
import { type CaseInfo, type ProjectCasesInfo, useHarness } from '../harness/index.js'

const OUTCOME: Record<string, string> = { served: 'served', refused: 'declined', failed: 'failed' }

/**
 * Every golden case a project has, read-only from its repo: how many, which run
 * on a pull request (the smoke subset), and for each one what it sends, what it
 * expects and every check it makes. Search and filters narrow the list.
 */
/** Keyed by project where it is used, so switching projects starts from a clean slate. */
export function CasesTab({ project }: { project: string }) {
  const api = useHarness()
  const [ref, setRef] = useState<string | undefined>(undefined)
  const [data, setData] = useState<ProjectCasesInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dataset, setDataset] = useState('')
  const [tag, setTag] = useState('')
  const [smokeOnly, setSmokeOnly] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!api.projectCases) {
      setError('This harness does not list project cases.')
      return
    }
    setData(null)
    setError(null)
    api
      .projectCases(project, ref)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [api, project, ref])

  const tags = useMemo(
    () => [...new Set((data?.cases ?? []).flatMap((c) => c.tags))].sort(),
    [data],
  )
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.cases ?? []).filter(
      (c) =>
        (!dataset || c.dataset === dataset) &&
        (!tag || c.tags.includes(tag)) &&
        (!smokeOnly || c.smoke) &&
        (!q ||
          c.title.toLowerCase().includes(q) ||
          c.id.includes(q) ||
          c.prompt.toLowerCase().includes(q)),
    )
  }, [data, query, dataset, tag, smokeOnly])
  const groups = useMemo(() => {
    const m = new Map<string, CaseInfo[]>()
    for (const c of shown) m.set(c.dataset, [...(m.get(c.dataset) ?? []), c])
    return [...m]
  }, [shown])

  if (error) return <div className="error-box">{error}</div>
  if (!data) return <p className="muted small">Reading the cases…</p>

  // Only from the default branch: open pull requests that would change the case count.
  const base = data.source.refs.find((r) => r.ref === data.source.ref)?.total ?? data.total
  const newer =
    data.source.ref === (data.source.refs[0]?.ref ?? null)
      ? data.source.refs.filter((r) => r.openPr && r.total !== null && r.total !== base)
      : []
  return (
    <div className="cases-tab">
      <div className="cases-summary">
        <div className="cases-count">
          <span className="big">{data.total}</span> test cases
          {data.smoke > 0 && (
            <span className="muted">
              {' '}
              · {data.smoke} in the smoke subset (the quick set for a pull request)
            </span>
          )}
        </div>
        <div className="muted small">
          {data.source.kind === 'builtin' ? 'From ' : 'Read-only from '}
          {data.source.label}
          {data.source.kind !== 'builtin' && '. Cases change in the project’s repo, not here.'}
        </div>
        {data.source.refs.length > 1 && (
          <label className="cases-ref">
            <span className="muted small">branch</span>
            <select value={data.source.ref ?? ''} onChange={(e) => setRef(e.target.value)}>
              {data.source.refs.map((r) => (
                <option key={r.ref} value={r.ref}>
                  {r.ref}
                  {r.total !== null ? ` · ${r.total} cases` : ''}
                  {r.openPr ? ' · open PR' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {newer.length > 0 && (
          <div className="cases-newer">
            {newer.map((r) => (
              <button key={r.ref} type="button" className="link" onClick={() => setRef(r.ref)}>
                {r.ref} has {r.total} cases (open pull request) →
              </button>
            ))}
          </div>
        )}
      </div>

      {data.judge && (
        <details className="cases-scoring">
          <summary>How a case is scored</summary>
          <p className="small">
            Deterministic checks first (outcome, reason, the response contract, each case’s checks);
            the judge ({data.judge.model}) is asked only when they all pass.
            {data.thresholds.overall !== null &&
              ` A run passes at ${Math.round(data.thresholds.overall * 100)}% overall`}
            {Object.keys(data.thresholds.byTag).length > 0 &&
              `, and per tag: ${Object.entries(data.thresholds.byTag)
                .map(([t, v]) => `${t} ${Math.round(v * 100)}%`)
                .join(', ')}`}
            .
          </p>
          <ul className="small">
            {data.judge.questions.map((q) => (
              <li key={q.id}>
                <strong>{q.id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}</strong> ({q.type}
                ): {q.instructions}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="cases-filters">
        <input
          type="search"
          placeholder="Search titles, ids and prompts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search cases"
        />
        <select value={dataset} onChange={(e) => setDataset(e.target.value)} aria-label="Dataset">
          <option value="">All datasets ({data.total})</option>
          {data.datasets.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name} ({d.count})
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {/* tags read capitalized everywhere (the tag chips) */}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        {data.smoke > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={smokeOnly}
              onChange={(e) => setSmokeOnly(e.target.checked)}
            />{' '}
            smoke only
          </label>
        )}
        <span className="muted small">
          {shown.length === data.total ? `${data.total} shown` : `${shown.length} of ${data.total}`}
        </span>
      </div>

      {groups.length === 0 && <p className="muted small">No case matches.</p>}
      {groups.map(([name, list]) => (
        <section key={name} className="cases-group">
          <h4>
            {name} <span className="muted">{list.length}</span>
          </h4>
          <ul className="case-list">
            {list.map((c) => (
              <CaseRow
                key={c.id}
                c={c}
                open={open === c.id}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function CaseRow({ c, open, onToggle }: { c: CaseInfo; open: boolean; onToggle: () => void }) {
  const outcomes = c.expect.outcomes.map((o) => OUTCOME[o] ?? o)
  const profile = typeof c.input.profile === 'string' ? c.input.profile : null
  const rest = Object.entries(c.input).filter(([k]) => k !== 'profile')
  return (
    <li className={`case-item${open ? ' open' : ''}`}>
      <button type="button" className="case-head" aria-expanded={open} onClick={onToggle}>
        <span className="case-title">{c.title}</span>
        {c.smoke && <span className="smoke-badge">smoke</span>}
        <span
          className={`expect-pill ${c.expect.outcomes.length === 1 ? c.expect.outcomes[0] : 'either'}`}
        >
          {outcomes.length ? `expect ${outcomes.join(' or ')}` : 'no outcome set'}
        </span>
        <span className="case-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <div className="case-sub">
        <code className="muted">{c.id}</code>
        {profile && <span className="chip">{profile.replace(/_/g, ' ')}</span>}
        {c.tags.map((t) => (
          <span key={t} className="chip tag">
            {t}
          </span>
        ))}
      </div>
      <div className={`case-prompt${open ? '' : ' clamp'}`}>“{c.prompt}”</div>
      {open && (
        <div className="case-body">
          {rest.length > 0 && (
            <dl>
              {rest.map(([k, v]) => (
                <div key={k} className="row">
                  <dt>{k}</dt>
                  <dd>
                    <code>{typeof v === 'string' ? v : JSON.stringify(v)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <h5>Checks</h5>
          <ul>
            <li>outcome {outcomes.join(' or ') || 'any'}</li>
            {c.expect.reasons && <li>reason {c.expect.reasons.join(' or ')}</li>}
            {c.expect.checks.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <h5>Judge</h5>
          {c.skipJudge ? (
            <p className="muted small">Not asked: the checks above decide this case.</p>
          ) : c.judge.length ? (
            <ul>
              {c.judge.map((j) => (
                <li key={j}>{j}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No judge expectations.</p>
          )}
          {c.rubric && (
            <>
              <h5>Rubric</h5>
              <p className="small">{c.rubric}</p>
            </>
          )}
        </div>
      )}
    </li>
  )
}
