import { type CafeEvent, shortScenarioId } from '@cafe/protocol'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { fmtCents, fmtMs, fmtUsd, shortModel } from '../format.js'
import { type DomainInfo, type ToolInfo, useExperimentApi, useHarness } from '../harness/index.js'
import { AgentGlyph } from '../lib/AgentGlyph.js'
import {
  agentLabel,
  caseLabel,
  describeSpec,
  isAgentId,
  lineText,
  outcomeLabel,
  reviewLabel,
  roleLabel,
  verdictOf,
} from '../lib/nomenclature.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import type { AgentView, CustomerView } from '../state/cafe-state.js'
import {
  ANSWER_LABEL,
  type AnswerId,
  judgeEvidence,
  MOCK_RULE,
  MODEL_NOTE,
  readScale,
} from './judge-explain.js'
import { VerdictPill } from './TransactionList.js'

/** Selections the Inspector understands: an agent id, a case's customer id, or `tool:<name>`. */
export const toolSelection = (name: string) => `tool:${name}`

interface Props {
  player: TimelinePlayer
  selectedId: string | null
  /** Open another view (an agent, a case, a tool); the current one goes on the back stack. */
  onSelect: (id: string) => void
  /** Return to the previous view, when there is one. */
  onBack?: (() => void) | undefined
}

/**
 * The Inspector: one consolidated view per thing you click. A case shows its
 * golden expectation (outcome, lines, rubric, the tools each agent should use)
 * next to what happened; a tool shows what it does, who holds it and every call
 * in the run; an agent shows its persona, its tool slice and its latest turn.
 */
export function AgentInspector({ player, selectedId, onSelect, onBack }: Props) {
  const s = player.state
  const catalog = useToolCatalog(s.config?.domain ?? 'cafe')
  const back = onBack ? (
    <button type="button" className="link inspector-back" onClick={onBack}>
      ← back
    </button>
  ) : null
  if (!selectedId)
    return (
      <p className="muted">
        Click an agent or a case (a character in the cafe scenes, a badge on the Trace board), a
        tool, or a red “!” to read a failure.
      </p>
    )
  if (selectedId.startsWith('tool:'))
    return (
      <>
        {back}
        <ToolDetail
          name={selectedId.slice('tool:'.length)}
          player={player}
          catalog={catalog}
          onSelect={onSelect}
        />
      </>
    )
  if (selectedId.startsWith('judge:'))
    return (
      <>
        {back}
        <JudgeDetail txId={selectedId.slice(6)} player={player} onSelect={onSelect} />
      </>
    )
  if (selectedId.startsWith('review:'))
    return (
      <>
        {back}
        <ReviewDetail txId={selectedId.slice(7)} player={player} onSelect={onSelect} />
      </>
    )
  if (selectedId === 'judge-1')
    return (
      <>
        {back}
        <JudgeOverview player={player} onSelect={onSelect} />
      </>
    )
  const agent = s.agents[selectedId]
  if (agent)
    return (
      <>
        {back}
        <AgentDetail agent={agent} player={player} catalog={catalog} onSelect={onSelect} />
      </>
    )
  const customer = s.customers[selectedId]
  if (customer)
    return (
      <>
        {back}
        <CaseDetail customer={customer} player={player} catalog={catalog} onSelect={onSelect} />
      </>
    )
  return (
    <>
      {back}
      <p className="muted">
        {isAgentId(selectedId)
          ? `${agentLabel(selectedId)} has not started at this point in the run.`
          : 'That case has not arrived at this point in the run.'}
      </p>
    </>
  )
}

type Catalog = { tools: ToolInfo[]; roleScopes: Record<string, readonly string[]> } | null
const catalogCache = new Map<string, Promise<NonNullable<Catalog>>>()

/** The domain's tool catalogue (descriptions, scopes, input schemas), fetched once per domain. */
function useToolCatalog(domain: string): Catalog {
  const api = useExperimentApi()
  const [catalog, setCatalog] = useState<Catalog>(null)
  useEffect(() => {
    if (!api) return
    let live = true
    let p = catalogCache.get(domain)
    if (!p) {
      p = api.tools(domain)
      catalogCache.set(domain, p)
      p.catch(() => catalogCache.delete(domain))
    }
    p.then((c) => live && setCatalog(c)).catch(() => {})
    return () => {
      live = false
    }
  }, [api, domain])
  return catalog
}

/** Which agent slots hold a tool's scope. */
const holdersOf = (tool: ToolInfo | undefined, catalog: Catalog): string[] =>
  tool && catalog
    ? Object.entries(catalog.roleScopes)
        .filter(([, scopes]) => scopes.includes(tool.scope))
        .map(([role]) => role)
    : []

interface CallRecord {
  callId: string
  agentId: string
  txId: string | undefined
  tool: string
  args: Record<string, unknown>
  ok?: boolean | undefined
  latencyMs?: number | undefined
  result?: unknown
  error?: string | undefined
}

