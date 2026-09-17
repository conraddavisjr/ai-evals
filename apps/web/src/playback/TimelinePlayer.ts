import type { CafeEvent, CafeEventType } from '@cafe/protocol'
import { type CafeState, initialState, reduce, reduceAll } from '../state/cafe-state.js'

export type PlaybackMode = 'live-raw' | 'live-buffered' | 'replay' | 'step' | 'directors-cut'

export interface CutOptions {
  /** Multiply real gaps by this before clamping (1 = real time). */
  scale: number
  /** A visible event stays on screen at least this long before the next visible one. */
  minVisibleGapMs: number
  /** No single gap is longer than this (a 40s hang compresses to this). */
  maxGapMs: number
}

export interface PlayerOptions {
  bufferMs: number
  speed: number
  cut: CutOptions
  stepGranularity: 'beat' | 'event'
}

export const DEFAULT_OPTIONS: PlayerOptions = {
  bufferMs: 2500,
  speed: 1,
  cut: { scale: 1, minVisibleGapMs: 600, maxGapMs: 3000 },
  stepGranularity: 'beat',
}

/** Events that mean something on screen (bubbles, walks, tickets). Bookkeeping events are not in here. */
export const VISIBLE_EVENTS: ReadonlySet<CafeEventType> = new Set<CafeEventType>([
  'customer.arrived',
  'customer.moved',
  'customer.spoke',
  'customer.left',
  'triage.decided',
  'agent.moved',
  'agent.thinking',
  'agent.spoke',
  'agent.tool_called',
  'agent.error',
  'agent.scope_violation',
  'order.created',
  'order.queued',
  'order.claimed',
  'order.requeued',
  'order.ready',
  'order.called_out',
  'order.delivered',
  'order.failed',
  'order.refused',
  'judge.verdict',
  'run.finished',
])

/**
 * Events that earn a minimum on-screen gap in the director's cut. Thinking dots and
 * walks are animated but ride along with the beat before them; a "thinking" that
 * starts 10ms after a tool returns is not worth its own 600ms.
 */
export const PACED_EVENTS: ReadonlySet<CafeEventType> = new Set<CafeEventType>(
  [...VISIBLE_EVENTS].filter(
    (t) => t !== 'agent.thinking' && t !== 'agent.moved' && t !== 'customer.moved',
  ),
)

/** The coarse beats step mode pauses on. */
export const BEAT_EVENTS: ReadonlySet<CafeEventType> = new Set<CafeEventType>([
  'customer.arrived',
  'customer.spoke',
  'agent.tool_called',
  'agent.spoke',
  'agent.error',
  'agent.scope_violation',
  'order.queued',
  'order.claimed',
  'order.requeued',
  'order.ready',
  'order.called_out',
  'order.failed',
  'order.refused',
  'customer.left',
  'judge.verdict',
  'run.finished',
])

export interface PlayerListener {
  /** An event was applied in sequence; animate it. */
  onApply?: (event: CafeEvent, state: CafeState) => void
  /** State was rebuilt (seek); snap everything, no tweens. */
  onSnap?: (state: CafeState) => void
  /** Anything about the player changed (mode, cursor, clock); re-render controls. */
  onChange?: () => void
}

/**
 * Decides *when* each event is applied to the CafeState. Live is just one mode:
 * the same cursor/clock machinery drives buffered live, replay, step-through, and
 * the director's cut, so what you see in replay is exactly what live showed.
 */
export class TimelinePlayer {
  events: CafeEvent[] = []
  state: CafeState = initialState()
  mode: PlaybackMode = 'live-buffered'
  playing = true
  options: PlayerOptions = { ...DEFAULT_OPTIONS, cut: { ...DEFAULT_OPTIONS.cut } }
  /** Source is finished; no more events will arrive. */
  complete = false
  private cursor = 0
  /** Visual ms from start for each event (replay & cut). */
  private visualT: number[] = []
  /** Visual clock (ms from start) for replay/step/cut; epoch ms for live modes. */
  private vclock = 0
  private lastTick: number | null = null
  /** Wall-clock of the last tick; a long gap (hidden tab) means we catch up with a snap, not a burst of tweens. */
  private lastTickWall = 0
  private listeners = new Set<PlayerListener>()
  private seqSeen = new Set<number>()

