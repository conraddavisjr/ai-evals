import {
  type DatasetDetail,
  type DatasetSummary,
  isBuiltinDatasetId,
  type Scenario,
  type ScenarioInput,
  shortScenarioId,
} from '@cafe/protocol'
import { useCallback, useEffect, useState } from 'react'
import { type ToolInfo, useExperimentApi } from '../../harness/index.js'
import type { SuiteDraft } from '../suite-draft.js'
import { ScenarioForm } from './ScenarioForm.js'

/**
 * The golden dataset node: pick a dataset, choose which items the suite plays,
 * and add or edit items in the form. The built-in set is read-only; clone it to
 * start your own.
 */
export function DatasetPanel({
  draft,
  onChange,
  datasets,
  onDatasetsChanged,
}: {
  draft: SuiteDraft
  onChange: (d: SuiteDraft) => void
  datasets: DatasetSummary[]
  onDatasetsChanged: () => void
}) {
  const api = useExperimentApi()
  const [detail, setDetail] = useState<DatasetDetail | null>(null)
  const [tools, setTools] = useState<{
    tools: ToolInfo[]
    roleScopes: Record<string, readonly string[]>
  } | null>(null)
  const [editing, setEditing] = useState<Scenario | null | 'new'>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const reload = useCallback(() => {
    if (!api) return
    api
      .dataset(draft.datasetId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [api, draft.datasetId])
  useEffect(() => {
    setDetail(null)
    reload()
  }, [reload])
  useEffect(() => {
    api
      ?.tools()
      .then(setTools)
      .catch(() => {})
  }, [api])

  const builtin = isBuiltinDatasetId(draft.datasetId)
  const selected = draft.itemIds
  const isOn = (id: string) => selected === null || selected.includes(id)
  const toggleItem = (id: string) => {
    if (!detail) return
    const all = detail.items.map((i) => i.id)
    const next =
      selected === null
        ? all.filter((x) => x !== id)
        : isOn(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id]
    onChange({ ...draft, itemIds: next.length === all.length ? null : next })
  }

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const createDataset = (cloneFrom?: string) =>
    withBusy(async () => {
      if (!api) return
      const name = newName.trim() || (cloneFrom ? 'My dataset' : 'New dataset')
      const d = await api.createDataset({
        name,
        description: '',
        ...(cloneFrom ? { cloneFrom } : {}),
        items: [],
      })
      setNewName('')
      onDatasetsChanged()
      onChange({ ...draft, datasetId: d.id, itemIds: null })
    })

  const submitItem = async (input: ScenarioInput) => {
    if (!api || !detail) return
    if (editing === 'new') await api.addItem(detail.id, input)
    else if (editing) await api.updateItem(detail.id, editing.id, input)
    setEditing(null)
    onDatasetsChanged()
    reload()
  }

  const removeItem = (id: string) =>
    withBusy(async () => {
      if (!api || !detail) return
      await api.deleteItem(detail.id, id)
      if (selected) onChange({ ...draft, itemIds: selected.filter((x) => x !== id) })
      onDatasetsChanged()
      reload()
    })

  if (!api) return <p className="muted">This harness does not expose datasets.</p>
  return (
    <div className="node-panel">
      <h3>Golden dataset</h3>
      <p className="muted small">
        Each item is one customer visit: the input (who they are, what they say) and the expected
        output (outcome, items, total, which tools each role should use, a rubric for the judge).
        Every variant of the suite plays every selected item.
      </p>
      <label className="row">
        <span className="cap">dataset</span>
        <select
          value={draft.datasetId}
          onChange={(e) => onChange({ ...draft, datasetId: e.target.value, itemIds: null })}
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.itemCount}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <span className="cap">new</span>
        <input placeholder="name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="button" disabled={busy} onClick={() => void createDataset()}>
          empty
        </button>
        <button type="button" disabled={busy} onClick={() => void createDataset(draft.datasetId)}>
          clone this one
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}

      {!detail ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <h4>
            Items{' '}
            <span className="muted">
              ({selected ? `${selected.length} of ${detail.items.length}` : detail.items.length})
            </span>
            {selected && (
              <button
                type="button"
                className="link"
                onClick={() => onChange({ ...draft, itemIds: null })}
              >
                all
              </button>
            )}
          </h4>
          <ul className="dataset-items">
            {detail.items.map((s) => (
              <li key={s.id} className={isOn(s.id) ? '' : 'off'}>
                <label className="check">
                  <input type="checkbox" checked={isOn(s.id)} onChange={() => toggleItem(s.id)} />
                  <span className="title" title={s.customer.utterances[0]}>
                    {s.title}
                  </span>
                </label>
                <span className="meta">
                  {s.tags.map((t) => (
                    <span key={t} className={`tag ${t}`}>
                      {t}
                    </span>
                  ))}
                  <span className="muted mono">{shortScenarioId(s.id)}</span>
                  <span className="muted">
                    {s.expected.expectedOutcome ?? (s.expected.shouldRefuse ? 'refused' : 'served')}
                  </span>
                  {!builtin && (
                    <>
                      <button type="button" className="link" onClick={() => setEditing(s)}>
                        edit
                      </button>
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void removeItem(s.id)}
                      >
                        delete
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {builtin ? (
            <p className="muted small">
              The built-in set is read-only. Clone it to edit items or add your own.
            </p>
          ) : editing === null ? (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              + Add item
            </button>
          ) : null}
          {editing !== null && tools && (
            <ScenarioForm
              initial={editing === 'new' ? null : editing}
              tools={tools.tools}
              roleScopes={tools.roleScopes}
              onSubmit={submitItem}
              onCancel={() => setEditing(null)}
              busy={busy}
            />
          )}
        </>
      )}
    </div>
  )
}
