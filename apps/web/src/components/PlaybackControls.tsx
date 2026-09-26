import { allTimelines } from '@cafe/protocol'
import { useState } from 'react'
import { fmtDelta, fmtMs } from '../format.js'
import { MODE_DOCS, modeDoc } from '../playback/mode-docs.js'
import type { PlaybackMode, TimelinePlayer } from '../playback/TimelinePlayer.js'

export function PlaybackControls({ player }: { player: TimelinePlayer }) {
  const pos = player.position
  const timelines = allTimelines(player.events)
  const markers: Array<{ v: number; name: string; outcome: string | null }> = []
  for (const t of timelines) {
    const arrived = player.events.find((e) => e.txId === t.txId && e.type === 'customer.arrived')
    const v = arrived ? player.visualTimeOf(arrived.seq) : null
    if (v !== null) markers.push({ v, name: t.customerName ?? '?', outcome: t.outcome })
  }
  const timed = player.mode === 'replay' || player.mode === 'directors-cut'
  const end = Math.max(1, pos.visualEnd)
  const frac = Math.min(1, pos.visualNow / end)
  // Nothing loaded: the transport would toggle an icon and change nothing, so keep it off.
  const idle = pos.total === 0

  return (
    <div className="playback">
      <div className="playback-row">
        <div className="segmented" role="tablist" aria-label="Playback mode">
          {MODE_DOCS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={player.mode === m.id ? 'on' : ''}
              title={`${m.label} (${m.key})`}
              onClick={() => player.setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="transport">
          <button
            type="button"
            onClick={() => player.stepBack()}
            title="Previous beat (←)"
            disabled={idle || pos.cursor === 0}
          >
            ◀
          </button>
          {player.mode === 'step' ? (
            <button
              type="button"
              className="primary"
              onClick={() => player.stepForward()}
              title="Next beat (→ or space)"
              disabled={idle || pos.atEnd}
            >
              Next ▶
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => (player.playing ? player.pause() : player.play())}
              title={
                idle
                  ? 'Start a run or load a recent one first'
                  : player.mode === 'live-raw'
                    ? 'Raw applies events as they arrive; nothing to pause'
                    : 'Play / pause (space)'
              }
              disabled={idle || player.mode === 'live-raw'}
            >
              {player.playing ? '❚❚' : '▶'}
            </button>
          )}
          <button
            type="button"
            onClick={() => player.stepForward()}
            title="Next beat (→)"
            disabled={idle || pos.atEnd}
          >
            ▶
          </button>
          <button
            type="button"
            className="skip-end"
            onClick={() => player.skipToEnd()}
            title={
              player.mode.startsWith('live')
                ? 'Skip to the latest: everything received so far (End)'
                : 'Skip to the end: the finished results (End)'
            }
            aria-label="Skip to the end"
            disabled={idle || pos.cursor >= pos.total}
          >
            End ⏭
          </button>
        </div>
        {timed && (
          <label className="inline">
            speed
            <select
              value={player.options.speed}
              onChange={(e) => player.setOptions({ speed: Number(e.target.value) })}
            >
              {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        )}
        {player.mode === 'step' && (
          <label className="inline">
            granularity
            <select
              value={player.options.stepGranularity}
              onChange={(e) =>
                player.setOptions({ stepGranularity: e.target.value as 'beat' | 'event' })
              }
            >
              <option value="beat">beats</option>
              <option value="event">every visible event</option>
            </select>
          </label>
        )}
        {player.mode === 'live-buffered' && (
          <label className="inline">
            buffer
            <select
              value={player.options.bufferMs}
              onChange={(e) => player.setOptions({ bufferMs: Number(e.target.value) })}
            >
              {[1000, 2500, 5000].map((s) => (
                <option key={s} value={s}>
                  {s / 1000}s
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <ModeHelp mode={player.mode} />

      {player.mode === 'directors-cut' && (
        <div className="playback-row cut">
          <label>
            scale{' '}
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={player.options.cut.scale}
              onChange={(e) => player.setOptions({ cut: { scale: Number(e.target.value) } })}
            />{' '}
            {player.options.cut.scale.toFixed(1)}×
          </label>
          <label>
            min gap{' '}
            <input
              type="range"
              min={0}
              max={2000}
              step={100}
              value={player.options.cut.minVisibleGapMs}
              onChange={(e) =>
                player.setOptions({ cut: { minVisibleGapMs: Number(e.target.value) } })
              }
            />{' '}
            {fmtMs(player.options.cut.minVisibleGapMs)}
          </label>
          <label>
            max gap{' '}
            <input
              type="range"
              min={500}
              max={15000}
              step={500}
              value={player.options.cut.maxGapMs}
              onChange={(e) => player.setOptions({ cut: { maxGapMs: Number(e.target.value) } })}
            />{' '}
            {fmtMs(player.options.cut.maxGapMs)}
          </label>
          <span className="muted">
            {fmtMs(pos.realTotalMs)} real → {fmtMs(pos.visualEnd)} on screen
          </span>
        </div>
      )}

      <div className="scrubber-row">
        <div
          className={`scrubber ${timed || player.mode === 'step' ? '' : 'passive'}`}
          onClick={(e) => {
            if (!timed && player.mode !== 'step') return
            const r = e.currentTarget.getBoundingClientRect()
            player.seek(((e.clientX - r.left) / r.width) * end)
            if (player.mode === 'step') player.pause()
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') player.stepForward()
            if (e.key === 'ArrowLeft') player.stepBack()
          }}
          role="slider"
          aria-valuenow={Math.round(frac * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          <div className="scrubber-fill" style={{ width: `${frac * 100}%` }} />
          {markers.map((m) => (
            <div
              key={`${m.v}-${m.name}`}
              className={`marker ${m.outcome ?? ''}`}
              style={{ left: `${(m.v / end) * 100}%` }}
              title={m.name}
            />
          ))}
        </div>
        <div className="readout">
          <span>
            {pos.cursor}/{pos.total}
          </span>
          <span className="delta" title="Real time since the previous beat">
            {fmtDelta(pos.deltaMs)}
          </span>
          {pos.lastEvent && <span className="muted">{pos.lastEvent.type}</span>}
          {player.mode.startsWith('live') && pos.lagMs > 0 && (
            <span className="muted">lag {fmtMs(pos.lagMs)}</span>
          )}
          <span className="muted">{fmtMs(pos.realElapsedMs)} elapsed</span>
        </div>
      </div>
    </div>
  )
}

/**
 * What the current mode does and how to drive it: two sentences, expandable to the
 * long form. Collapses again whenever the mode changes.
 */
function ModeHelp({ mode }: { mode: PlaybackMode }) {
  // Remember which mode was expanded, so switching modes collapses the help again.
  const [openFor, setOpenFor] = useState<PlaybackMode | null>(null)
  const open = openFor === mode
  const setOpen = (v: boolean) => setOpenFor(v ? mode : null)
  const doc = modeDoc(mode)
  const id = `mode-help-${mode}`
  return (
    <div className={`mode-help ${open ? 'open' : ''}`}>
      {open ? (
        <div id={id}>
          {doc.details.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
          <button type="button" className="link" onClick={() => setOpen(false)}>
            See less
          </button>
        </div>
      ) : (
        <p>
          <button
            type="button"
            className="mode-help-summary"
            aria-expanded={false}
            aria-controls={id}
            onClick={() => setOpen(true)}
          >
            {doc.summary.replace(/\.$/, '')}…
          </button>{' '}
          <button type="button" className="link" onClick={() => setOpen(true)}>
            See more
          </button>
        </p>
      )}
    </div>
  )
}
