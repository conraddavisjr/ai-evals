import type { ModelsInfo } from '../../harness/index.js'

let listMounted = false

/** A model spec input backed by the server's presets; any spec matching the grammar is accepted. */
export function ModelPicker({
  label,
  value,
  onChange,
  models,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (spec: string) => void
  models: ModelsInfo
  placeholder?: string
  hint?: string
}) {
  const specs = Object.values(models.presets).flat()
  const live = value !== '' && !value.startsWith('mock:')
  const mount = !listMounted
  if (mount) listMounted = true
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
      <datalist id="exp-model-specs">
        {specs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  )
}