/**
 * Every tool call applied so far, with its return. A claim is called before it
 * binds agent 2 to a case, so a call takes the case its return carries.
 */
function toolCalls(events: CafeEvent[]): CallRecord[] {
  const byId = new Map<string, CallRecord>()
  for (const e of events) {
    if (e.type === 'agent.tool_called')
      byId.set(e.callId, {
        callId: e.callId,
        agentId: e.agentId,
        txId: e.txId,
        tool: e.tool,
        args: e.args,
      })
    else if (e.type === 'agent.tool_returned') {
      const c = byId.get(e.callId)
      if (!c) continue
      c.ok = e.ok
      c.latencyMs = e.latencyMs
      c.txId = c.txId ?? e.txId
      if (e.ok) c.result = e.result
      else c.error = e.error
    }
  }
  return [...byId.values()]
}

function ToolChip({
  name,
  onSelect,
  state,
}: {
  name: string
  onSelect: (id: string) => void
  /** Against a case's expectation: called, expected but not called, called but not expected. */
  state?: 'called' | 'missing' | 'extra' | undefined
}) {
  const glyph =
    state === 'called' ? '✓ ' : state === 'missing' ? '○ ' : state === 'extra' ? '! ' : ''
  return (
    <button
      type="button"
      className={`tool-chip ${state ?? ''}`}
      title={
        state === 'missing'
          ? 'expected, not called (yet)'
          : state === 'extra'
            ? 'called, not expected'
            : state === 'called'
              ? 'expected and called'
              : 'about this tool'
      }
      onClick={() => onSelect(toolSelection(name))}
    >
      <span className="mcp-tag">MCP</span>
      {glyph}
      {name}
    </button>
  )
}

/** A summary that opens to the full text: "Read more" / "Read less". */
function ReadMore({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="read-more">
      {open ? children : summary}
      <button type="button" className="link" onClick={() => setOpen((o) => !o)}>
        {open ? 'Read less' : 'Read more'}
      </button>
    </div>
  )
}

// ---------- a case ----------

