import type { SuiteVariant } from '@cafe/protocol'
import { ROLES, type RoleKey } from '../components/run-draft.js'
import { fmtUsd } from '../format.js'
import type { ModelsInfo, OrchestratorInfo } from '../harness/index.js'
import { roleLabel } from '../lib/nomenclature.js'
import { ModelPicker } from './panels/ModelPicker.js'
import {
  addVariant,
  anyLiveModel,
  effectiveRoles,
  estimateSuiteUsd,
  type SuiteDraft,
} from './suite-draft.js'

/**
 * The part of the experiment that sits outside the diagram: the variants. Each
 * variant loops the whole dataset with the base configuration under its own
 * overrides, so run 1 might use Jev as judge and run 2 Claude Sonnet, on identical
 * inputs.
 */
export function SuiteConfigPanel({
  draft,
  onChange,
  models,
  orchestrators,
  itemCount,
  onRun,
  running,
  error,
}: {
  draft: SuiteDraft
  onChange: (d: SuiteDraft) => void
  models: ModelsInfo
  orchestrators: OrchestratorInfo[]
  itemCount: number
  onRun: () => void
  running: boolean
  error: string | null
}) {
  const setVariant = (i: number, v: SuiteVariant) =>
    onChange({ ...draft, variants: draft.variants.map((x, j) => (j === i ? v : x)) })
  const setRole = (i: number, role: RoleKey, spec: string) => {
    const v = draft.variants[i]
    if (!v) return
    const roles = { ...v.roles } as Partial<Record<RoleKey, string>>
    // only an empty field means "inherit"; a value equal to the base is kept as typed
    if (spec === '') delete roles[role]
    else roles[role] = spec
    setVariant(i, { ...v, roles })
  }
  const total = draft.variants.length * draft.repeats
  const estimate = estimateSuiteUsd(draft, itemCount)
  const live = anyLiveModel(draft)
  return (
    <div className="suite-config">
      <div className="suite-head">
        <label className="row">
          <span className="cap">experiment</span>
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="row">
          <span className="cap">concurrency</span>
          <input
            type="number"
            min={1}
            max={8}
            value={draft.concurrency}
            onChange={(e) => onChange({ ...draft, concurrency: Number(e.target.value) })}
            title="How many variant runs execute at once. 1 is sequential."
          />
          <span className="cap">repeats</span>
          <input
            type="number"
            min={1}
            max={5}
            value={draft.repeats}
            onChange={(e) => onChange({ ...draft, repeats: Number(e.target.value) })}
            title="Play every variant this many times"
          />
          <span className="cap">max USD / run</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={draft.budget.maxUsdPerRun}
            onChange={(e) =>
              onChange({
                ...draft,
                budget: { ...draft.budget, maxUsdPerRun: Number(e.target.value) },
              })
            }
          />
        </label>
      </div>

      <div className="variants">
        {draft.variants.map((v, i) => {
          const eff = effectiveRoles(draft, v)
          return (
            // keyed by position so editing the name does not remount the card mid-keystroke
            <div key={i.toString()} className="variant">
              <div className="variant-head">
                <input
                  className="variant-name"
                  value={v.name}
                  onChange={(e) => setVariant(i, { ...v, name: e.target.value })}
                  aria-label="Variant name"
                />
                <span className="muted small">
                  {Object.keys(v.roles).length === 0 && !v.orchestrator
                    ? 'same as base'
                    : `${Object.keys(v.roles).length + (v.orchestrator ? 1 : 0)} override${Object.keys(v.roles).length + (v.orchestrator ? 1 : 0) === 1 ? '' : 's'}`}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    onChange({
                      ...draft,
                      variants: [...draft.variants, { ...v, name: `${v.name} copy` }],
                    })
                  }
                >
                  duplicate
                </button>
                {draft.variants.length > 1 && (
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      onChange({ ...draft, variants: draft.variants.filter((_, j) => j !== i) })
                    }
                  >
                    remove
                  </button>
                )}
              </div>
              {ROLES.map((role) => (
                <ModelPicker
                  key={role}
                  label={roleLabel(role)}
                  value={(v.roles as Partial<Record<RoleKey, string>>)[role] ?? ''}
                  placeholder={`${eff[role]} (base)`}
                  inherited={eff[role]}
                  onChange={(spec) => setRole(i, role, spec)}
                  models={models}
                />
              ))}
              {orchestrators.length > 1 && (
                <label className="row">
                  <span className="cap">engine</span>
                  <select
                    value={v.orchestrator ?? ''}
                    onChange={(e) => {
                      const { orchestrator: _o, ...rest } = v
                      setVariant(
                        i,
                        e.target.value ? { ...rest, orchestrator: e.target.value } : rest,
                      )
                    }}
                  >
                    <option value="">{draft.orchestrator} (base)</option>
                    {orchestrators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )
        })}
        <button type="button" className="add-variant" onClick={() => onChange(addVariant(draft))}>
          + Add variant
        </button>
      </div>

      <div className="start-row">
        <div>
          <div className="estimate">
            est. {fmtUsd(estimate)} {live ? '' : '(all mock)'}
          </div>
          <div className="muted small">
            {total} run{total === 1 ? '' : 's'} × {itemCount} item{itemCount === 1 ? '' : 's'} ={' '}
            {total * itemCount} visits
            {draft.concurrency > 1 ? ` · ${draft.concurrency} at a time` : ' · one run at a time'}
          </div>
          {live && !models.allowLive && (
            <div className="bad small">
              Live specs selected but live models are disabled on the server.
            </div>
          )}
        </div>
        <button
          type="button"
          className="primary big"
          disabled={running || itemCount === 0}
          onClick={onRun}
        >
          {running ? 'Starting…' : 'Run suite'}
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
    </div>
  )
}
