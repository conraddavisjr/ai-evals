import {
  CUSTOMER_SPRITES,
  type Scenario,
  type ScenarioInput,
  ScenarioInput as ScenarioInputSchema,
  type ScenarioTag,
} from '@cafe/protocol'
import { useState } from 'react'
import { z } from 'zod'
import type { ToolInfo } from '../../harness/index.js'

const TAGS: ScenarioTag[] = ['happy', 'edge', 'adversarial', 'stress']
type Outcome = 'served' | 'refused' | 'failed'

interface ItemRow {
  name: string
  size: '' | 'small' | 'medium' | 'large'
  modifiers: string
}

/** Editor state: strings where the form needs them, converted to ScenarioInput on submit. */
interface FormState {
  title: string
  tags: ScenarioTag[]
  name: string
  loyaltyId: string
  utterances: string[]
  sprite: (typeof CUSTOMER_SPRITES)[number]
  outcome: Outcome
  items: ItemRow[]
  totalCents: string
  cashierTools: string[]
  baristaTools: string[]
  rubric: string
}

function fromScenario(s: Scenario | null): FormState {
  return {
    title: s?.title ?? '',
    tags: s?.tags ?? ['happy'],
    name: s?.customer.name ?? '',
    loyaltyId: s?.customer.loyaltyId ?? '',
    utterances: s?.customer.utterances.length ? [...s.customer.utterances] : [''],
    sprite: (s?.customer.sprite as FormState['sprite']) ?? 'customer_a',
    outcome: s?.expected.expectedOutcome ?? (s?.expected.shouldRefuse ? 'refused' : 'served'),
    items: (s?.expected.items ?? []).map((i) => ({
      name: i.name,
      size: (i.size as ItemRow['size']) ?? '',
      modifiers: (i.modifiers ?? []).join(', '),
    })),
    totalCents: s?.expected.totalCents !== undefined ? String(s.expected.totalCents) : '',
    cashierTools: s?.expected.cashierTools ?? [],
    baristaTools: s?.expected.baristaTools ?? [],
    rubric: s?.expected.rubric ?? '',
  }
}

function toInput(f: FormState): ScenarioInput {
  return ScenarioInputSchema.parse({
    title: f.title.trim(),
    tags: f.tags,
    customer: {
      name: f.name.trim(),
      ...(f.loyaltyId.trim() ? { loyaltyId: f.loyaltyId.trim() } : {}),
      utterances: f.utterances.map((u) => u.trim()).filter(Boolean),
      sprite: f.sprite,
    },
    expected: {
      items: f.items
        .filter((i) => i.name.trim())
        .map((i) => ({
          name: i.name.trim(),
          ...(i.size ? { size: i.size } : {}),
          ...(i.modifiers.trim()
            ? {
                modifiers: i.modifiers
                  .split(',')
                  .map((m) => m.trim())
                  .filter(Boolean),
              }
            : {}),
        })),
      ...(f.totalCents.trim() ? { totalCents: Number(f.totalCents) } : {}),
      cashierTools: f.cashierTools,
      baristaTools: f.baristaTools,
      shouldRefuse: f.outcome === 'refused',
      expectedOutcome: f.outcome,
      ...(f.rubric.trim() ? { rubric: f.rubric.trim() } : {}),
    },
  })
}

/**
 * One golden item: the input side (who walks in and what they say) and the
 * expected side (what should happen, which tools each role should touch, and a
 * rubric for the judge).
 */
