import type { ModelsInfo, OrchestratorInfo } from '../../harness/index.js'
import type { SuiteDraft } from '../suite-draft.js'
import { ModelPicker } from './ModelPicker.js'

/** The orchestration layer: which engine runs the cases, and the orchestrator model that routes and reviews them. */
export function OrchestratorPanel({
  draft,
  onChange,
  models,
  orchestrators,
}: {
  draft: SuiteDraft
  onChange: (d: SuiteDraft) => void
  models: ModelsInfo
  orchestrators: OrchestratorInfo[]
}) {
  const current = orchestrators.find((o) => o.id === draft.orchestrator)
  return (
    <div className="node-panel">
      <h3>Orchestration</h3>
      <p className="muted small">
        The engine is code: it starts each case, hands it to the agents and closes it. The
        orchestrator model is the evaluation-model side of it: optionally it routes each case before
        agent 1 (classify intent, escalate), and it reviews every case before the judge.
      </p>
      <label className="row">
        <span className="cap">engine</span>
        <select
          value={draft.orchestrator}
          onChange={(e) => onChange({ ...draft, orchestrator: e.target.value })}
        >
          {orchestrators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {current && <p className="muted small">{current.description}</p>}
      <ModelPicker
        label="orchestrator model (manager)"
        value={draft.roles.manager}
        onChange={(v) => onChange({ ...draft, roles: { ...draft.roles, manager: v } })}
        models={models}
        hint="an evaluation model: Jev or any LLM"
      />
      <label className="check">
        <input
          type="checkbox"
          checked={draft.triageEnabled}
          onChange={(e) => onChange({ ...draft, triageEnabled: e.target.checked })}
        />{' '}
        router: classify each case before agent 1 (intent, escalate)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.reviewEnabled}
          onChange={(e) => onChange({ ...draft, reviewEnabled: e.target.checked })}
        />{' '}
        review every visit (ok / concern / escalate)
      </label>
      <label className="row">
        <span className="cap">arrival gap</span>
        <input
          type="range"
          min={0}
          max={8000}
          step={500}
          value={draft.arrivalGapMs}
          onChange={(e) => onChange({ ...draft, arrivalGapMs: Number(e.target.value) })}
        />
        <span className="muted">{draft.arrivalGapMs}ms</span>
      </label>
      <label className="row">
        <span className="cap">mock pacing</span>
        <select
          value={draft.pacing}
          onChange={(e) => onChange({ ...draft, pacing: e.target.value as SuiteDraft['pacing'] })}
        >
          <option value="instant">instant (experiments)</option>
          <option value="realistic">realistic (watchable in the cafe)</option>
        </select>
      </label>
    </div>
  )
}
