import type { ModelsInfo } from '../../harness/index.js'
import { describeSpec } from '../../lib/nomenclature.js'

let listMounted = false

/** A model spec input backed by the server's presets; any spec matching the grammar is accepted. */
export function ModelPicker({
  label,
  value,
  onChange,
  models,
  placeholder,
  hint,
  inherited,
}: {
  label: string
  value: string
  onChange: (spec: string) => void
  models: ModelsInfo
  placeholder?: string
  hint?: string
  /** The spec in force when the field is empty (a variant inheriting the base). */
  inherited?: string
}) {
  const specs = Object.values(models.presets).flat()
  const live = value !== '' && !value.startsWith('mock:')
  const mount = !listMounted
  if (mount) listMounted = true
  const effective = value || inherited || ''
  return (
    <label className="row model-picker">
      <span className="cap">{label}</span>
      <input
        list="exp-model-specs"
        value={value}
        placeholder={placeholder ?? 'inherit'}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {live && !models.allowLive && (
        <span className="bad small" title="CAFE_ALLOW_LIVE_MODELS is not set on the server">
          live off
        </span>
      )}
      {hint && <span className="muted small">{hint}</span>}
      {effective && (
        <span className="muted small spec-desc" title={effective}>
          {value ? '' : 'inherits · '}
          {describeSpec(effective)}
        </span>
      )}
      <datalist id="exp-model-specs">
        {specs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  )
}
