import type { ModelsInfo } from '../../harness/index.js'
import { roleLabel, words } from '../../lib/nomenclature.js'
import type { SuiteDraft } from '../suite-draft.js'
import { ModelPicker } from './ModelPicker.js'

const COPY = {
  cashier: { countKey: 'cashiers' as const, max: 2 },
  barista: { countKey: 'baristas' as const, max: 4 },
}

/** A sub-agent role: its model and how many instances run in parallel. */
export function AgentPanel({
  role,
  draft,
  onChange,
  models,
}: {
  role: 'cashier' | 'barista'
  draft: SuiteDraft
  onChange: (d: SuiteDraft) => void
  models: ModelsInfo
}) {
  const c = COPY[role]
  return (
    <div className="node-panel">
      <h3>{roleLabel(role)}</h3>
      <p className="muted small">
        A sub-agent: its own model, its own tool slice. {words().business} calls it the{' '}
        {words().roles[role]}.
      </p>
      <p className="muted small">{words().agentBlurbs[role]}</p>
      <ModelPicker
        label="model"
        value={draft.roles[role]}
        onChange={(v) => onChange({ ...draft, roles: { ...draft.roles, [role]: v } })}
        models={models}
        hint="a chat model with tool use"
      />
      <label className="row">
        <span className="cap" title="How many copies of this agent work cases in parallel">
          instances
        </span>
        <input
          type="number"
          min={1}
          max={c.max}
          value={draft.staffing[c.countKey]}
          onChange={(e) =>
            onChange({
              ...draft,
              staffing: { ...draft.staffing, [c.countKey]: Number(e.target.value) },
            })
          }
        />
      </label>
      <p className="muted small">
        Variants override this model per run; the value here is the base every variant starts from.
      </p>
    </div>
  )
}
