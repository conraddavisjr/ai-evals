import type { TimelinePlayer } from '../playback/TimelinePlayer.js'

export interface SceneCallbacks {
  /** A character was clicked (or the selection cleared). */
  onSelect: (id: string | null) => void
}

/** What a mounted scene hands back; the host only ever calls these two. */
export interface SceneHandle {
  /** Render one frame on demand (hidden tabs pause requestAnimationFrame). */
  step(now: number): void
  destroy(): void
  /** Last frame's CPU time in ms, when the scene measures it. */
  readonly frameMs?: number
}

/**
 * A way of drawing the cafe. Every view is a pure consumer of the TimelinePlayer:
 * it subscribes to `onApply` / `onSnap`, ticks the player once per frame, and reads
 * `player.state` and `player.clockEpoch()` for anything time based. Nothing else.
 * That is what lets the same event stream drive the pixel cafe, the painterly
 * village and whatever comes next, and lets the whole stage move to another harness.
 */
export interface SceneView {
  id: string
  label: string
  /** One line for the switcher tooltip. */
  blurb: string
  /**
   * The view draws the cafe itself (counters, espresso machines). A run in a
   * domain without a scene (`vocabulary.hasScene`) falls back to the Trace board.
   */
  cafeArt?: boolean
  /** Async so a view's renderer (Three, Phaser, ...) can be loaded only when it is first shown. */
  mount(
    parent: HTMLElement,
    player: TimelinePlayer,
    callbacks: SceneCallbacks,
  ): Promise<SceneHandle>
}
