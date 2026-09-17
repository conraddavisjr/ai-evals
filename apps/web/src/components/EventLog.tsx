import { fmtMs } from '../format.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import { VISIBLE_EVENTS } from '../playback/TimelinePlayer.js'

export function EventLog({
  player,
  onSelect,
}: {
  player: TimelinePlayer
  onSelect: (id: string | null) => void
}) {
  const evs = player.state.applied
  const t0 = evs[0]?.t ?? 0
  const shown = evs
    .filter((e) => VISIBLE_EVENTS.has(e.type))
    .slice(-120)
    .reverse()
  return (
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
        return (
          <button
            type="button"
            key={e.id}
            className={`log-row ${e.type.split('.')[0]} ${e.type === 'agent.error' || e.type === 'order.failed' || e.type === 'agent.scope_violation' ? 'bad' : ''}`}
            onClick={() => {
              player.seekToSeq(e.seq)
              player.pause()
              if ('agentId' in e) onSelect(e.agentId as string)
              else if ('customerId' in e) onSelect(e.customerId as string)
            }}
            title="Jump here"
          >
            <span className="t">{fmtMs(e.t - t0)}</span>
            <span className="ty">{e.type}</span>
            <span className="who">{who}</span>
            <span className="d">{detail}</span>
          </button>
        )
      })}
    </div>
  )
}
