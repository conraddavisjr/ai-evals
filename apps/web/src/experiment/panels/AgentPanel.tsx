import type { ModelsInfo } from '../../harness/index.js'
import type { SuiteDraft } from '../suite-draft.js'
import { ModelPicker } from './ModelPicker.js'

const COPY = {
  cashier: {
    title: 'Cashier',
    blurb:
      'Takes the order: menu lookup, customer lookup, create and fill the order, charge, put the ticket on the rail. Refuses what it should.',
    countKey: 'cashiers' as const,
    max: 2,
  },
  barista: {
    title: 'Barista',
    blurb:
      'Pulls the next ticket, fetches the recipe, consumes inventory, logs the drink, marks it ready and calls the customer.',
    countKey: 'baristas' as const,
    max: 4,
  },
}

/** A sub-agent role: its model and how many are on shift. */
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
      <h3>{c.title}</h3>
      <p className="muted small">{c.blurb}</p>
      <ModelPicker
        label="model"
        value={draft.roles[role]}
        onChange={(v) => onChange({ ...draft, roles: { ...draft.roles, [role]: v } })}
        models={models}
        hint="a chat model with tool use"
      />
      <label className="row">
        <span className="cap">on shift</span>
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
