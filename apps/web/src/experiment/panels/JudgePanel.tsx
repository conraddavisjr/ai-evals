import type { ModelsInfo } from '../../harness/index.js'
import type { SuiteDraft } from '../suite-draft.js'
import { ModelPicker } from './ModelPicker.js'

/** The LLM-as-judge layer: which model scores each visit, blinded. */
export function JudgePanel({
  draft,
  onChange,
  models,
}: {
  draft: SuiteDraft
  onChange: (d: SuiteDraft) => void
  models: ModelsInfo
}) {
  return (
    <div className="node-panel">
      <h3>LLM as judge</h3>
      <p className="muted small">
        Sees a blinded transcript (roles, tool trail, outcome, ground truth; no names or model ids)
        and answers typed questions: correct, refusal appropriate, helpfulness, tone, tool use.
        Comparing judges is the point of a suite: put a different judge in each variant.
      </p>
      <ModelPicker
        label="judge"
        value={draft.roles.judge}
        onChange={(v) => onChange({ ...draft, roles: { ...draft.roles, judge: v } })}
        models={models}
        hint="an evaluation model: gateway:typesafe-ai/jev or any LLM"
      />
      <label className="check">
        <input
          type="checkbox"
          checked={draft.judgeEnabled}
          onChange={(e) => onChange({ ...draft, judgeEnabled: e.target.checked })}
        />{' '}
        judge every visit
      </label>
    </div>
  )
}
