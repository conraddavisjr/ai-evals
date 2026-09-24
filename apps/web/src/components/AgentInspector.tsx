import { type CafeEvent, shortScenarioId } from '@cafe/protocol'
import { useEffect, useMemo, useState } from 'react'
import { fmtCents, fmtMs, fmtUsd, shortModel } from '../format.js'
import { type ToolInfo, useExperimentApi } from '../harness/index.js'
import { AgentGlyph } from '../lib/AgentGlyph.js'
import {
  agentLabel,
  caseLabel,
  isAgentId,
  lineText,
  outcomeLabel,
  roleLabel,
} from '../lib/nomenclature.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import type { AgentView, CustomerView } from '../state/cafe-state.js'
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
          ? `${agentLabel(selectedId)} is not on shift at this point in the run.`
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
          <p className="muted small tool-key">
            ✓ expected and called · ○ expected, not called · ! called, not expected
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
            <dt>door triage</dt>
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
            <dt>orchestrator review</dt>
            <dd>
              <span className={`pill review-${review.verdict}`}>{review.verdict}</span>{' '}
              <code>{shortModel(review.modelSpec)}</code>
              <div>{review.summary}</div>
            </dd>
          </>
        )}
        {verdict && (
          <>
            <dt>judge</dt>
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
