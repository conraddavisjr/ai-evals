import { AGENT_GLYPH_SVG } from '../lib/agent-glyph.js'
import { agentLabel, CASE_NOUN, caseLabel, isAgentId, outcomeLabel } from '../lib/nomenclature.js'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import type { SceneCallbacks, SceneHandle } from '../views/types.js'
import {
  BAND_TITLE,
  BANDS,
  type Badge,
  type Band,
  buildTrace,
  type Column,
  fmt,
  type TraceModel,
} from './model.js'
import './trace.css'

const MIN_SCALE = 0.3
const MAX_SCALE = 2.5
/** Switching layouts never fits smaller than this; a 30-case board fitted whole is unreadable. */
const READABLE_SCALE = 0.6
/** Re-render at most this often; a 30-case run emits events faster than anyone reads them. */
const RENDER_EVERY_MS = 100

/**
 * How the cases are laid out on the board.
 * - grid: every case a short tile that scrolls on its own, wrapping to the width; made for 30+ cases.
 * - columns: cases side by side, each pipeline reading top to bottom (bands aligned across cases).
 * - rows: cases stacked, each pipeline reading left to right in one lane per band.
 */
export type TraceLayout = 'grid' | 'columns' | 'rows'
export const TRACE_LAYOUTS: ReadonlyArray<{ id: TraceLayout; label: string; title: string }> = [
  {
    id: 'grid',
    label: 'Grid',
    title: 'Every case as a short tile that scrolls on its own. Best for many cases.',
  },
  {
    id: 'columns',
    label: 'Columns',
    title: 'Cases side by side; each pipeline reads top to bottom.',
  },
  {
    id: 'rows',
    label: 'Rows',
    title: 'Cases stacked; each pipeline reads left to right.',
  },
]
const LAYOUT_KEY = 'cafe.traceLayout'
const TILE_KEY = 'cafe.traceTile'
const GRID_ZOOM_KEY = 'cafe.traceGridZoom'
/** Grid zoom is CSS zoom, so zooming out reflows into more columns instead of shrinking a fixed page. */
const GRID_MIN = 0.4
const GRID_MAX = 1.6
type TileSize = 's' | 'm' | 'l'
const TILE_SIZES: Record<TileSize, { w: number; h: number; label: string }> = {
  s: { w: 270, h: 190, label: 'S' },
  m: { w: 320, h: 290, label: 'M' },
  l: { w: 400, h: 460, label: 'L' },
}
const HINT: Record<TraceLayout, string> = {
  grid: 'scroll inside a tile to read it · ctrl/⌘ + scroll to zoom · expand a tile to widen it · click a badge to jump there',
  columns: 'drag to pan · scroll to zoom at the cursor · click a badge to jump there',
  rows: 'drag to pan · scroll to zoom at the cursor · click a badge to jump there',
}

/**
 * The Trace view: the whole run as a board. One card per golden case in
 * arrival order, four bands per case (case input, orchestration, agents +
 * tools, evaluation), every event a badge in sequence. No characters; maximum
 * legibility. Three layouts (grid, columns, rows) so a 3-case demo and a
 * 30-case suite both read well. Click a badge to seek the player there.
 */
