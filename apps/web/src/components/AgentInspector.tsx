import { shortScenarioId } from '@cafe/protocol'
import { useState } from 'react'
import { fmtCents, fmtMs, fmtUsd, shortModel } from '../format.js'
import { AgentGlyph } from '../lib/AgentGlyph.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'

export function AgentInspector({
  player,
  selectedId,
}: {
  player: TimelinePlayer
  selectedId: string | null
}) {
  const s = player.state
  const now = player.clockEpoch()
  if (!selectedId)
    return <p className="muted">Click a character in the cafe, or a red “!” to read a failure.</p>
  const agent = s.agents[selectedId]
  const customer = s.customers[selectedId]
  if (agent) {
    const med = agent.stepLatencies.length
      ? [...agent.stepLatencies].sort((a, b) => a - b)[Math.floor(agent.stepLatencies.length / 2)]
      : null
    return (
      <div className="inspector">
        <h3>
          <AgentGlyph className="big" /> {agent.name}{' '}
          <span className="muted">
            {agent.role} · sub-agent <code>{agent.agentId}</code>
          </span>
        </h3>
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
              <ToolCallRow key={c.callId} c={c} />
            ))}
          </ol>
        )}
      </div>
    )
  }
  if (customer) {
    const order = customer.orderId ? s.orders[customer.orderId] : undefined
    const verdict = s.verdicts[customer.txId]
    const review = s.reviews[customer.txId]
    return (
      <div className="inspector">
        <h3>
          {customer.name}{' '}
          <span className="muted">customer · {shortScenarioId(customer.scenarioId)}</span>
        </h3>
        <blockquote>“{customer.utterance}”</blockquote>
        <dl>
          <dt>status</dt>
          <dd>{customer.outcome ?? `at ${customer.station}`}</dd>
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
              <dt>order</dt>
              <dd>
                {order.status} · {fmtCents(order.totalCents)}
                <ul className="items">
                  {order.items.map((i) => (
                    <li
                      key={`${i.menuItemId}-${i.size}-${i.modifiers.join('+')}-${i.unitPriceCents}`}
                    >
                      {i.quantity}× {i.size} {i.name}
                      {i.modifiers.length ? ` (${i.modifiers.join(', ')})` : ''} ·{' '}
                      {fmtCents(i.unitPriceCents)}
                    </li>
                  ))}
                </ul>
                {order.failReason && <div className="bad">{order.failReason}</div>}
              </dd>
            </>
          )}
          {review && (
            <>
              <dt>manager review</dt>
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
                    {verdict.answers.tone.score}/5 · tool use {verdict.answers.toolUseQuality.score}
                    /5
                  </li>
                </ul>
              </dd>
            </>
          )}
        </dl>
      </div>
    )
  }
  return <p className="muted">That character has left.</p>
}

function ToolCallRow({
  c,
}: {
  c: {
    tool: string
    args: Record<string, unknown>
    ok?: boolean | undefined
    latencyMs?: number | undefined
    result?: unknown
    error?: string | undefined
  }
}) {
  const [open, setOpen] = useState(false)
  const status = c.ok === undefined ? '…' : c.ok ? '✓' : '✗'
  return (
    <li className={c.ok === false ? 'bad' : ''}>
      <button type="button" className="link mono" onClick={() => setOpen((o) => !o)}>
        {status} {c.tool} <span className="muted">{fmtMs(c.latencyMs)}</span>
      </button>
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
