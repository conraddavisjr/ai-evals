import type { Scenario } from '@cafe/protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtMs, fmtUsd, shortModel } from '../format.js'
import { type ModelsInfo, type RunRow, useHarness } from '../harness/index.js'
import { ROLES, type RoleKey, type RunDraft, toggleGroup } from './run-draft.js'

/** Rough per-visit token profile for the pre-run estimate. */
const TOKENS_PER_VISIT: Record<RoleKey, { steps: number; inPerStep: number; outPerStep: number }> =
  {
    cashier: { steps: 6, inPerStep: 1100, outPerStep: 70 },
    barista: { steps: 7, inPerStep: 900, outPerStep: 60 },
    manager: { steps: 2, inPerStep: 400, outPerStep: 8 },
    judge: { steps: 1, inPerStep: 700, outPerStep: 40 },
  }
/** Mirror of the server price table for the estimate (USD per MTok). */
const PRICE: Array<[RegExp, number, number]> = [
  [/^mock:/, 0, 0],
  [/claude-haiku/, 1, 5],
  [/claude-sonnet/, 3, 15],
  [/claude-opus|claude-fable/, 15, 75],
  [/gpt-5-nano/, 0.05, 0.4],
  [/gpt-5-mini/, 0.25, 2],
  [/gpt-5/, 1.25, 10],
  [/flash-lite/, 0.1, 0.4],
  [/flash/, 0.3, 2.5],
  [/jev/, 0.042, 0],
  [/^ollama/, 0, 0],
]
const priceOf = (spec: string): [number, number] =>
  (PRICE.find(([re]) => re.test(spec))?.slice(1) as [number, number] | undefined) ?? [3, 15]

export interface RunConfigPanelProps {
  models: ModelsInfo
  scenarios: Scenario[]
  draft: RunDraft
  onDraftChange: (next: RunDraft) => void
  /** Start the draft. Resolves when the run has been accepted; rejects with the reason otherwise. */
  onStart: () => Promise<void>
  onLoadRun: (run: RunRow) => void
  currentRunId: string | null
  busy: boolean
  /** The last failure to start a shift, wherever it was attempted from. */
  startError: string | null
}