export function createGame(
  parent: HTMLElement,
  player: TimelinePlayer,
  callbacks: SceneCallbacks,
): SceneHandle {
  parent.classList.add('trace-mount')
  const root = el('div', 'trace')
  const canvas = el('div', 'trace-canvas')
  const world = el('div', 'trace-world')
  const shiftStrip = el('div', 'trace-shift')
  const cols = el('div', 'trace-cols')
  const empty = el('div', 'trace-empty', 'No run loaded. Start one or pick a recent run.')
  world.append(shiftStrip, cols)
  canvas.append(world, empty)
  let layout: TraceLayout = readPref(LAYOUT_KEY, ['grid', 'columns', 'rows'], 'grid')
  let tile: TileSize = readPref(TILE_KEY, ['s', 'm', 'l'], 'm')
  const expanded = new Set<string>()
  const bar = buildBar(
    () => layout,
    (l) => setLayout(l),
    () => tile,
    (t) => setTile(t),
  )
  root.append(bar.el, canvas)
  parent.appendChild(root)

  // ---- camera (columns, rows): one transform on the world, zoom anchored at the cursor.
  // The grid keeps native scrolling (each tile scrolls on its own) and zooms with CSS zoom,
  // which reflows the tiles: zoom out and more of them fit on a row.
  const cam = { x: 24, y: 16, k: 1 }
  let gridZoom = clampGrid(Number(readPref(GRID_ZOOM_KEY, [], '1') || 1))
  const panning = () => layout !== 'grid'
  const apply = () => {
    if (panning()) {
      world.style.zoom = ''
      world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`
    } else {
      world.style.transform = ''
      world.style.zoom = String(gridZoom)
    }
    bar.zoom.textContent = `${Math.round((panning() ? cam.k : gridZoom) * 100)}%`
  }
  /** Grid zoom that keeps the row under the cursor roughly in place while the tiles reflow. */
  const zoomGrid = (z: number, cy = canvas.clientHeight / 2) => {
    const next = clampGrid(z)
    const ratio = next / gridZoom
    const anchor = canvas.scrollTop + cy
    gridZoom = next
    writePref(GRID_ZOOM_KEY, next.toFixed(2))
    apply()
    canvas.scrollTop = Math.max(0, anchor * ratio - cy)
  }
  const zoomAt = (factor: number, cx: number, cy: number) => {
    if (!panning()) return zoomGrid(gridZoom * factor, cy)
    const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.k * factor))
    const r = k / cam.k
    cam.x = cx - (cx - cam.x) * r
    cam.y = cy - (cy - cam.y) * r
    cam.k = k
    apply()
  }
  const onWheel = (ev: WheelEvent) => {
    const rect = canvas.getBoundingClientRect()
    const cx = ev.clientX - rect.left
    const cy = ev.clientY - rect.top
    if (!panning()) {
      // plain scrolling stays native (the page and each tile); ctrl/⌘ or a pinch zooms the grid
      if (!(ev.ctrlKey || ev.metaKey)) return
      ev.preventDefault()
      const d = Math.max(-80, Math.min(80, ev.deltaY))
      zoomGrid(gridZoom * Math.exp(-d * 0.0045), cy)
      return
    }
    ev.preventDefault()
    if (
      ev.ctrlKey ||
      ev.metaKey ||
      (Math.abs(ev.deltaY) >= Math.abs(ev.deltaX) * 3 && !ev.shiftKey)
    ) {
      // exponential in the delta so each notch is the same proportional step and in/out cancel
      const d = Math.max(-80, Math.min(80, ev.deltaY))
      zoomAt(Math.exp(-d * 0.0045), cx, cy)
    } else {
      cam.x -= ev.deltaX
      cam.y -= ev.deltaY
      apply()
    }
  }
  let drag: { id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null =
    null
  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0 || !panning()) return
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false }
    canvas.setPointerCapture(ev.pointerId)
  }
  const onMove = (ev: PointerEvent) => {
    if (!drag || ev.pointerId !== drag.id) return
    const dx = ev.clientX - drag.x
    const dy = ev.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true
      canvas.dataset.dragging = 'true'
    }
    if (drag.moved) {
      cam.x = drag.cx + dx
      cam.y = drag.cy + dy
      apply()
    }
  }
  const onUp = (ev: PointerEvent) => {
    if (!drag || ev.pointerId !== drag.id) return
    const moved = drag.moved
    drag = null
    delete canvas.dataset.dragging
    if (moved) suppressClick = true
  }
  let suppressClick = false
  // the click that ends a drag must not count as a badge click; clear the guard on any click
  const onClickCapture = (ev: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false
      ev.stopPropagation()
      ev.preventDefault()
    }
  }
  canvas.addEventListener('click', onClickCapture, true)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  /** Fit the whole board; `floor` keeps it legible (the rest is a pan away). */
  const fit = (floor = MIN_SCALE) => {
    if (!panning()) return fitGrid()
    const w = world.scrollWidth || 1
    const h = world.scrollHeight || 1
    const cw = canvas.clientWidth - 48
    const ch = canvas.clientHeight - 32
    cam.k = Math.min(MAX_SCALE, Math.max(floor, Math.min(cw / w, ch / h, 1)))
    cam.x = 24
    cam.y = 16
    apply()
  }
  /** The largest grid zoom (up to 100%) at which every tile is on screen at once. */
  const fitGrid = () => {
    let z = 1
    for (; z > GRID_MIN; z = Math.round((z - 0.05) * 100) / 100) {
      world.style.zoom = String(z)
      if (world.getBoundingClientRect().height <= canvas.clientHeight) break
    }
    gridZoom = z
    zoomGrid(z)
    canvas.scrollTo(0, 0)
  }
  bar.fit.addEventListener('click', () => fit())
  bar.reset.addEventListener('click', () => {
    if (!panning()) return zoomGrid(1)
    cam.k = 1
    cam.x = 24
    cam.y = 16
    apply()
  })
  bar.zoomIn.addEventListener('click', () =>
    zoomAt(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2),
  )
  bar.zoomOut.addEventListener('click', () =>
    zoomAt(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2),
  )

  const applyLayoutClass = () => {
    root.dataset.layout = layout
    root.style.setProperty('--tile-w', `${TILE_SIZES[tile].w}px`)
    root.style.setProperty('--tile-h', `${TILE_SIZES[tile].h}px`)
    bar.hint.textContent = HINT[layout]
    bar.sync()
  }
  const setLayout = (l: TraceLayout) => {
    if (l === layout) return
    layout = l
    writePref(LAYOUT_KEY, l)
    applyLayoutClass()
    canvas.scrollTo(0, 0)
    rebuild()
    if (panning()) fit(READABLE_SCALE)
    else apply()
  }
  const setTile = (t: TileSize) => {
    tile = t
    writePref(TILE_KEY, t)
    applyLayoutClass()
  }
  applyLayoutClass()

  // ---- rendering. The board is the whole run: it is built from every event the
  // player has received. New events are merged into the existing DOM (only new or
  // changed badges are touched), so scrolling, hovering and clicking keep working
  // while a run streams in. Moving the playhead never removes anything; it dims
  // what has not happened yet and moves the "current" outline.
  let fullRebuild = true
  let cursorDirty = true
  let lastCount = -1
  let lastEvents: unknown = null
  let lastRender = 0
  let lastSeq: number | null = null
  let model: TraceModel = { columns: [], shift: [], runStatus: 'idle' }
  /** Isolate: one agent's badges stay lit across the board, everything else fades. */
  let focusAgent: string | null = null
  interface BadgeRef {
    el: HTMLElement
    sig: string
    seq: number
    agentId: string | undefined
  }
  const badges = new Map<string, BadgeRef>()
  const firstBySeq = new Map<number, HTMLElement>()
  interface CardRef {
    col: Column
    card: HTMLElement
    pill: HTMLElement
    lists: Record<Band, HTMLElement>
    sections: Record<Band, HTMLElement>
    segs: Array<{ el: HTMLElement; seqs: number[]; bad: number[]; warn: number[] }>
  }
  const cards = new Map<string, CardRef>()
  /** When someone last scrolled or clicked inside a tile; that tile stops following the playhead for a while. */
  const touched = new Map<string, number>()
  const HANDS_OFF_MS = 4000
  // rAF pauses in hidden tabs; a slow timer keeps the board current so it is right on return
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null
  const markDirty = () => {
    cursorDirty = true
    if (document.hidden && hiddenTimer === null)
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null
        if (needsRender()) render()
        else applyCursor()
      }, 250)
  }
  /** player.reset() swaps in a new array, so identity catches a new run of the same length. */
  const needsRender = () =>
    fullRebuild || player.events !== lastEvents || player.events.length !== lastCount
  const unsubscribe = player.subscribe({ onApply: markDirty, onSnap: markDirty })

  /** Throw the DOM away and lay the board out again (a new run, a new layout). */
  const rebuild = () => {
    fullRebuild = true
    render()
  }

  const render = () => {
    const full = fullRebuild || player.events !== lastEvents
    fullRebuild = false
    model = buildTrace(player.events)
    empty.style.display = model.columns.length === 0 && model.shift.length === 0 ? '' : 'none'
    if (full) {
      badges.clear()
      cards.clear()
      shiftStrip.replaceChildren()
      cols.replaceChildren()
      lastSeq = null
    }
    firstBySeq.clear()
    syncList(shiftStrip, model.shift, true)
    for (const c of model.columns) {
      let ref = cards.get(c.txId)
      if (!ref) {
        ref = makeCard(c)
        cards.set(c.txId, ref)
        cols.appendChild(ref.card)
      }
      ref.col = c
      for (const band of BANDS) {
        syncList(ref.lists[band], c.bands[band], false)
        if (layout === 'columns')
          ref.sections[band].style.minHeight = `${bandHeight(model, band)}px`
      }
      if (ref.segs.length)
        BANDS.forEach((band, i) => {
          const seg = ref.segs[i]
          if (!seg) return
          const list = c.bands[band]
          seg.seqs = list.map((b) => b.seq)
          seg.bad = list.filter((b) => b.mark === 'bad').map((b) => b.seq)
          seg.warn = list.filter((b) => b.mark === 'warn').map((b) => b.seq)
        })
    }
    if (lastCount < 0 && panning()) fit(READABLE_SCALE)
    lastCount = player.events.length
    lastEvents = player.events
    lastRender = performance.now()
    applyCursor()
  }

  /** Make `list` hold exactly these badges in this order, reusing elements and updating only what changed. */
  const syncList = (list: HTMLElement, items: Badge[], chip: boolean) => {
    items.forEach((b, i) => {
      const key = b.key ?? String(b.seq)
      const sig = signature(b)
      let ref = badges.get(key)
      if (!ref) {
        ref = { el: makeBadge(b, chip), sig, seq: b.seq, agentId: b.agentId }
        badges.set(key, ref)
      } else if (ref.sig !== sig) {
        fillBadge(ref.el, b)
        ref.sig = sig
      }
      if (!firstBySeq.has(b.seq)) firstBySeq.set(b.seq, ref.el)
      const at = list.children[i]
      if (at !== ref.el) list.insertBefore(ref.el, at ?? null)
    })
    while (list.children.length > items.length) list.lastElementChild?.remove()
    if (items.length === 0 && !chip) list.appendChild(el('div', 'band-none', '·'))
  }

  /** Restyle for the playhead and the isolate: dim the future, show each case's state as of now. */
  const applyCursor = () => {
    cursorDirty = false
    const at = player.position.lastEvent?.seq ?? -1
    for (const r of badges.values()) {
      r.el.classList.toggle('ahead', r.seq > at)
      r.el.classList.toggle('muted', focusAgent !== null && r.agentId !== focusAgent)
    }
    for (const { col, card, pill, segs } of cards.values()) {
      const notYet = col.startSeq > at
      card.classList.toggle('ahead', notYet)
      card.classList.toggle(
        'muted',
        focusAgent !== null &&
          !BANDS.some((band) => col.bands[band].some((b) => b.agentId === focusAgent)),
      )
      const known = col.leftSeq !== null && col.leftSeq <= at ? col.outcome : null
      pill.className = `pill ${known ?? 'open'}`
      pill.textContent = notYet ? 'not arrived' : outcomeLabel(known)
      for (const o of ['served', 'refused', 'failed', 'abandoned', 'open'])
        card.classList.toggle(`outcome-${o}`, o === (known ?? 'open'))
      for (const s of segs) {
        const seen = (xs: number[]) => xs.some((x) => x <= at)
        s.el.classList.toggle('lit', seen(s.seqs))
        s.el.classList.toggle('bad', seen(s.bad))
        s.el.classList.toggle('warn', !seen(s.bad) && seen(s.warn))
      }
    }
    for (const chip of shiftStrip.querySelectorAll<HTMLElement>('.trace-badge')) {
      const on = focusAgent !== null && chip.dataset.agent === focusAgent
      chip.classList.toggle('on', on)
      if (chip.dataset.agent) chip.setAttribute('aria-pressed', String(on))
    }
    bar.focus.hidden = focusAgent === null
    bar.focusText.textContent = focusAgent ? `isolating ${agentLabel(focusAgent)}` : ''
    const pos = player.position
    // live views always trail the stream by the buffer; they are at the run's front, not a chosen moment
    bar.status.textContent = summary(
      model,
      at,
      pos.cursor >= pos.total || player.mode.startsWith('live'),
    )
    markCurrent(player.position.lastEvent?.seq ?? null)
    if (layout === 'grid') followPlayhead(at)
  }

  const setFocus = (agentId: string | null) => {
    focusAgent = agentId
    callbacks.onSelect(agentId)
    applyCursor()
  }
  bar.focusClear.addEventListener('click', () => setFocus(null))
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && focusAgent !== null) setFocus(null)
  }
  window.addEventListener('keydown', onKey)

  /**
   * Keep each tile scrolled to where its case is at the playhead: the latest step
   * that has happened, or the top when the case has not started. A tile someone
   * just scrolled or clicked in is left alone, and nothing moves while the playhead stands still.
   */
  const followPlayhead = (at: number) => {
    const now = performance.now()
    for (const [tx, ref] of cards) {
      const body = ref.card.querySelector<HTMLElement>('.trace-tile-body')
      if (!body || now - (touched.get(tx) ?? Number.NEGATIVE_INFINITY) < HANDS_OFF_MS) continue
      let latest: HTMLElement | null = null
      let latestSeq = -1
      for (const b of body.querySelectorAll<HTMLElement>('.trace-badge')) {
        const seq = Number(b.dataset.seq)
        if (seq <= at && seq > latestSeq) {
          latest = b
          latestSeq = seq
        }
      }
      if (!latest) {
        if (body.scrollTop !== 0) body.scrollTop = 0
        continue
      }
      const top = latest.offsetTop - body.offsetTop
      if (top < body.scrollTop + 22 || top > body.scrollTop + body.clientHeight - 24)
        body.scrollTop = Math.max(0, top - body.clientHeight * 0.6)
    }
  }

  const makeBadge = (b: Badge, chip: boolean): HTMLElement => {
    const e = el('button', '')
    e.type = 'button'
    fillBadge(e, b)
    if (chip && b.agentId && isAgentId(b.agentId)) {
      // a staff chip isolates that agent across the board; click it again to show everything
      const agentId = b.agentId
      e.dataset.agent = agentId
      e.setAttribute('aria-pressed', 'false')
      e.addEventListener('click', () => setFocus(focusAgent === agentId ? null : agentId))
    } else if (chip) {
      // run and done chips carry no single agent: they clear an isolate
      e.addEventListener('click', () => setFocus(null))
    } else {
      e.addEventListener('click', () => {
        player.seekToSeq(b.seq)
        player.pause()
        callbacks.onSelect(b.agentId ?? b.customerId ?? null)
      })
    }
    return e
  }

  /** Fill (or refill, when a result or latency arrives) a badge's contents in place. */
  const fillBadge = (e: HTMLElement, b: Badge) => {
    const keep = ['current', 'ahead', 'muted', 'on'].filter((c) => e.classList.contains(c))
    e.className = `trace-badge layer-${b.layer}${b.indent ? ' indent' : ''} ${keep.join(' ')}`
    e.dataset.seq = String(b.seq)
    const mark = el('span', `mark ${b.mark ?? 'none'}`, markGlyph(b.mark))
    const head = el('span', 'head', b.head)
    if (b.layer === 'agent' && isAgentId(b.agentId)) {
      const g = el('span', 'agent-glyph')
      g.innerHTML = AGENT_GLYPH_SVG
      head.prepend(g)
    }
    // an MCP tool call reads as the tool, not as the agent that made it
    if (b.layer === 'tool') head.prepend(el('span', 'mcp-tag', 'MCP'))
    const text = el('span', 'text', b.text)
    const meta = el(
      'span',
      'meta',
      `${b.atMs > 0 ? `+${fmt(b.atMs)}` : ''}${b.latencyMs !== undefined ? ` · ${fmt(b.latencyMs)}` : ''}`,
    )
    e.replaceChildren(mark, head, text, meta)
    e.title = [
      b.layer === 'tool'
        ? `MCP tool ${b.head}${b.agentId ? `, called by ${agentLabel(b.agentId)}` : ''}`
        : b.head,
      b.text,
      b.detail,
      b.latencyMs !== undefined ? `${fmt(b.latencyMs)} latency` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** "Case 3", the case title (or its id on older runs), the outcome. Shared by every layout. */
  const caseHead = (c: Column, extra?: HTMLElement): { head: HTMLElement; pill: HTMLElement } => {
    const head = el('header', 'trace-col-head')
    const sid = c.scenarioId.replace(/^ds:[^:]+:/, '')
    const name = el('span', 'sid', c.title || sid)
    head.title = [caseLabel(c.index), c.title, sid, c.name && `persona: ${c.name}`]
      .filter(Boolean)
      .join('\n')
    const pill = el('span', 'pill open', outcomeLabel(null))
    head.append(el('span', 'idx', caseLabel(c.index)), name, pill)
    if (extra) head.append(extra)
    return { head, pill }
  }

  /** An empty card for a case in the current layout; its badge lists are filled by syncList. */
  const makeCard = (c: Column): CardRef => {
    const lists = {} as Record<Band, HTMLElement>
    const sections = {} as Record<Band, HTMLElement>
    const section = (band: Band, cls: string, listCls: string) => {
      const sec = el('div', `${cls} band-${band}`)
      sec.appendChild(el('div', 'band-title', BAND_TITLE[band]))
      const list = el('div', listCls)
      sec.appendChild(list)
      lists[band] = list
      sections[band] = sec
      return sec
    }
    if (layout === 'rows') {
      const card = el('section', 'trace-col trace-row')
      const { head, pill } = caseHead(c)
      const lanes = el('div', 'trace-lanes')
      for (const band of BANDS) lanes.appendChild(section(band, 'trace-lane', 'lane-list'))
      card.append(head, lanes)
      return { col: c, card, pill, lists, sections, segs: [] }
    }
    if (layout === 'columns') {
      const card = el('section', 'trace-col')
      const { head, pill } = caseHead(c)
      card.appendChild(head)
      for (const band of BANDS) card.appendChild(section(band, 'trace-band', 'band-list'))
      return { col: c, card, pill, lists, sections, segs: [] }
    }
    const card = el('section', `trace-col trace-tile${expanded.has(c.txId) ? ' expanded' : ''}`)
    const grow = el('button', 'tile-grow')
    grow.type = 'button'
    const syncGrow = () => {
      const open = expanded.has(c.txId)
      card.classList.toggle('expanded', open)
      grow.textContent = open ? '⤡' : '⤢'
      grow.title = open ? 'Shrink this case back to one tile' : 'Expand this case'
      grow.setAttribute('aria-label', grow.title)
      grow.setAttribute('aria-pressed', String(open))
    }
    syncGrow()
    grow.addEventListener('click', () => {
      if (expanded.has(c.txId)) expanded.delete(c.txId)
      else expanded.add(c.txId)
      syncGrow()
    })
    const { head, pill } = caseHead(c, grow)
    const strip = progressStrip(c)
    const body = el('div', 'trace-tile-body')
    body.dataset.tx = c.txId
    const handsOn = () => touched.set(c.txId, performance.now())
    body.addEventListener('wheel', handsOn, { passive: true })
    body.addEventListener('pointerdown', handsOn)
    for (const band of BANDS) body.appendChild(section(band, 'trace-band', 'band-list'))
    card.append(head, strip.el, body)
    return { col: c, card, pill, lists, sections, segs: strip.segs }
  }

  // ---- frame loop: tick the player (contract), merge new events, keep the cursor marked
  let raf = 0
  let last: number | null = null
  const frame = (now: number) => {
    player.tick(now)
    if (needsRender() && performance.now() - lastRender >= RENDER_EVERY_MS) render()
    else if (cursorDirty || (player.position.lastEvent?.seq ?? null) !== lastSeq) applyCursor()
    last = now
    raf = requestAnimationFrame(frame)
  }
  /** Outline the badge of the event the playhead is on. */
  const markCurrent = (seq: number | null) => {
    if (seq !== lastSeq) {
      if (lastSeq !== null) firstBySeq.get(lastSeq)?.classList.remove('current')
      const cur = seq !== null ? firstBySeq.get(seq) : undefined
      cur?.classList.add('current')
      lastSeq = seq
    }
  }
  raf = requestAnimationFrame(frame)
  apply()

  return {
    step(now: number) {
      if (last === null) last = now
      frame(now)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    destroy() {
      cancelAnimationFrame(raf)
      if (hiddenTimer !== null) clearTimeout(hiddenTimer)
      unsubscribe()
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('click', onClickCapture, true)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      root.remove()
      parent.classList.remove('trace-mount')
    },
  }
}

/**
 * Four segments under a tile's header, one per band, lit once the band has work
 * in it and marked red when anything in it failed. Reads at a glance across 30 tiles.
 */
function progressStrip(c: Column): {
  el: HTMLElement
  segs: Array<{ el: HTMLElement; seqs: number[]; bad: number[]; warn: number[] }>
} {
  const strip = el('div', 'tile-progress')
  const segs = BANDS.map((band) => {
    const list = c.bands[band]
    const seg = el('span', `seg band-${band}`)
    seg.title = BAND_TITLE[band]
    strip.appendChild(seg)
    return {
      el: seg,
      seqs: list.map((b) => b.seq),
      bad: list.filter((b) => b.mark === 'bad').map((b) => b.seq),
      warn: list.filter((b) => b.mark === 'warn').map((b) => b.seq),
    }
  })
  return { el: strip, segs }
}

function bandHeight(model: TraceModel, band: Band): number {
  const rows = Math.max(1, ...model.columns.map((c) => c.bands[band].length))
  return 30 + rows * 24
}

/** The run as of the playhead: how many cases have arrived, finished and matched. */
function summary(m: TraceModel, at: number, atEnd: boolean): string {
  if (m.columns.length === 0) return `no ${CASE_NOUN.many} yet`
  const done = m.columns.filter((c) => c.leftSeq !== null && c.leftSeq <= at)
  const passed = done.filter((c) => c.expectedOutcome && c.outcome === c.expectedOutcome).length
  return `${m.columns.length} ${CASE_NOUN.many} · ${done.length} done · ${passed} matched expectation · ${atEnd ? m.runStatus : 'at the playhead'}`
}

/** Everything a badge shows: a change in any of it (a result, a latency, a verdict) refills the badge. */
function signature(b: Badge): string {
  return `${b.layer}|${b.head}|${b.text}|${b.mark ?? ''}|${b.latencyMs ?? ''}|${b.detail ?? ''}|${b.atMs}|${b.indent ? 1 : 0}`
}

function markGlyph(m: Badge['mark']): string {
  return m === 'ok' ? '✓' : m === 'bad' ? '✗' : m === 'warn' ? '!' : m === 'unknown' ? '?' : ''
}

function buildBar(
  getLayout: () => TraceLayout,
  onLayout: (l: TraceLayout) => void,
  getTile: () => TileSize,
  onTile: (t: TileSize) => void,
) {
  const bar = el('div', 'trace-bar')
  const title = el('span', 'title', 'Trace')
  const layouts = el('div', 'trace-seg')
  layouts.setAttribute('role', 'group')
  layouts.setAttribute('aria-label', 'Layout')
  const layoutBtns = TRACE_LAYOUTS.map((l) => {
    const b = btn(l.label, l.title)
    b.removeAttribute('aria-label')
    b.addEventListener('click', () => onLayout(l.id))
    layouts.appendChild(b)
    return [l.id, b] as const
  })
  const tiles = el('div', 'trace-seg tile-size')
  tiles.setAttribute('role', 'group')
  tiles.setAttribute('aria-label', 'Tile size')
  tiles.appendChild(el('span', 'seg-label', 'Tile'))
  const tileBtns = (Object.keys(TILE_SIZES) as TileSize[]).map((t) => {
    const b = btn(TILE_SIZES[t].label, `${TILE_SIZES[t].label} tiles`)
    b.addEventListener('click', () => onTile(t))
    tiles.appendChild(b)
    return [t, b] as const
  })
  const hint = el('span', 'hint', '')
  const status = el('span', 'status', '')
  const camera = el('div', 'trace-camera')
  const zoomOut = btn('−', 'Zoom out')
  const zoom = el('span', 'zoom', '100%')
  const zoomIn = btn('+', 'Zoom in')
  const fit = btn('Fit', 'Fit the board')
  const reset = btn('1:1', 'Reset zoom')
  camera.append(zoomOut, zoom, zoomIn, fit, reset)
  const legend = el('div', 'legend')
  for (const [cls, label] of [
    ['input', 'case input'],
    ['orch', 'orchestration'],
    ['agent', 'sub-agent'],
    ['tool', 'MCP tool'],
    ['eval', 'evaluation'],
    ['error', 'error'],
  ] as const) {
    const s = el('span', `layer-${cls}`, label)
    s.prepend(el('i', ''))
    legend.appendChild(s)
  }
  const focus = el('span', 'trace-focus')
  focus.hidden = true
  const focusText = el('span', '', '')
  const focusClear = btn('show all', 'Clear the isolate (Esc)')
  focus.append(focusText, focusClear)
  bar.append(title, layouts, tiles, camera, hint, legend, focus, status)
  const sync = () => {
    const l = getLayout()
    for (const [id, b] of layoutBtns) {
      b.classList.toggle('on', id === l)
      b.setAttribute('aria-pressed', String(id === l))
    }
    for (const [id, b] of tileBtns) {
      b.classList.toggle('on', id === getTile())
      b.setAttribute('aria-pressed', String(id === getTile()))
    }
    tiles.hidden = l !== 'grid'
  }
  return {
    el: bar,
    status,
    hint,
    zoom,
    zoomIn,
    zoomOut,
    fit,
    reset,
    sync,
    focus,
    focusText,
    focusClear,
  }
}

function clampGrid(z: number): number {
  return Math.min(GRID_MAX, Math.max(GRID_MIN, Number.isFinite(z) ? z : 1))
}

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    // an empty allow-list accepts any stored value (numbers such as a zoom level)
    return v && (allowed.length === 0 || (allowed as readonly string[]).includes(v))
      ? (v as T)
      : fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: the choice just does not persist */
  }
}

function btn(text: string, label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = text
  b.title = label
  b.setAttribute('aria-label', label)
  return b
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