export function ScenarioForm({
  initial,
  tools,
  roleScopes,
  onSubmit,
  onCancel,
  busy,
}: {
  initial: Scenario | null
  tools: ToolInfo[]
  roleScopes: Record<string, readonly string[]>
  onSubmit: (input: ScenarioInput) => Promise<void>
  onCancel: () => void
  busy: boolean
}) {
  const [f, setF] = useState<FormState>(() => fromScenario(initial))
  const [error, setError] = useState<string | null>(null)
  const patch = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }))
  const toolsFor = (role: 'cashier' | 'barista') =>
    tools.filter((t) => (roleScopes[role] ?? []).includes(t.scope))
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  const submit = async () => {
    setError(null)
    let input: ScenarioInput
    try {
      input = toInput(f)
    } catch (err) {
      setError(err instanceof z.ZodError ? z.prettifyError(err) : String(err))
      return
    }
    try {
      await onSubmit(input)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="scenario-form">
      <h4>{initial ? 'Edit item' : 'New item'}</h4>
      <label className="row">
        <span className="cap">title</span>
        <input value={f.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>
      <div className="row">
        <span className="cap">tags</span>
        <span className="tag-picks">
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={`tag ${t} ${f.tags.includes(t) ? '' : 'off'}`}
              aria-pressed={f.tags.includes(t)}
              onClick={() => patch({ tags: toggle(f.tags, t) as ScenarioTag[] })}
            >
              {t}
            </button>
          ))}
        </span>
      </div>

      <h5>Input: the customer</h5>
      <label className="row">
        <span className="cap">name</span>
        <input value={f.name} onChange={(e) => patch({ name: e.target.value })} />
      </label>
      <label className="row">
        <span className="cap">loyalty id</span>
        <input
          value={f.loyaltyId}
          placeholder="optional, e.g. L-1001"
          onChange={(e) => patch({ loyaltyId: e.target.value })}
        />
      </label>
      <label className="row">
        <span className="cap">look</span>
        <select
          value={f.sprite}
          onChange={(e) => patch({ sprite: e.target.value as FormState['sprite'] })}
        >
          {CUSTOMER_SPRITES.map((s) => (
            <option key={s} value={s}>
              {s.replace('customer_', 'customer ')}
            </option>
          ))}
        </select>
      </label>
      <div className="row top">
        <span className="cap">says</span>
        <div className="stack">
          {f.utterances.map((u, i) => (
            <div key={`u${i.toString()}`} className="inline-row">
              <textarea
                rows={2}
                value={u}
                placeholder={i === 0 ? 'What they say at the register' : 'Follow-up, if asked'}
                onChange={(e) =>
                  patch({ utterances: f.utterances.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              {f.utterances.length > 1 && (
                <button
                  type="button"
                  className="link"
                  onClick={() => patch({ utterances: f.utterances.filter((_, j) => j !== i) })}
                >
                  remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="link"
            onClick={() => patch({ utterances: [...f.utterances, ''] })}
          >
            + follow-up line
          </button>
        </div>
      </div>

      <h5>Expected: what should happen</h5>
      <div className="row">
        <span className="cap">outcome</span>
        <span className="segmented">
          {(['served', 'refused', 'failed'] as Outcome[]).map((o) => (
            <button
              key={o}
              type="button"
              className={f.outcome === o ? 'on' : ''}
              onClick={() => patch({ outcome: o })}
            >
              {o}
            </button>
          ))}
        </span>
      </div>
      <div className="row top">
        <span className="cap">items</span>
        <div className="stack">
          {f.items.map((it, i) => (
            <div key={`i${i.toString()}`} className="inline-row">
              <input
                placeholder="drink or food"
                value={it.name}
                onChange={(e) =>
                  patch({
                    items: f.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  })
                }
              />
              <select
                value={it.size}
                onChange={(e) =>
                  patch({
                    items: f.items.map((x, j) =>
                      j === i ? { ...x, size: e.target.value as ItemRow['size'] } : x,
                    ),
                  })
                }
              >
                <option value="">any size</option>
                <option value="small">small</option>
                <option value="medium">medium</option>
                <option value="large">large</option>
              </select>
              <input
                placeholder="modifiers, comma separated"
                value={it.modifiers}
                onChange={(e) =>
                  patch({
                    items: f.items.map((x, j) =>
                      j === i ? { ...x, modifiers: e.target.value } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="link"
                onClick={() => patch({ items: f.items.filter((_, j) => j !== i) })}
              >
                remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link"
            onClick={() => patch({ items: [...f.items, { name: '', size: '', modifiers: '' }] })}
          >
            + item
          </button>
          <span className="muted small">
            Mock staff only know the seeded menu; live models can handle anything the menu tool
            returns.
          </span>
        </div>
      </div>
      <label className="row">
        <span className="cap">total</span>
        <input
          type="number"
          placeholder="cents"
          value={f.totalCents}
          onChange={(e) => patch({ totalCents: e.target.value })}
        />
      </label>
      {(['cashier', 'barista'] as const).map((role) => (
        <div key={role} className="row top">
          <span className="cap">{role} tools</span>
          <div className="tool-checks">
            {toolsFor(role).map((t) => {
              const list = role === 'cashier' ? f.cashierTools : f.baristaTools
              return (
                <label key={t.name} className="check" title={t.description}>
                  <input
                    type="checkbox"
                    checked={list.includes(t.name)}
                    onChange={() =>
                      patch(
                        role === 'cashier'
                          ? { cashierTools: toggle(list, t.name) }
                          : { baristaTools: toggle(list, t.name) },
                      )
                    }
                  />
                  <code>{t.name}</code>
                </label>
              )
            })}
          </div>
        </div>
      ))}
      <label className="row top">
        <span className="cap">rubric</span>
        <textarea
          rows={2}
          value={f.rubric}
          placeholder="Anything the judge should weigh, in plain words"
          onChange={(e) => patch({ rubric: e.target.value })}
        />
      </label>
      {error && <div className="error-box">{error}</div>}
      <div className="form-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
          {initial ? 'Save item' : 'Add item'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
