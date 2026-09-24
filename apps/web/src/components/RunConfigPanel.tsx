import type { Scenario } from '@cafe/protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtMs, fmtUsd, shortModel } from '../format.js'
import { type DomainInfo, type ModelsInfo, type RunRow, useHarness } from '../harness/index.js'
import { CASE_NOUN, describeSpec, roleCount, roleLabel, words } from '../lib/nomenclature.js'
import { estimateRunUsd, ROLES, type RoleKey, type RunDraft, toggleGroup } from './run-draft.js'

export interface RunConfigPanelProps {
  models: ModelsInfo
  /** The business domains on offer; the picker hides when there is only one. */
  domains: DomainInfo[]
  onDomainChange: (id: string) => void
  scenarios: Scenario[]
  draft: RunDraft
  onDraftChange: (next: RunDraft) => void
  /** Start the draft. Resolves when the run has been accepted; rejects with the reason otherwise. */
  onStart: () => Promise<void>
  onLoadRun: (run: RunRow) => void
  currentRunId: string | null
  busy: boolean
  /** The last failure to start a run, wherever it was attempted from. */
  startError: string | null
}

export function RunConfigPanel({
  models,
  domains,
  onDomainChange,
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
  const estimate = useMemo(
    () =>
      estimateRunUsd(n, draft.roles, {
        judgeEnabled: draft.judgeEnabled ?? true,
        triageEnabled: draft.triageEnabled ?? true,
        reviewEnabled: draft.reviewEnabled ?? true,
      }),
    [draft.roles, n, draft.judgeEnabled, draft.triageEnabled, draft.reviewEnabled],
  )
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
          {n} {n === 1 ? CASE_NOUN.one : CASE_NOUN.many} ·{' '}
          {roleCount('cashier', draft.staffing?.cashiers ?? 2)} ·{' '}
          {roleCount('barista', draft.staffing?.baristas ?? 1)}
        </div>
        {anyLive && !models.allowLive && (
          <div className="bad small">
            Live specs selected but live models are disabled on the server.
          </div>
        )}
      </div>
      <button type="button" className="primary big" disabled={busy || n === 0} onClick={submit}>
        {busy ? 'Running…' : 'Start run'}
      </button>
    </div>
  )

  return (
    <div className="run-config">
      {startRow}
      {startError && <div className="error-box">{startError}</div>}

      {domains.length > 1 && (
        <section>
          <h3>Business domain</h3>
          <label className="row">
            <span>plays</span>
            <select
              value={draft.domain ?? 'cafe'}
              disabled={busy}
              onChange={(e) => onDomainChange(e.target.value)}
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            {domains.find((d) => d.id === (draft.domain ?? 'cafe'))?.blurb} The harness is the same
            for every domain; the pack brings the tools, prompts, golden cases and judge wording.
          </p>
        </section>
      )}

      <section>
        <h3>Agent models</h3>
        {ROLES.map((role) => (
          <div key={role} className="model-row">
            <label className="row">
              <span className="cap">{roleLabel(role)}</span>
              <input
                list="model-specs"
                value={draft.roles[role]}
                onChange={(e) => setRole(role, e.target.value)}
                spellCheck={false}
              />
            </label>
            <div className="muted small spec-desc">{describeSpec(draft.roles[role])}</div>
          </div>
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
          . The judge and the orchestrator can be <code>gateway:typesafe-ai/jev</code>; agents 1 and
          2 need a chat model with tool use.
        </p>
      </section>

      <section>
        <h3>
          Golden cases <span className="muted">({n})</span>
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
                  picked === list.length ? `Deselect all ${tag} cases` : `Select all ${tag} cases`
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
        <h3>Staffing and pacing</h3>
        <label className="row">
          <span>{roleLabel('cashier')}</span>
          <input
            type="number"
            min={1}
            max={2}
            value={draft.staffing?.cashiers ?? 2}
            onChange={(e) =>
              patch({ staffing: { ...draft.staffing, cashiers: Number(e.target.value) } })
            }
          />
          <span>{roleLabel('barista')}</span>
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
            <option value="hang">
              realistic + agent 2 ({words().roles.barista}) hangs on the second {words().workItem}
            </option>
            <option value="instant">instant (tests)</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.triageEnabled ?? true}
            onChange={(e) => patch({ triageEnabled: e.target.checked })}
          />{' '}
          door triage by the {roleLabel('manager')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.reviewEnabled ?? true}
            onChange={(e) => patch({ reviewEnabled: e.target.checked })}
          />{' '}
          {roleLabel('manager')} reviews every {CASE_NOUN.one}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.judgeEnabled ?? true}
            onChange={(e) => patch({ judgeEnabled: e.target.checked })}
          />{' '}
          judge every {CASE_NOUN.one}
        </label>
      </section>

      <DecisionPoints
        draft={draft}
        patch={patch}
        gateTools={domains.find((d) => d.id === (draft.domain ?? 'cafe'))?.gateTools ?? []}
      />

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
                <option value="barista">{roleLabel('barista')} only</option>
                <option value="cashier">{roleLabel('cashier')} only</option>
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
        <h3>Recent runs</h3>
        <p className="muted small">
          Every run is persisted. Click one to load it: a finished run replays from the start, a run
          that is still going attaches live. Runs the server lost track of (a restart mid-run) are
          shown as interrupted.
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
                    {r.config.scenarioIds.length} {CASE_NOUN.many}
                    {r.config.domain && r.config.domain !== 'cafe' ? ` · ${r.config.domain}` : ''}
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

/**
 * Where a decision model (Jev, or any LLM through the evaluation adapter) acts in
 * the run beyond judging: triage can route cases away at the door, and the action
 * gate approves or blocks the domain's riskiest tool calls before they execute.
 */
function DecisionPoints({
  draft,
  patch,
  gateTools,
}: {
  draft: RunDraft
  patch: (p: Partial<RunDraft>) => void
  gateTools: string[]
}) {
  const gate = { enabled: false, ...draft.gate }
  const threshold = gate.threshold ?? 0.5
  const setGate = (p: Partial<typeof gate>) => patch({ gate: { ...gate, ...p } })
  const triageOn = draft.triageEnabled ?? true
  return (
    <section>
      <h3>Decision points</h3>
      <p className="muted small">
        Typed, fast, calibrated decisions: where a decision model such as{' '}
        <code>gateway:typesafe-ai/jev</code> is strongest. Each uses the {roleLabel('manager')}
        {"'"}s model unless you pick another.
      </p>
      <label className="check" title={triageOn ? undefined : 'Turn door triage on first'}>
        <input
          type="checkbox"
          disabled={!triageOn}
          checked={triageOn && (draft.triageRoutes ?? false)}
          onChange={(e) => patch({ triageRoutes: e.target.checked })}
        />{' '}
        route: decline cases triage classes as adversarial before agent 1 sees them
      </label>
      <label
        className="check"
        title={gateTools.length ? undefined : 'This domain has no gated tools'}
      >
        <input
          type="checkbox"
          disabled={gateTools.length === 0}
          checked={gate.enabled && gateTools.length > 0}
          onChange={(e) => setGate({ enabled: e.target.checked })}
        />{' '}
        action gate on{' '}
        {gateTools.length ? gateTools.map((t) => <code key={t}>{t}</code>) : 'nothing'}
      </label>
      {gate.enabled && gateTools.length > 0 && (
        <>
          <label className="row">
            <span>gate model</span>
            <input
              list="model-specs"
              placeholder={`${draft.roles.manager} (orchestrator)`}
              value={gate.modelSpec ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim()
                const { modelSpec: _drop, ...rest } = gate
                patch({ gate: v ? { ...rest, modelSpec: v } : rest })
              }}
              spellCheck={false}
            />
          </label>
          <div className="muted small spec-desc">
            {describeSpec(gate.modelSpec ?? draft.roles.manager)}
          </div>
          <label className="row">
            <span>approve at</span>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={threshold}
              onChange={(e) => setGate({ threshold: Number(e.target.value) })}
            />
            <span className="muted">P ≥ {Math.round(threshold * 100)}%</span>
          </label>
        </>
      )}
    </section>
  )
}
