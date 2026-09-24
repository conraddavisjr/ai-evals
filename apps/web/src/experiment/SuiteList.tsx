import type { SuiteDetail } from '@cafe/protocol'
import { useExperimentApi } from '../harness/index.js'
import { sentence } from '../lib/nomenclature.js'

/** Past and running suites, with progress per variant. */
export function SuiteList({
  suites,
  selectedId,
  onSelect,
  onChanged,
}: {
  suites: SuiteDetail[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChanged: () => void
}) {
  const api = useExperimentApi()
  if (suites.length === 0) return <p className="muted">No suites yet. Configure one and run it.</p>
  return (
    <ul className="suite-list">
      {suites.map((s) => {
        const active = s.status === 'running' || s.status === 'pending'
        return (
          <li key={s.id} className={s.id === selectedId ? 'current' : ''}>
            <button type="button" className="link" onClick={() => onSelect(s.id)}>
              {new Date(s.createdAt).toLocaleString()} · {s.name}
            </button>
            <span className={`pill ${s.status}`}>{sentence(s.status)}</span>
            <span className="muted small">
              {s.config.variants.length} variant{s.config.variants.length === 1 ? '' : 's'}
              {s.config.repeats > 1 ? ` × ${s.config.repeats}` : ''} · {s.progress.done}/
              {s.progress.total} done
            </span>
            <span className="progress" aria-hidden="true">
              <i style={{ width: `${(100 * s.progress.done) / Math.max(1, s.progress.total)}%` }} />
            </span>
            {active && api && (
              <button
                type="button"
                className="link"
                onClick={() =>
                  api
                    .cancelSuite(s.id)
                    .then(onChanged)
                    .catch(() => {})
                }
              >
                cancel
              </button>
            )}
            {!active && api && (
              <button
                type="button"
                className="link"
                onClick={() =>
                  api
                    .deleteSuite(s.id)
                    .then(onChanged)
                    .catch(() => {})
                }
                title="Delete the suite and its runs"
              >
                delete
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