function CaseDetail({
  customer,
  player,
  catalog,
  onSelect,
}: {
  customer: CustomerView
  player: TimelinePlayer
  catalog: Catalog
  onSelect: (id: string) => void
}) {
  const s = player.state
  const order = customer.orderId ? s.orders[customer.orderId] : undefined
  const verdict = s.verdicts[customer.txId]
  const review = s.reviews[customer.txId]
  const exp = customer.expected
  const index = Object.values(s.customers)
    .sort((a, b) => a.arrivedAt - b.arrivedAt)
    .findIndex((c) => c.customerId === customer.customerId)
  const calls = useMemo(
    () => toolCalls(s.applied).filter((c) => c.txId === customer.txId),
    [s.applied, customer.txId],
  )
  const calledBy = (role: string) =>
    new Set(calls.filter((c) => s.agents[c.agentId]?.role === role).map((c) => c.tool))
  return (
    <div className="inspector">
      <h3>
        {caseLabel(index)} <span>{customer.title ?? shortScenarioId(customer.scenarioId)}</span>
      </h3>
      <div className="muted small">
        golden case <code>{shortScenarioId(customer.scenarioId)}</code> · persona {customer.name}
        {exp?.tags.length ? ` · ${exp.tags.join(', ')}` : ''}
      </div>
      <blockquote>“{customer.utterance}”</blockquote>
      <dl>
        <dt>result</dt>
        <dd>
          <VerdictPill outcome={customer.outcome} expected={exp?.outcome} />{' '}
          {!customer.outcome && <span className="muted">at {customer.station}</span>}
        </dd>
      </dl>

      <h4>Expected</h4>
      {!exp ? (
        <p className="muted">This run predates recorded expectations.</p>
      ) : (
        <dl>
          <dt>outcome</dt>
          <dd>
            {outcomeLabel(exp.outcome)}
            {exp.shouldRefuse ? (
              <span className="muted"> · the right answer is to decline</span>
            ) : null}
          </dd>
          {exp.items && exp.items.length > 0 && (
            <>
              <dt>lines</dt>
              <dd>
                <ul className="items">
                  {exp.items.map((i) => (
                    <li key={`${i.name}-${i.size ?? ''}-${(i.modifiers ?? []).join('+')}`}>
                      {lineText({ quantity: 1, ...i })}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {exp.totalCents !== undefined && (
            <>
              <dt>total</dt>
              <dd>{fmtCents(exp.totalCents)}</dd>
            </>
          )}
          {exp.rubric && (
            <>
              <dt>rubric</dt>
              <dd>{exp.rubric}</dd>
            </>
          )}
        </dl>
      )}

      {exp && (exp.cashierTools.length > 0 || exp.baristaTools.length > 0 || calls.length > 0) && (
        <>
          <h4>Expected tools</h4>
          <ToolTally exp={exp} calledBy={calledBy} />
          <div className="tool-key">
            <span>
              <b className="k called">✓</b> expected and called
            </span>
            <span>
              <b className="k missing">○</b> expected, not called
            </span>
            <span>
              <b className="k extra">!</b> called, not expected
            </span>
          </div>
          {(['cashier', 'barista'] as const).map((role) => {
            const want = role === 'cashier' ? exp.cashierTools : exp.baristaTools
            const got = calledBy(role)
            const extra = [...got].filter((t) => !want.includes(t))
            if (want.length === 0 && extra.length === 0) return null
            return (
              <div key={role} className="tool-group">
                <div className="muted small">
                  <AgentGlyph /> {roleLabel(role)}
                </div>
                <div className="tool-chips">
                  {want.map((t) => (
                    <ToolChip
                      key={t}
                      name={t}
                      onSelect={onSelect}
                      state={got.has(t) ? 'called' : 'missing'}
                    />
                  ))}
                  {extra.map((t) => (
                    <ToolChip key={t} name={t} onSelect={onSelect} state="extra" />
                  ))}
                </div>
              </div>
            )
          })}
          <p className="muted small">
            Tools do not decide pass or fail: the outcome and the work item do. A missed tool lowers
            the run’s tool recall; an unexpected one lowers its precision.
          </p>
          {!catalog && <p className="muted small">Loading tool descriptions…</p>}
        </>
      )}

      {(customer.triage || order || calls.length > 0 || review || verdict) && (
        <h4>What happened</h4>
      )}
      <dl>
        {customer.triage && (
          <>
            <dt>router</dt>
            <dd>
              {customer.triage.intent} · escalate {Math.round(customer.triage.probability * 100)}%
            </dd>
          </>
        )}
        {order && (
          <>
            <dt>work item</dt>
            <dd>
              {order.status} · {fmtCents(order.totalCents)}
              <ul className="items">
                {order.items.map((i) => (
                  <li
                    key={`${i.menuItemId}-${i.size}-${i.modifiers.join('+')}-${i.unitPriceCents}`}
                  >
                    {lineText(i)} · {fmtCents(i.unitPriceCents)}
                  </li>
                ))}
              </ul>
              {order.failReason && <div className="bad">{order.failReason}</div>}
            </dd>
          </>
        )}
        {calls.length > 0 && (
          <>
            <dt>agents</dt>
            <dd>
              {[...new Set(calls.map((c) => c.agentId))].map((id) => (
                <button
                  key={id}
                  type="button"
                  className="link agent-link"
                  onClick={() => onSelect(id)}
                >
                  <AgentGlyph /> {agentLabel(id)}
                </button>
              ))}
            </dd>
          </>
        )}
        {review && (
          <>
            <dt>
              <button
                type="button"
                className="link"
                onClick={() => onSelect(`review:${customer.txId}`)}
              >
                orchestrator review
              </button>
            </dt>
            <dd>
              <span className={`pill review-${review.verdict}`}>{reviewLabel(review.verdict)}</span>{' '}
              <code>{shortModel(review.modelSpec)}</code>
              <div>{review.summary}</div>
            </dd>
          </>
        )}
        {verdict && (
          <>
            <dt>
              <button
                type="button"
                className="link"
                onClick={() => onSelect(`judge:${customer.txId}`)}
              >
                judge
              </button>
            </dt>
            <dd>
              <code>{shortModel(verdict.judgeSpec)}</code> in {fmtMs(verdict.latencyMs)}
              <ul className="items">
                <li>correct: {Math.round(verdict.answers.correct.probability * 100)}%</li>
                <li>
                  refusal appropriate:{' '}
                  {Math.round(verdict.answers.refusalAppropriate.probability * 100)}%
                </li>
                <li>
                  helpfulness {verdict.answers.helpfulness.score}/5 · tone{' '}
                  {verdict.answers.tone.score}
                  /5 · tool use {verdict.answers.toolUseQuality.score}/5
                </li>
              </ul>
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

// ---------- a tool ----------

function ToolDetail({
  name,
  player,
  catalog,
  onSelect,
}: {
  name: string
  player: TimelinePlayer
  catalog: Catalog
  onSelect: (id: string) => void
}) {
  const s = player.state
  const tool = catalog?.tools.find((t) => t.name === name)
  const holders = holdersOf(tool, catalog)
  const calls = useMemo(
    () => toolCalls(s.applied).filter((c) => c.tool === name),
    [s.applied, name],
  )
  const failed = calls.filter((c) => c.ok === false).length
  const lat = calls
    .flatMap((c) => (c.latencyMs === undefined ? [] : [c.latencyMs]))
    .sort((a, b) => a - b)
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : undefined
  const callers = [...new Set(calls.map((c) => c.agentId))]
  // each call links to its case: "Case 12"
  const byArrival = Object.values(s.customers).sort((a, b) => a.arrivedAt - b.arrivedAt)
  const caseOf = (txId: string | undefined) => {
    const i = byArrival.findIndex((c) => c.txId === txId)
    return i < 0 ? null : { label: caseLabel(i), id: byArrival[i]?.customerId as string }
  }
  const firstSentence = tool?.description.match(/^.*?[.!?](\s|$)/)?.[0] ?? tool?.description
  return (
    <div className="inspector">
      <h3>
        <span className="mcp-tag">MCP</span> <code>{name}</code>
      </h3>
      <div className="muted small">
        {tool ? (
          <>
            scope <code>{tool.scope}</code> · held by{' '}
            {holders.length ? holders.map(roleLabel).join(', ') : 'no agent slot'}
          </>
        ) : catalog ? (
          'not in this domain’s catalogue (a remote MCP tool, or one no agent was given)'
        ) : (
          'loading…'
        )}
      </div>
      {tool && (
        <ReadMore summary={<p>{firstSentence}</p>}>
          <p>{tool.description}</p>
          <h4>Parameters</h4>
          <pre className="schema">{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre>
        </ReadMore>
      )}
      <h4>In this run</h4>
      <dl>
        <dt>calls</dt>
        <dd>
          {calls.length}
          {failed ? <span className="bad"> · {failed} failed</span> : null}
          {p50 !== undefined ? ` · p50 ${fmtMs(p50)}` : ''}
        </dd>
        {callers.length > 0 && (
          <>
            <dt>called by</dt>
            <dd>
              {callers.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="link agent-link"
                  onClick={() => onSelect(id)}
                >
                  <AgentGlyph /> {agentLabel(id)}
                </button>
              ))}
            </dd>
          </>
        )}
      </dl>
      {calls.length > 0 && (
        <>
          <h4>Latest calls</h4>
          <ol className="calls">
            {calls
              .slice(-8)
              .reverse()
              .map((c) => (
                <ToolCallRow
                  key={c.callId}
                  c={c}
                  caller={agentLabel(c.agentId)}
                  caseRef={caseOf(c.txId)}
                  onSelect={onSelect}
                />
              ))}
          </ol>
        </>
      )}
    </div>
  )
}

// ---------- an agent ----------

function AgentDetail({
  agent,
  player,
  catalog,
  onSelect,
}: {
  agent: AgentView
  player: TimelinePlayer
  catalog: Catalog
  onSelect: (id: string) => void
}) {
  const now = player.clockEpoch()
  const med = agent.stepLatencies.length
    ? [...agent.stepLatencies].sort((a, b) => a - b)[Math.floor(agent.stepLatencies.length / 2)]
    : null
  const scopes = catalog?.roleScopes[agent.role] ?? []
  const slice = catalog?.tools.filter((t) => scopes.includes(t.scope)) ?? []
  const persona = agent.persona
  const personaLead = persona?.split(/\n\s*\n|\n/)[0] ?? ''
  return (
    <div className="inspector">
      <h3>
        <AgentGlyph className="big" /> {agent.name}{' '}
        <span className="muted">
          {roleLabel(agent.role)} · <code>{agent.agentId}</code>
        </span>
      </h3>
      <h4>Persona</h4>
      {persona ? (
        <ReadMore summary={<p>{personaLead}</p>}>
          <p className="persona">{persona}</p>
        </ReadMore>
      ) : (
        <p className="muted">This run predates recorded personas.</p>
      )}
      <dl>
        <dt>model</dt>
        <dd>
          <code>{shortModel(agent.modelSpec)}</code>
        </dd>
        <dt>status</dt>
        <dd>
          {agent.busy
            ? `working · step ${agent.step} · ${fmtMs(agent.workStartedAt ? now - agent.workStartedAt : 0)}`
            : 'idle'}{' '}
          · at {agent.station}
        </dd>
        {agent.currentTool && (
          <>
            <dt>calling</dt>
            <dd>
              <code>{agent.currentTool}</code>
            </dd>
          </>
        )}
        <dt>usage</dt>
        <dd>
          {agent.usage.calls} model calls · {agent.usage.inputTokens.toLocaleString()} in /{' '}
          {agent.usage.outputTokens.toLocaleString()} out · {fmtUsd(agent.usage.costUsd)}
        </dd>
        <dt>model latency</dt>
        <dd>
          median {fmtMs(med)} · last {fmtMs(agent.stepLatencies.at(-1))}
        </dd>
        {agent.scopeViolations > 0 && (
          <>
            <dt>scope violations</dt>
            <dd className="bad">{agent.scopeViolations}</dd>
          </>
        )}
      </dl>
      {slice.length > 0 && (
        <>
          <h4>Tool slice</h4>
          <div className="tool-chips">
            {slice.map((t) => (
              <ToolChip key={t.name} name={t.name} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
      {agent.error && (
        <div className="error-box">
          <strong>{agent.error.kind}</strong>: {agent.error.message}
        </div>
      )}
      {agent.lastSpoke && <blockquote>“{agent.lastSpoke.text}”</blockquote>}
      <h4>Tool calls this turn</h4>
      {agent.toolCalls.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ol className="calls">
          {agent.toolCalls.map((c) => (
            <ToolCallRow key={c.callId} c={c} onAbout={() => onSelect(toolSelection(c.tool))} />
          ))}
        </ol>
      )}
    </div>
  )
}

function ToolCallRow({
  c,
  caller,
  onAbout,
  caseRef,
  onSelect,
}: {
  c: {
    tool: string
    args: Record<string, unknown>
    ok?: boolean | undefined
    latencyMs?: number | undefined
    result?: unknown
    error?: string | undefined
  }
  /** Who made the call, when the list mixes agents. */
  caller?: string | undefined
  /** Open the tool's own view. */
  onAbout?: (() => void) | undefined
  /** The case the call belongs to, when the list mixes cases. */
  caseRef?: { label: string; id: string } | null | undefined
  onSelect?: ((id: string) => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const status = c.ok === undefined ? '…' : c.ok ? '✓' : '✗'
  return (
    <li className={c.ok === false ? 'bad' : ''}>
      <button type="button" className="link mono" onClick={() => setOpen((o) => !o)}>
        {status} {c.tool} <span className="muted">{fmtMs(c.latencyMs)}</span>
      </button>
      {caller && <span className="muted small"> · {caller}</span>}
      {caseRef && onSelect && (
        <button type="button" className="link small about" onClick={() => onSelect(caseRef.id)}>
          {caseRef.label}
        </button>
      )}
      {onAbout && (
        <button
          type="button"
          className="link small about"
          onClick={onAbout}
          title="About this tool"
        >
          about
        </button>
      )}
      {open && (
        <pre>
          {JSON.stringify(c.args, null, 1)}
          {'\n→ '}
          {c.error ?? JSON.stringify(c.result, null, 1)?.slice(0, 1200)}
        </pre>
      )}
    </li>
  )
}

// ---------- evaluation: the judge and the orchestrator review ----------

/** The case a txId belongs to, with its arrival index for "Case N". */
function caseOfTx(player: TimelinePlayer, txId: string) {
  const byArrival = Object.values(player.state.customers).sort((a, b) => a.arrivedAt - b.arrivedAt)
  const index = byArrival.findIndex((c) => c.txId === txId)
  return index < 0 ? null : { customer: byArrival[index] as CustomerView, index }
}

/** USD and latency of the evaluation calls a role made for a case. */
function evalUsage(player: TimelinePlayer, txId: string, role: 'judge' | 'manager') {
  let costUsd = 0
  let inputTokens = 0
  for (const e of player.state.applied)
    if (e.type === 'model.usage' && e.txId === txId && e.role === role) {
      costUsd += e.costUsd
      inputTokens += e.inputTokens
    }
  return { costUsd, inputTokens }
}

/** A labelled bar: a probability or a 1-5 score. */
function Meter({
  label,
  value,
  max,
  text,
}: {
  label: string
  value: number
  max: number
  text: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const tone = pct >= 66 ? 'good' : pct >= 40 ? 'mid' : 'low'
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <span className="meter-track" aria-hidden="true">
        <i className={tone} style={{ width: `${pct}%` }} />
      </span>
      <span className="meter-value">{text}</span>
    </div>
  )
}

/** Fetched once per run and shared: what each evaluation call read. */
const briefCache = new Map<string, Promise<Map<string, string>>>()
function useBrief(kind: 'judge' | 'review', runId: string | null, txId: string, want: boolean) {
  const api = useHarness()
  const [brief, setBrief] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!want || !runId) return
    const key = `${kind}:${runId}`
    let p = briefCache.get(key)
    if (!p) {
      p =
        kind === 'judge'
          ? api
              .judgements(runId)
              .then((rows) => new Map(rows.map((r) => [r.txId, r.blindedTranscript])))
          : (api.reviews?.(runId) ?? Promise.resolve([])).then(
              (rows) => new Map(rows.map((r) => [r.txId, r.brief])),
            )
      briefCache.set(key, p)
      p.catch(() => briefCache.delete(key))
    }
    let live = true
    p.then((m) => live && setBrief(m.get(txId) ?? null)).catch(() => live && setBrief(null))
    return () => {
      live = false
    }
  }, [api, kind, runId, txId, want])
  return brief
}

function Brief({
  kind,
  player,
  txId,
}: {
  kind: 'judge' | 'review'
  player: TimelinePlayer
  txId: string
}) {
  const [open, setOpen] = useState(false)
  const brief = useBrief(kind, player.state.runId, txId, open)
  const pretty = useMemo(() => {
    if (!brief) return brief
    try {
      return JSON.stringify(JSON.parse(brief), null, 2)
    } catch {
      return brief
    }
  }, [brief])
  return (
    <div className="read-more">
      <button type="button" className="link" onClick={() => setOpen((o) => !o)}>
        {open
          ? 'Read less'
          : kind === 'judge'
            ? 'Read more: what the judge saw'
            : 'Read more: the brief it read'}
      </button>
      {open && (
        <pre className="schema">
          {pretty === undefined
            ? 'loading…'
            : pretty === null
              ? 'Not stored for this run.'
              : pretty}
        </pre>
      )}
    </div>
  )
}

function JudgeDetail({
  txId,
  player,
  onSelect,
}: {
  txId: string
  player: TimelinePlayer
  onSelect: (id: string) => void
}) {
  const s = player.state
  const found = caseOfTx(player, txId)
  const v = s.verdicts[txId]
  if (!found) return <p className="muted">That case has not arrived at this point in the run.</p>
  const { customer, index } = found
  const truth = verdictOf(customer.outcome, customer.expected?.outcome)
  const usage = evalUsage(player, txId, 'judge')
  return (
    <div className="inspector">
      <h3>
        <span className="eval-glyph" aria-hidden="true">
          ⚖
        </span>{' '}
        Judge <span className="muted">· blinded</span>
      </h3>
      <button
        type="button"
        className="link case-link"
        onClick={() => onSelect(customer.customerId)}
      >
        {caseLabel(index)} · {customer.title ?? shortScenarioId(customer.scenarioId)}
      </button>
      {!v ? (
        <p className="muted">Not judged yet at this point in the run.</p>
      ) : (
        <>
          <dl>
            <dt>ground truth</dt>
            <dd>
              <VerdictPill outcome={customer.outcome} expected={customer.expected?.outcome} />
            </dd>
            <dt>judge says</dt>
            <dd>
              {(() => {
                const saysRight = v.answers.correct.probability >= 0.5
                const agrees =
                  truth === 'pass' || truth === 'fail' ? saysRight === (truth === 'pass') : null
                return (
                  <>
                    {saysRight ? 'right' : 'wrong'} (
                    {Math.round(v.answers.correct.probability * 100)}%){' '}
                    {agrees !== null && (
                      <span className={`pill ${agrees ? 'verdict-pass' : 'verdict-fail'}`}>
                        {agrees ? '✓ Agrees with ground truth' : '✗ Disagrees with ground truth'}
                      </span>
                    )}
                  </>
                )
              })()}
            </dd>
          </dl>
          <h4>Answers</h4>
          <p className="muted small">
            Hover an answer for the question; click it for the evidence.
          </p>
          <JudgeAnswers v={v} player={player} txId={txId} />
          <p className="muted small">
            The percentages are the judge’s confidence, not a share of anything. The judge never
            sees which model played which agent.
          </p>
          <dl>
            <dt>model</dt>
            <dd>
              <code>{shortModel(v.judgeSpec)}</code>
              <div className="muted small">{describeSpec(v.judgeSpec)}</div>
            </dd>
            <dt>latency</dt>
            <dd>{fmtMs(v.latencyMs)}</dd>
            <dt>cost</dt>
            <dd>
              {fmtUsd(usage.costUsd)} · {usage.inputTokens.toLocaleString()} tokens in
            </dd>
          </dl>
          <Brief kind="judge" player={player} txId={txId} />
        </>
      )}
    </div>
  )
}

const ISSUE_LABEL: Record<string, string> = {
  wrong_result: 'wrong result',
  wasted_tool_calls: 'wasted tool calls',
  scope_breach: 'scope breach',
  unrecovered_error: 'unrecovered error',
  poor_tone: 'poor tone',
}

function ReviewDetail({
  txId,
  player,
  onSelect,
}: {
  txId: string
  player: TimelinePlayer
  onSelect: (id: string) => void
}) {
  const s = player.state
  const found = caseOfTx(player, txId)
  const r = s.reviews[txId]
  if (!found) return <p className="muted">That case has not arrived at this point in the run.</p>
  const { customer, index } = found
  const latency = s.applied.find((e) => e.type === 'manager.reviewed' && e.txId === txId)
  const usage = evalUsage(player, txId, 'manager')
  return (
    <div className="inspector">
      <h3>
        <AgentGlyph className="big" /> Orchestrator review
      </h3>
      <button
        type="button"
        className="link case-link"
        onClick={() => onSelect(customer.customerId)}
      >
        {caseLabel(index)} · {customer.title ?? shortScenarioId(customer.scenarioId)}
      </button>
      {!r ? (
        <p className="muted">Not reviewed yet at this point in the run.</p>
      ) : (
        <>
          <dl>
            <dt>filed as</dt>
            <dd>
              <span className={`pill review-${r.verdict}`}>{reviewLabel(r.verdict)}</span>
            </dd>
            <dt>issues</dt>
            <dd>
              {r.issues.length === 0 ? (
                <span className="muted">none flagged</span>
              ) : (
                <ul className="items">
                  {r.issues.map((i) => (
                    <li key={i} className="bad">
                      {ISSUE_LABEL[i] ?? i}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            <dt>summary</dt>
            <dd>{r.summary}</dd>
            <dt>ground truth</dt>
            <dd>
              <VerdictPill outcome={customer.outcome} expected={customer.expected?.outcome} />
            </dd>
            <dt>model</dt>
            <dd>
              <code>{shortModel(r.modelSpec)}</code>
              <div className="muted small">{describeSpec(r.modelSpec)}</div>
            </dd>
            {latency?.type === 'manager.reviewed' && (
              <>
                <dt>latency</dt>
                <dd>{fmtMs(latency.latencyMs)}</dd>
              </>
            )}
            <dt>cost</dt>
            <dd>{fmtUsd(usage.costUsd)} (with this case’s router call, when on)</dd>
          </dl>
          <p className="muted small">
            Unlike the judge, the orchestrator is not blinded: it reads the agents’ tool trail with
            timings and knows which model played each agent.
          </p>
          <Brief kind="review" player={player} txId={txId} />
        </>
      )}
    </div>
  )
}

/** The judge across the whole run: one row per judged case, lowest confidence first. */
function JudgeOverview({
  player,
  onSelect,
}: {
  player: TimelinePlayer
  onSelect: (id: string) => void
}) {
  const s = player.state
  const rows = Object.entries(s.verdicts)
    .map(([txId, v]) => ({ txId, v, found: caseOfTx(player, txId) }))
    .filter((r) => r.found)
    .sort((a, b) => a.v.answers.correct.probability - b.v.answers.correct.probability)
  const disagree = rows.filter((r) => {
    const t = verdictOf(r.found?.customer.outcome, r.found?.customer.expected?.outcome)
    return (
      (t === 'pass' || t === 'fail') && r.v.answers.correct.probability >= 0.5 !== (t === 'pass')
    )
  }).length
  return (
    <div className="inspector">
      <h3>
        <span className="eval-glyph" aria-hidden="true">
          ⚖
        </span>{' '}
        Judge <span className="muted">· the whole run</span>
      </h3>
      <p className="muted small">
        {rows.length} cases judged
        {rows[0] ? ` by ${shortModel(rows[0].v.judgeSpec)}` : ''} · disagrees with ground truth on{' '}
        {disagree}
      </p>
      <ol className="calls">
        {rows.map(({ txId, v, found }) => (
          <li key={txId}>
            <button type="button" className="link" onClick={() => onSelect(`judge:${txId}`)}>
              {caseLabel(found?.index ?? 0)} · correct{' '}
              {Math.round(v.answers.correct.probability * 100)}%
            </button>{' '}
            <VerdictPill
              outcome={found?.customer.outcome}
              expected={found?.customer.expected?.outcome}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** A short title for a view, for the column header when it moves left of the panel. */
export function inspectorTitle(player: TimelinePlayer, id: string): string {
  const s = player.state
  if (id.startsWith('tool:')) return id.slice(5)
  if (id.startsWith('judge:') || id.startsWith('review:')) {
    const [kind, txId] = id.split(':') as [string, string]
    const found = caseOfTx(player, txId)
    return `${kind === 'judge' ? 'Judge' : 'Review'} · ${found ? caseLabel(found.index) : 'case'}`
  }
  if (id === 'judge-1') return 'Judge · the run'
  if (s.agents[id]) return `${s.agents[id]?.name} · ${agentLabel(id)}`
  const found = s.customers[id] ? caseOfTx(player, s.customers[id]?.txId ?? '') : null
  if (found) return `${caseLabel(found.index)} · ${found.customer.title ?? ''}`
  return id
}

/** Fetched once: the judge questions per domain, in each domain's wording. */
let domainsPromise: Promise<DomainInfo[]> | null = null
function useJudgeQuestions(domain: string) {
  const api = useHarness()
  const [qs, setQs] = useState<DomainInfo['judgeQuestions'] | null>(null)
  useEffect(() => {
    if (!api.domains) return
    if (!domainsPromise) {
      domainsPromise = api.domains()
      domainsPromise.catch(() => {
        domainsPromise = null
      })
    }
    let live = true
    domainsPromise
      .then((ds) => live && setQs(ds.find((d) => d.id === domain)?.judgeQuestions ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [api, domain])
  return qs
}

type VerdictAnswers = NonNullable<TimelinePlayer['state']['verdicts'][string]>

/**
 * The judge's five answers, each a bar you can hover (the question and how to read
 * the number) and open (the evidence it read, and how this judge decides).
 */
function JudgeAnswers({
  v,
  player,
  txId,
}: {
  v: VerdictAnswers
  player: TimelinePlayer
  txId: string
}) {
  const questions = useJudgeQuestions(player.state.config?.domain ?? 'cafe')
  const brief = useBrief('judge', player.state.runId, txId, true)
  const transcript = useMemo(() => {
    if (!brief) return null
    try {
      return JSON.parse(brief) as unknown
    } catch {
      return null
    }
  }, [brief])
  const [open, setOpen] = useState<AnswerId | null>(null)
  const mock = v.judgeSpec.startsWith('mock:')
  const rows: Array<{ id: AnswerId; kind: 'probability' | 'score'; value: number }> = [
    { id: 'correct', kind: 'probability', value: v.answers.correct.probability },
    {
      id: 'refusalAppropriate',
      kind: 'probability',
      value: v.answers.refusalAppropriate.probability,
    },
    { id: 'helpfulness', kind: 'score', value: v.answers.helpfulness.score },
    { id: 'tone', kind: 'score', value: v.answers.tone.score },
    { id: 'toolUseQuality', kind: 'score', value: v.answers.toolUseQuality.score },
  ]
  return (
    <div className="judge-answers">
      {rows.map(({ id, kind, value }) => {
        const scale = readScale(kind, value)
        const question = questions?.find((q) => q.id === id)?.instructions
        const isOpen = open === id
        const evidence = isOpen && transcript ? judgeEvidence(id, transcript) : null
        return (
          <div key={id} className={`answer ${isOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="answer-row"
              aria-expanded={isOpen}
              aria-describedby={`tip-${id}`}
              onClick={() => setOpen(isOpen ? null : id)}
            >
              <Meter
                label={ANSWER_LABEL[id]}
                value={value}
                max={kind === 'probability' ? 1 : 5}
                text={kind === 'probability' ? `${Math.round(value * 100)}%` : `${value}/5`}
              />
            </button>
            <div className="answer-tip" role="tooltip" id={`tip-${id}`}>
              <strong>{scale.headline}</strong>
              <div>{question ?? 'loading the question…'}</div>
              <div className="muted">{isOpen ? 'click to close' : 'click for the evidence'}</div>
            </div>
            {isOpen && (
              <div className="answer-detail">
                <h5>The question</h5>
                <p>{question ?? 'loading…'}</p>
                <h5>How to read {scale.headline}</h5>
                <p>{scale.explain}</p>
                <h5>What it had to go on</h5>
                {brief === undefined ? (
                  <p className="muted">loading the transcript…</p>
                ) : !evidence ? (
                  <p className="muted">The transcript was not stored for this run.</p>
                ) : (
                  <>
                    {evidence.rows.length > 0 && (
                      <dl>
                        {evidence.rows.map((r) => (
                          <Fragment key={r.label}>
                            <dt>{r.label}</dt>
                            <dd
                              className={r.tone === 'bad' ? 'bad' : r.tone === 'good' ? 'good' : ''}
                            >
                              {r.tone === 'bad' ? '✗ ' : r.tone === 'good' ? '✓ ' : ''}
                              {r.value}
                            </dd>
                          </Fragment>
                        ))}
                      </dl>
                    )}
                    {evidence.quotes.map((q) => (
                      <blockquote key={`${q.who}:${q.text}`} className="small-quote">
                        <span className="muted small">{q.who}</span> “{q.text}”
                      </blockquote>
                    ))}
                    {evidence.note && <p className="muted small">{evidence.note}</p>}
                  </>
                )}
                <h5>How this judge decides</h5>
                <p>{mock ? `Scripted mock rule: ${MOCK_RULE[id]}` : MODEL_NOTE}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** "11 expected · 10 called · 1 missing · 2 unexpected", across both agents. */
function ToolTally({
  exp,
  calledBy,
}: {
  exp: NonNullable<CustomerView['expected']>
  calledBy: (role: string) => Set<string>
}) {
  let expected = 0
  let called = 0
  let missing = 0
  let extra = 0
  for (const role of ['cashier', 'barista'] as const) {
    const want = role === 'cashier' ? exp.cashierTools : exp.baristaTools
    const got = calledBy(role)
    expected += want.length
    called += want.filter((t) => got.has(t)).length
    missing += want.filter((t) => !got.has(t)).length
    extra += [...got].filter((t) => !want.includes(t)).length
  }
  return (
    <div className="tool-tally">
      <span>
        <b>{expected}</b> expected
      </span>
      <span className="called">
        <b>{called}</b> called
      </span>
      <span className={missing ? 'missing on' : 'missing'}>
        <b>{missing}</b> missing
      </span>
      <span className={extra ? 'extra on' : 'extra'}>
        <b>{extra}</b> unexpected
      </span>
    </div>
  )
}
