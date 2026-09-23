import { fmtMs } from '../format.js'
import { lineText, roleCount } from '../lib/nomenclature.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'

export function QueuePanel({ player }: { player: TimelinePlayer }) {
  const s = player.state
  const now = player.clockEpoch()
  const inProgress = Object.values(s.orders).filter(
    (o) => o.status === 'claimed' || o.status === 'ready',
  )
  const baristas = Object.values(s.agents).filter((a) => a.role === 'barista')
  return (
    <div className="queue">
      <h3>On the rail ({s.queue.length})</h3>
      {s.queue.length === 0 ? (
        <p className="muted">Empty.</p>
      ) : (
        <ol>
          {s.queue.map((id) => {
            const o = s.orders[id]
            if (!o) return null
            const waited = o.queuedAt ? now - o.queuedAt : 0
            return (
              <li key={id} className={waited > 30_000 ? 'hot' : waited > 10_000 ? 'warm' : ''}>
                <strong>{o.customerName}</strong> · {o.items.map(lineText).join(', ')} · waiting{' '}
                {fmtMs(waited)}
                {o.requeues > 0 && <span className="pill failed"> requeued ×{o.requeues}</span>}
              </li>
            )
          })}
        </ol>
      )}
      <h3>Being made</h3>
      {inProgress.length === 0 ? (
        <p className="muted">Nobody at the machines.</p>
      ) : (
        <ul>
          {inProgress.map((o) => (
            <li key={o.orderId}>
              <strong>{o.customerName}</strong> · {s.agents[o.baristaId ?? '']?.name ?? o.baristaId}{' '}
              · {o.status} · {fmtMs(o.claimedAt ? now - o.claimedAt : 0)}
            </li>
          ))}
        </ul>
      )}
      <h3>Staff</h3>
      <ul>
        {Object.values(s.agents).map((a) => (
          <li key={a.agentId}>
            <strong>{a.name}</strong> <span className="muted">{a.role}</span> · {a.station} ·{' '}
            {a.busy ? `busy ${fmtMs(a.workStartedAt ? now - a.workStartedAt : 0)}` : 'idle'}
            {a.error && <span className="pill failed"> {a.error.kind}</span>}
          </li>
        ))}
      </ul>
      {baristas.length > 0 && (
        <p className="muted small">
          {roleCount('barista', baristas.length)} ·{' '}
          {roleCount('cashier', Object.values(s.agents).filter((a) => a.role === 'cashier').length)}
        </p>
      )}
    </div>
  )
}
