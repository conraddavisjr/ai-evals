import { useEffect, useState } from 'react'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import { AgentInspector, inspectorTitle } from './AgentInspector.js'

/** At most this many earlier views stay fully open; older ones fold into a labelled strip. */
const MAX_OPEN = 2
/** The stage keeps at least this much width; the trail folds columns to respect it. */
const STAGE_MIN = 440
const PANE_W = 340
const SPINE_W = 30

/**
 * Where you came from, laid out left of the Inspector: each view you drilled in
 * from stays open as its own column, so the picture grows sideways instead of
 * stacking. The newest view is always the side panel on the right. A link in an
 * earlier column continues the path from there; a folded strip reopens its view.
 */
export function InspectorTrail({
  ids,
  player,
  onFocus,
  onOpenFrom,
  panelWidth,
}: {
  /** Earlier views, oldest first; the current one is not included. */
  ids: string[]
  player: TimelinePlayer
  /** Make trail entry `index` the current view again (dropping everything after it). */
  onFocus: (index: number) => void
  /** Open `id` from trail entry `index` (dropping everything after that entry). */
  onOpenFrom: (index: number, id: string) => void
  /** The side panel's width, to work out how many columns fit beside the stage. */
  panelWidth: number
}) {
  const [viewport, setViewport] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  if (ids.length === 0) return null
  const room = viewport - panelWidth - STAGE_MIN - SPINE_W * ids.length
  const open = Math.max(1, Math.min(MAX_OPEN, ids.length, Math.floor(room / PANE_W)))
  const firstOpen = Math.max(0, ids.length - open)
  return (
    <nav className="inspector-trail" aria-label="Where you came from">
      {ids.map((id, i) =>
        i < firstOpen ? (
          <button
            type="button"
            key={ids.slice(0, i + 1).join(' › ')}
            className="trail-spine"
            title={`Back to ${inspectorTitle(player, id)}`}
            onClick={() => onFocus(i)}
          >
            <span>{inspectorTitle(player, id)}</span>
          </button>
        ) : (
          <section
            key={ids.slice(0, i + 1).join(' › ')}
            className="trail-pane"
            aria-label={inspectorTitle(player, id)}
          >
            <header className="trail-head">
              <span className="trail-title">{inspectorTitle(player, id)}</span>
              <button
                type="button"
                className="link"
                title="Make this the current view (closes the views to its right)"
                onClick={() => onFocus(i)}
              >
                close right ›
              </button>
            </header>
            <div className="trail-body">
              <AgentInspector
                player={player}
                selectedId={id}
                onSelect={(next) => onOpenFrom(i, next)}
              />
            </div>
          </section>
        ),
      )}
    </nav>
  )
}
