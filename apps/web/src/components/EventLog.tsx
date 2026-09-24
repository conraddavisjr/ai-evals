import { useState } from 'react'
import { fmtMs } from '../format.js'
import { AgentGlyph } from '../lib/AgentGlyph.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import { VISIBLE_EVENTS } from '../playback/TimelinePlayer.js'
import { AgentInspector } from './AgentInspector.js'

/**
 * The trace. Clicking a row seeks the player there and opens the actor's inspector in
 * a nested pane beside the rows, so the trace stays in view (the same content the
 * Inspector tab shows; `onPeek` keeps that tab in sync without switching to it).
 */
export function EventLog({
  player,
  onPeek,
}: {
  player: TimelinePlayer
  onPeek: (id: string | null) => void
}) {
  const [peekId, setPeekId] = useState<string | null>(null)
  const evs = player.state.applied
  const t0 = evs[0]?.t ?? 0
  const shown = evs
    .filter((e) => VISIBLE_EVENTS.has(e.type))
    .slice(-120)
    .reverse()
  const peek = (id: string | null) => {
    setPeekId(id)
    onPeek(id)
  }
  const peekName = peekId
    ? (player.state.agents[peekId]?.name ?? player.state.customers[peekId]?.name ?? peekId)
    : null
  return (
    <div className={`log-split ${peekId ? 'open' : ''}`}>
      <div className="log">
        {shown.map((e) => {
          const who =
            'agentId' in e
              ? player.state.agents[e.agentId as string]?.name
              : 'customerId' in e
                ? player.state.customers[e.customerId as string]?.name
                : ''
          const detail =
            e.type === 'agent.tool_called'
              ? e.tool
              : e.type === 'agent.spoke' || e.type === 'customer.spoke'
                ? e.text
                : e.type === 'agent.error'
                  ? `${e.kind}: ${e.message}`
                  : e.type === 'order.called_out'
                    ? e.customerName
                    : e.type === 'customer.left'
                      ? e.outcome
                      : e.type === 'order.failed' || e.type === 'order.requeued'
                        ? e.reason
                        : e.type === 'agent.moved' || e.type === 'customer.moved'
                          ? `→ ${e.to}`
                          : e.type === 'triage.decided'
                            ? e.intent
                            : ''
          const actorId =
            'agentId' in e
              ? (e.agentId as string)
              : 'customerId' in e
                ? (e.customerId as string)
                : null
          const bad =
            e.type === 'agent.error' ||
            e.type === 'order.failed' ||
            e.type === 'agent.scope_violation'
          return (
            <button
              type="button"
              key={e.id}
              className={`log-row ${e.type.split('.')[0]} ${bad ? 'bad' : ''} ${peekId && actorId === peekId ? 'focus' : ''}`}
              onClick={() => {
                player.seekToSeq(e.seq)
                player.pause()
                peek(actorId)
              }}
              title={actorId ? 'Jump here and inspect' : 'Jump here'}
            >
              <span className="t">{fmtMs(e.t - t0)}</span>
              <span className="ty">{e.type}</span>
              <span className="who">
                {'agentId' in e && <AgentGlyph />}
                {who}
              </span>
              <span className="d">{detail}</span>
            </button>
          )
        })}
      </div>
      {peekId && (
        <aside className="log-peek" aria-label={`Inspecting ${peekName}`}>
          <div className="log-peek-head">
            <span className="muted small">inspecting</span>
            <button
              type="button"
              className="link"
              onClick={() => peek(null)}
              title="Close (keeps the trace)"
            >
              close ×
            </button>
          </div>
          <AgentInspector player={player} selectedId={peekId} onSelect={peek} />
        </aside>
      )}
    </div>
  )
}