export function RunConfigPanel({
  models,
  scenarios,
  draft,
  onDraftChange,
  onStart,
  onLoadRun,
  currentRunId,
  busy,
  startError,
}: RunConfigPanelProps) {
  const api = useHarness()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  const refreshRuns = useCallback(
    () =>
      api
        .runs()
        .then(setRuns)
        .catch(() => {}),
    [api],
  )
  useEffect(() => {
    void refreshRuns()
    const id = setInterval(refreshRuns, 5000)
    return () => clearInterval(id)
  }, [refreshRuns])

  const patch = (p: Partial<RunDraft>) => onDraftChange({ ...draft, ...p })
  const setRole = (role: RoleKey, spec: string) =>
    onDraftChange({ ...draft, roles: { ...draft.roles, [role]: spec } })

  const n = draft.scenarioIds.length
  const estimate = useMemo(() => {
    let usd = 0
    for (const role of ROLES) {
      const spec = draft.roles[role]
      const [pin, pout] = priceOf(spec)
      const prof = TOKENS_PER_VISIT[role]
      if (role === 'judge' && !draft.judgeEnabled) continue
      let steps = prof.steps
      // the manager's two calls per visit: door triage (tiny) and the post-visit review (reads the trail)
      if (role === 'manager') {
        steps = (draft.triageEnabled ? 1 : 0) + (draft.reviewEnabled ? 1 : 0)
        if (steps === 0) continue
      }
      usd += (n * steps * (prof.inPerStep * pin + prof.outPerStep * pout)) / 1_000_000
    }
    return usd
  }, [draft.roles, n, draft.judgeEnabled, draft.triageEnabled, draft.reviewEnabled])
  const anyLive = ROLES.some((r) => !draft.roles[r].startsWith('mock:'))

  const allSpecs = useMemo(() => Object.values(models.presets).flat(), [models])
  const grouped = useMemo(() => {
    const g: Record<string, Scenario[]> = {}
    for (const s of scenarios) {
      for (const t of s.tags) {
        const list = g[t] ?? []
        list.push(s)
        g[t] = list
      }
    }
    return g
  }, [scenarios])

  const submit = async () => {
    try {
      await onStart()
      void refreshRuns()
    } catch {
      // surfaced through startError
    }
  }

  const startRow = (
    <div className="start-row">
      <div>
        <div className="estimate">
          est. {fmtUsd(estimate)} {anyLive ? '' : '(all mock)'}
        </div>
        <div className="muted small">
          {n} customer{n === 1 ? '' : 's'} · {draft.staffing?.cashiers ?? 2} cashiers ·{' '}
          {draft.staffing?.baristas ?? 1} barista{(draft.staffing?.baristas ?? 1) === 1 ? '' : 's'}
        </div>
        {anyLive && !models.allowLive && (
          <div className="bad small">
            Live specs selected but live models are disabled on the server.
          </div>
        )}
      </div>
      <button type="button" className="primary big" disabled={busy || n === 0} onClick={submit}>
        {busy ? 'Running…' : 'Open the cafe'}
      </button>
    </div>
  )

  return (
    <div className="run-config">
      {startRow}
      {startError && <div className="error-box">{startError}</div>}

      <section>
        <h3>Staff models</h3>
        {ROLES.map((role) => (
          <label key={role} className="row">
            <span className="cap">{role}</span>
            <input
              list="model-specs"
              value={draft.roles[role]}
              onChange={(e) => setRole(role, e.target.value)}
              spellCheck={false}
            />
          </label>
        ))}
        <datalist id="model-specs">
          {allSpecs.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <p className="muted small">
          {models.allowLive
            ? 'Live models enabled.'
            : 'Live models are OFF (CAFE_ALLOW_LIVE_MODELS). Mock specs cost nothing.'}{' '}
          Keys:{' '}
          {Object.entries(models.providersConfigured)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(', ') || 'none'}
          . Judge & manager can be <code>gateway:typesafe-ai/jev</code>; staff need a chat model.
        </p>
      </section>

      <section>
        <h3>
          Customers <span className="muted">({n})</span>
          <button
            type="button"
            className="link"
            onClick={() => patch({ scenarioIds: scenarios.map((s) => s.id) })}
          >
            all
          </button>
          <button type="button" className="link" onClick={() => patch({ scenarioIds: [] })}>
            none
          </button>
        </h3>
        {Object.entries(grouped).map(([tag, list]) => {
          const picked = list.filter((s) => draft.scenarioIds.includes(s.id)).length
          return (
            <div key={tag} className="scenario-group">
              <button
                type="button"
                className={`tag ${tag} ${picked === 0 ? 'off' : ''}`}
                title={
                  picked === list.length
                    ? `Deselect all ${tag} customers`
                    : `Select all ${tag} customers`
                }
                aria-pressed={picked === list.length}
                onClick={() =>
                  patch({
                    scenarioIds: toggleGroup(
                      draft.scenarioIds,
                      list.map((s) => s.id),
                    ),
                  })
                }
              >
                {tag}{' '}
                <span className="count">
                  {picked}/{list.length}
                </span>
              </button>
              {list.map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={draft.scenarioIds.includes(s.id)}
                    onChange={(e) =>
                      patch({
                        scenarioIds: e.target.checked
                          ? [...draft.scenarioIds, s.id]
                          : draft.scenarioIds.filter((x) => x !== s.id),
                      })
                    }
                  />
                  <span title={s.customer.utterances[0]}>{s.title}</span>
                </label>
              ))}
            </div>
          )
        })}
      </section>

      <section>
        <h3>Shift</h3>
        <label className="row">
          <span>cashiers</span>
          <input
            type="number"
            min={1}
            max={2}
            value={draft.staffing?.cashiers ?? 2}
            onChange={(e) =>
              patch({ staffing: { ...draft.staffing, cashiers: Number(e.target.value) } })
            }
          />
          <span>baristas</span>
          <input
            type="number"
            min={1}
            max={4}
            value={draft.staffing?.baristas ?? 1}
            onChange={(e) =>
              patch({ staffing: { ...draft.staffing, baristas: Number(e.target.value) } })
            }
          />
        </label>
        <label className="row">
          <span>arrival gap</span>
          <input
            type="range"
            min={0}
            max={8000}
            step={500}
            value={draft.arrivalGapMs ?? 1500}
            onChange={(e) => patch({ arrivalGapMs: Number(e.target.value) })}
          />
          <span className="muted">{fmtMs(draft.arrivalGapMs ?? 1500)}</span>
        </label>
        <label className="row">
          <span>mock pacing</span>
          <select
            value={draft.pacing}
            onChange={(e) => patch({ pacing: e.target.value as RunDraft['pacing'] })}
          >
            <option value="realistic">realistic (0.8–2.5s per model step)</option>
            <option value="hang">realistic + barista hangs on order #2</option>
            <option value="instant">instant (tests)</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.triageEnabled ?? true}
            onChange={(e) => patch({ triageEnabled: e.target.checked })}
          />{' '}
          door triage by the manager
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.reviewEnabled ?? true}
            onChange={(e) => patch({ reviewEnabled: e.target.checked })}
          />{' '}
          manager reviews every visit
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.judgeEnabled ?? true}
            onChange={(e) => patch({ judgeEnabled: e.target.checked })}
          />{' '}
          judge every visit
        </label>
      </section>

      <section>
        <h3>
          Chaos{' '}
          <button type="button" className="link" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'hide' : 'show'}
          </button>
        </h3>
        {showAdvanced && (
          <>
            <label className="row">
              <span>tool error rate</span>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={draft.chaos?.toolErrorRate ?? 0}
                onChange={(e) =>
                  patch({ chaos: { ...draft.chaos, toolErrorRate: Number(e.target.value) } })
                }
              />
              <span className="muted">{Math.round((draft.chaos?.toolErrorRate ?? 0) * 100)}%</span>
            </label>
            <label className="row">
              <span>tool latency</span>
              <input
                type="range"
                min={0}
                max={5000}
                step={100}
                value={draft.chaos?.toolLatencyMs ?? 0}
                onChange={(e) =>
                  patch({ chaos: { ...draft.chaos, toolLatencyMs: Number(e.target.value) } })
                }
              />
              <span className="muted">{fmtMs(draft.chaos?.toolLatencyMs ?? 0)}</span>
            </label>
            <label className="row">
              <span>agent crash rate</span>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={draft.chaos?.agentCrashRate ?? 0}
                onChange={(e) =>
                  patch({ chaos: { ...draft.chaos, agentCrashRate: Number(e.target.value) } })
                }
              />
              <span className="muted">{Math.round((draft.chaos?.agentCrashRate ?? 0) * 100)}%</span>
            </label>
            <label className="row">
              <span>crashes hit</span>
              <select
                value={(draft.chaos?.crashRoles ?? ['cashier', 'barista', 'manager']).join(',')}
                onChange={(e) =>
                  patch({
                    chaos: {
                      ...draft.chaos,
                      crashRoles: e.target.value.split(',') as Array<
                        'cashier' | 'barista' | 'manager'
                      >,
                    },
                  })
                }
              >
                <option value="cashier,barista,manager">everyone</option>
                <option value="barista">baristas only</option>
                <option value="cashier">cashiers only</option>
              </select>
            </label>
            <label className="row">
              <span>seed</span>
              <input
                type="number"
                value={draft.chaos?.seed ?? 42}
                onChange={(e) => patch({ chaos: { ...draft.chaos, seed: Number(e.target.value) } })}
              />
            </label>
            <h3>Budget</h3>
            <label className="row">
              <span>max USD / run</span>
              <input
                type="number"
                step={0.1}
                min={0}
                value={draft.budget?.maxUsdPerRun ?? 0.5}
                onChange={(e) =>
                  patch({ budget: { ...draft.budget, maxUsdPerRun: Number(e.target.value) } })
                }
              />
              <span>max steps / agent</span>
              <input
                type="number"
                min={2}
                max={40}
                value={draft.budget?.maxStepsPerAgent ?? 12}
                onChange={(e) =>
                  patch({ budget: { ...draft.budget, maxStepsPerAgent: Number(e.target.value) } })
                }
              />
            </label>
          </>
        )}
      </section>

      <section>
        <h3>Recent shifts</h3>
        <p className="muted small">
          Every shift is persisted. Click one to load it: a finished shift replays from the start, a
          shift that is still running attaches live. Shifts the server lost track of (a restart
          mid-run) are shown as interrupted.
        </p>
        {runs.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="runs">
            {runs.slice(0, 15).map((r) => {
              // A run the server lost (restart mid-shift) is reaped as failed with an
              // "interrupted" error at boot; a running row nobody owns is the same thing.
              const interrupted =
                ((r.status === 'running' || r.status === 'pending') && !r.active) ||
                (r.status === 'failed' && (r.error?.startsWith('interrupted') ?? false))
              const status = interrupted ? 'interrupted' : r.status
              return (
                <li key={r.id} className={r.id === currentRunId ? 'current' : ''}>
                  <button type="button" className="link" onClick={() => onLoadRun(r)}>
                    {new Date(r.createdAt).toLocaleTimeString()} · {r.config.name} ·{' '}
                    {r.config.scenarioIds.length} customers
                  </button>
                  <span className={`pill ${status}`} title={r.error ?? undefined}>
                    {status}
                  </span>
                  <span className="muted small">
                    {ROLES.map((role) =>
                      shortModel(r.config.roles[role]).replace(/^mock:/, ''),
                    ).join(' / ')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