  subscribe(l: PlayerListener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private emitChange() {
    for (const l of this.listeners) safe(() => l.onChange?.())
  }

  // ---------- data in ----------

  ingest(incoming: CafeEvent[]): void {
    let added = false
    for (const e of incoming) {
      if (this.seqSeen.has(e.seq)) continue
      this.seqSeen.add(e.seq)
      this.events.push(e)
      added = true
    }
    if (!added) return
    this.events.sort((a, b) => a.seq - b.seq)
    this.recomputeVisual()
    if (this.mode === 'live-raw') this.applyUntil(this.events.length)
    this.emitChange()
  }

  markComplete(): void {
    this.complete = true
    this.emitChange()
  }

  reset(): void {
    this.events = []
    this.seqSeen.clear()
    this.visualT = []
    this.cursor = 0
    this.vclock = 0
    this.lastTick = null
    this.complete = false
    this.state = initialState()
    for (const l of this.listeners) safe(() => l.onSnap?.(this.state))
    this.emitChange()
  }

  // ---------- configuration ----------

  setMode(mode: PlaybackMode): void {
    if (mode === this.mode) return
    const wasLive = this.mode.startsWith('live')
    this.mode = mode
    this.recomputeVisual()
    if (mode.startsWith('live')) {
      this.vclock = Date.now() - (mode === 'live-buffered' ? this.options.bufferMs : 0)
    } else if (wasLive || this.cursor === 0) {
      // carry the position across: visual time of the last applied event
      this.vclock = this.cursor > 0 ? (this.visualT[this.cursor - 1] ?? 0) : 0
    } else {
      this.vclock = this.cursor > 0 ? (this.visualT[this.cursor - 1] ?? 0) : 0
    }
    if (mode === 'step') this.playing = false
    else if (mode === 'live-raw') this.applyUntil(this.events.length)
    this.lastTick = null
    this.emitChange()
  }

  setOptions(patch: Partial<Omit<PlayerOptions, 'cut'>> & { cut?: Partial<CutOptions> }): void {
    const before = this.cursor > 0 ? (this.visualT[this.cursor - 1] ?? 0) : 0
    this.options = { ...this.options, ...patch, cut: { ...this.options.cut, ...(patch.cut ?? {}) } }
    this.recomputeVisual()
    // keep the playhead on the same event when the mapping changes
    if (!this.mode.startsWith('live')) {
      const after = this.cursor > 0 ? (this.visualT[this.cursor - 1] ?? 0) : 0
      this.vclock = this.vclock - before + after
    }
    this.emitChange()
  }

  play(): void {
    this.playing = true
    this.lastTick = null
    this.emitChange()
  }
  pause(): void {
    this.playing = false
    this.emitChange()
  }

  // ---------- the clock ----------

  /** Call every animation frame with a monotonic timestamp (performance.now()). */
  tick(now: number): void {
    if (this.mode === 'step' || this.mode === 'live-raw') return
    const wall = Date.now()
    const stalled = this.lastTickWall > 0 && wall - this.lastTickWall > 3000
    this.lastTickWall = wall
    if (!this.playing) {
      this.lastTick = now
      return
    }
    const dt = this.lastTick === null ? 0 : now - this.lastTick
    this.lastTick = now
    if (stalled) {
      // Came back from a frozen tab: jump to where we should be without animating the backlog.
      if (this.mode === 'live-buffered') {
        const target = wall - this.options.bufferMs
        let n = this.cursor
        while (n < this.events.length && (this.events[n]?.t ?? Number.POSITIVE_INFINITY) <= target)
          n++
        if (n > this.cursor) this.rebuild(n)
      }
      return
    }
    if (this.mode === 'live-buffered') {
      this.vclock = Date.now() - this.options.bufferMs
      let n = this.cursor
      while (
        n < this.events.length &&
        (this.events[n]?.t ?? Number.POSITIVE_INFINITY) <= this.vclock
      )
        n++
      // once the source is complete, do not sit on a stale buffer: drain
      if (this.complete && n === this.cursor && this.cursor < this.events.length) {
        const nextT = this.events[this.cursor]?.t ?? 0
        if (Date.now() - nextT > this.options.bufferMs) n = this.cursor + 1
      }
      if (n > this.cursor) this.applyUntil(n)
      return
    }
    // replay & cut: advance visual clock
    const end = this.visualEnd()
    this.vclock = Math.min(end, this.vclock + dt * this.options.speed)
    let n = this.cursor
    while (n < this.events.length && (this.visualT[n] ?? Number.POSITIVE_INFINITY) <= this.vclock)
      n++
    if (n > this.cursor) this.applyUntil(n)
    if (this.cursor >= this.events.length && this.complete && this.playing) {
      this.playing = false
      this.emitChange()
    }
  }

  // ---------- stepping & seeking ----------

  private isBoundary(e: CafeEvent): boolean {
    return this.options.stepGranularity === 'beat'
      ? BEAT_EVENTS.has(e.type)
      : VISIBLE_EVENTS.has(e.type)
  }

  /** Apply events up to and including the next boundary. */
  stepForward(): void {
    if (this.cursor >= this.events.length) return
    let n = this.cursor + 1
    while (n < this.events.length && !this.isBoundary(this.events[n - 1] as CafeEvent)) n++
    // include trailing bookkeeping events that share the boundary's instant (tool_returned, usage)
    const boundaryT = this.events[n - 1]?.t ?? 0
    while (
      n < this.events.length &&
      !VISIBLE_EVENTS.has((this.events[n] as CafeEvent).type) &&
      (this.events[n]?.t ?? 0) - boundaryT < 50
    )
      n++
    this.applyUntil(n)
    this.vclock = this.visualT[this.cursor - 1] ?? 0
    this.emitChange()
  }

  stepBack(): void {
    if (this.cursor === 0) return
    let n = this.cursor - 1
    while (n > 0 && !this.isBoundary(this.events[n - 1] as CafeEvent)) n--
    this.rebuild(n)
  }

  /** Jump to a visual time (replay/cut) and rebuild state there. */
  seek(visualMs: number): void {
    let n = 0
    while (n < this.events.length && (this.visualT[n] ?? Number.POSITIVE_INFINITY) <= visualMs) n++
    this.rebuild(n)
    this.vclock = visualMs
    this.emitChange()
  }

  /** Jump so that the given event is the last applied one. */
  seekToSeq(seq: number): void {
    const idx = this.events.findIndex((e) => e.seq === seq)
    if (idx < 0) return
    this.rebuild(idx + 1)
    this.vclock = this.visualT[idx] ?? 0
    this.emitChange()
  }

  private rebuild(n: number): void {
    this.cursor = n
    this.state = reduceAll(this.events.slice(0, n))
    for (const l of this.listeners) safe(() => l.onSnap?.(this.state))
    this.emitChange()
  }

  private applyUntil(n: number): void {
    while (this.cursor < n && this.cursor < this.events.length) {
      const e = this.events[this.cursor] as CafeEvent
      this.state = reduce(this.state, e)
      this.cursor += 1
      for (const l of this.listeners) safe(() => l.onApply?.(e, this.state))
    }
    this.emitChange()
  }

  // ---------- visual timeline ----------

  private recomputeVisual(): void {
    const t0 = this.events[0]?.t ?? 0
    const vis: number[] = new Array(this.events.length)
    if (this.mode !== 'directors-cut') {
      for (let i = 0; i < this.events.length; i++) vis[i] = (this.events[i]?.t ?? t0) - t0
    } else {
      const { scale, minVisibleGapMs, maxGapMs } = this.options.cut
      // The minimum gap is per character: Juniper's steps stay readable without
      // stretching Hazel's, and global order is preserved because time only moves forward.
      const lastVisibleByActor = new Map<string, number>()
      for (let i = 0; i < this.events.length; i++) {
        const e = this.events[i] as CafeEvent
        if (i === 0) vis[0] = 0
        else {
          const realGap = e.t - (this.events[i - 1]?.t ?? e.t)
          let v = (vis[i - 1] ?? 0) + Math.min(maxGapMs, realGap * scale)
          if (PACED_EVENTS.has(e.type)) {
            const last = lastVisibleByActor.get(actorKey(e))
            if (last !== undefined) v = Math.max(v, last + minVisibleGapMs)
          }
          vis[i] = v
        }
        if (PACED_EVENTS.has(e.type)) lastVisibleByActor.set(actorKey(e), vis[i] ?? 0)
      }
    }
    this.visualT = vis
  }

  // ---------- read model for controls ----------

  get position() {
    const cur = this.cursor
    const last = cur > 0 ? this.events[cur - 1] : undefined
    const prev = cur > 1 ? this.events[cur - 2] : undefined
    const next = this.events[cur]
    return {
      cursor: cur,
      total: this.events.length,
      lastEvent: last ?? null,
      nextEvent: next ?? null,
      /** Real ms between the last two applied events (what step mode shows as "+3.2s"). */
      deltaMs: last && prev ? last.t - prev.t : null,
      /** Real ms until the next event. */
      nextDeltaMs: last && next ? next.t - last.t : null,
      visualNow: this.mode.startsWith('live')
        ? last
          ? last.t - (this.events[0]?.t ?? 0)
          : 0
        : this.vclock,
      visualEnd: this.visualEnd(),
      realElapsedMs: last ? last.t - (this.events[0]?.t ?? last.t) : 0,
      realTotalMs: this.events.length
        ? (this.events[this.events.length - 1]?.t ?? 0) - (this.events[0]?.t ?? 0)
        : 0,
      /** How far behind real time the live view is. */
      lagMs: this.mode.startsWith('live') && next ? Date.now() - next.t : 0,
      atEnd: cur >= this.events.length,
    }
  }

  visualEnd(): number {
    return this.visualT.length ? (this.visualT[this.visualT.length - 1] ?? 0) : 0
  }

  /** Visual timestamp for an event (marker positions on the scrubber). */
  visualTimeOf(seq: number): number | null {
    const idx = this.events.findIndex((e) => e.seq === seq)
    return idx < 0 ? null : (this.visualT[idx] ?? null)
  }

  /** Current virtual clock as an epoch ms (for "elapsed" rings), consistent across modes. */
  clockEpoch(): number {
    if (this.mode.startsWith('live')) return this.vclock
    // map visual time back to real time between the last applied event and the next
    const last = this.cursor > 0 ? this.events[this.cursor - 1] : undefined
    const next = this.events[this.cursor]
    if (!last) return this.events[0]?.t ?? 0
    if (!next) return last.t
    const vLast = this.visualT[this.cursor - 1] ?? 0
    const vNext = this.visualT[this.cursor] ?? vLast
    const frac =
      vNext > vLast ? Math.min(1, Math.max(0, (this.vclock - vLast) / (vNext - vLast))) : 0
    return last.t + frac * (next.t - last.t)
  }
}

/** Which character an event belongs to, for per-actor pacing. */
function actorKey(e: CafeEvent): string {
  // A ticket's own milestones pace against each other (queued -> claimed -> ready ...).
  if (e.type.startsWith('order.') && 'orderId' in e && typeof e.orderId === 'string')
    return `order:${e.orderId}`
  if ('agentId' in e && typeof e.agentId === 'string') return e.agentId
  if ('customerId' in e && typeof e.customerId === 'string') return e.customerId
  if ('baristaId' in e && typeof e.baristaId === 'string') return e.baristaId
  return e.txId ?? 'run'
}

/** A misbehaving listener (e.g. a torn-down scene) must never stall playback for the others. */
function safe(fn: () => void) {
  try {
    fn()
  } catch (err) {
    console.error('[player] listener failed', err)
  }
}
