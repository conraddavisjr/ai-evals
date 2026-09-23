import { AGENT_GLYPH_SVG } from '../lib/agent-glyph.js'
import { CASE_NOUN, caseLabel, isAgentId } from '../lib/nomenclature.js'
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
    render()
    if (panning()) fit(READABLE_SCALE)
    else apply()
  }
  const setTile = (t: TileSize) => {
    tile = t
    writePref(TILE_KEY, t)
    applyLayoutClass()
  }
  applyLayoutClass()

  // ---- rendering: rebuild from the applied events whenever something changed
  let dirty = true
  let lastCount = -1
  let lastRender = 0
  let lastSeq: number | null = null
  const badgeEls = new Map<number, HTMLElement>()
  /** Per-tile scroll memory so a rebuild never throws away where someone was reading. */
  const tileScroll = new Map<string, { top: number; pinned: boolean }>()
  // rAF pauses in hidden tabs; a slow timer keeps the board current so it is right on return
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null
  const markDirty = () => {
    dirty = true
    if (document.hidden && hiddenTimer === null)
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null
        if (dirty) {
          dirty = false
          render()
        }
      }, 250)
  }
  const unsubscribe = player.subscribe({ onApply: markDirty, onSnap: markDirty })

  const render = () => {
    const model = buildTrace(player.state.applied)
    empty.style.display = model.columns.length === 0 && model.shift.length === 0 ? '' : 'none'
    // remember each tile's scroll before the rebuild; a tile scrolled to the bottom keeps following
    for (const body of cols.querySelectorAll<HTMLElement>('.trace-tile-body')) {
      const id = body.dataset.tx
      if (id)
        tileScroll.set(id, {
          top: body.scrollTop,
          pinned: body.scrollHeight - body.scrollTop - body.clientHeight < 8,
        })
    }
    badgeEls.clear()
    lastSeq = null
    shiftStrip.replaceChildren(...model.shift.map((b) => badge(b)))
    const cards = model.columns.map((c) =>
      layout === 'grid' ? tileCard(c) : layout === 'rows' ? rowCard(c) : columnCard(c, model),
    )
    cols.replaceChildren(...cards)
    if (layout === 'grid')
      for (const body of cols.querySelectorAll<HTMLElement>('.trace-tile-body')) {
        const mem = body.dataset.tx ? tileScroll.get(body.dataset.tx) : undefined
        body.scrollTop = !mem || mem.pinned ? body.scrollHeight : mem.top
      }
    bar.status.textContent = summary(model)
    if (lastCount < 0 && panning()) fit(READABLE_SCALE)
    lastCount = player.state.applied.length
    lastRender = performance.now()
  }

  const badge = (b: Badge): HTMLElement => {
    const e = el('button', `trace-badge layer-${b.layer}${b.indent ? ' indent' : ''}`)
    e.type = 'button'
    e.dataset.seq = String(b.seq)
    const mark = el('span', `mark ${b.mark ?? 'none'}`, markGlyph(b.mark))
    const head = el('span', 'head', b.head)
    if (b.layer === 'agent' && isAgentId(b.agentId)) {
      const g = el('span', 'agent-glyph')
      g.innerHTML = AGENT_GLYPH_SVG
      head.prepend(g)
    }
    const text = el('span', 'text', b.text)
    const meta = el(
      'span',
      'meta',
      `${b.atMs > 0 ? `+${fmt(b.atMs)}` : ''}${b.latencyMs !== undefined ? ` · ${fmt(b.latencyMs)}` : ''}`,
    )
    e.append(mark, head, text, meta)
    e.title = [
      b.head,
      b.text,
      b.detail,
      b.latencyMs !== undefined ? `${fmt(b.latencyMs)} latency` : '',
    ]
      .filter(Boolean)
      .join('\n')
    e.addEventListener('click', () => {
      player.seekToSeq(b.seq)
      player.pause()
      callbacks.onSelect(b.agentId ?? b.customerId ?? null)
    })
    badgeEls.set(b.seq, e)
    return e
  }

  /** "Case 3", the case title (or its id on older runs), the outcome. Shared by every layout. */
  const caseHead = (c: Column, extra?: HTMLElement): HTMLElement => {
    const head = el('header', 'trace-col-head')
    const sid = c.scenarioId.replace(/^ds:[^:]+:/, '')
    const name = el('span', 'sid', c.title || sid)
    head.title = [caseLabel(c.index), c.title, sid, c.name && `persona: ${c.name}`]
      .filter(Boolean)
      .join('\n')
    head.append(
      el('span', 'idx', caseLabel(c.index)),
      name,
      el('span', `pill ${c.outcome ?? 'open'}`, c.outcome ?? 'in progress'),
    )
    if (extra) head.append(extra)
    return head
  }

  const bandSection = (c: Column, band: Band, minHeight?: number): HTMLElement => {
    const sec = el('div', `trace-band band-${band}`)
    if (minHeight) sec.style.minHeight = `${minHeight}px`
    sec.appendChild(el('div', 'band-title', BAND_TITLE[band]))
    const list = el('div', 'band-list')
    for (const b of c.bands[band]) list.appendChild(badge(b))
    if (c.bands[band].length === 0) list.appendChild(el('div', 'band-none', '·'))
    sec.appendChild(list)
    return sec
  }

  const columnCard = (c: Column, model: TraceModel): HTMLElement => {
    const card = el('section', `trace-col outcome-${c.outcome ?? 'open'}`)
    card.appendChild(caseHead(c))
    for (const band of BANDS) card.appendChild(bandSection(c, band, bandHeight(model, band)))
    return card
  }

  const tileCard = (c: Column): HTMLElement => {
    const isOpen = expanded.has(c.txId)
    const card = el(
      'section',
      `trace-col trace-tile outcome-${c.outcome ?? 'open'}${isOpen ? ' expanded' : ''}`,
    )
    const grow = el('button', 'tile-grow', isOpen ? '⤡' : '⤢')
    grow.type = 'button'
    grow.title = isOpen ? 'Shrink this case back to one tile' : 'Expand this case'
    grow.setAttribute('aria-label', grow.title)
    grow.setAttribute('aria-pressed', String(isOpen))
    grow.addEventListener('click', () => {
      if (expanded.has(c.txId)) expanded.delete(c.txId)
      else expanded.add(c.txId)
      render()
    })
    card.appendChild(caseHead(c, grow))
    card.appendChild(progressStrip(c))
    const body = el('div', 'trace-tile-body')
    body.dataset.tx = c.txId
    for (const band of BANDS) body.appendChild(bandSection(c, band))
    card.appendChild(body)
    return card
  }

  const rowCard = (c: Column): HTMLElement => {
    const card = el('section', `trace-col trace-row outcome-${c.outcome ?? 'open'}`)
    card.appendChild(caseHead(c))
    const lanes = el('div', 'trace-lanes')
    for (const band of BANDS) {
      const lane = el('div', `trace-lane band-${band}`)
      lane.appendChild(el('div', 'band-title', BAND_TITLE[band]))
      const list = el('div', 'lane-list')
      for (const b of c.bands[band]) list.appendChild(badge(b))
      if (c.bands[band].length === 0) list.appendChild(el('div', 'band-none', '·'))
      lane.appendChild(list)
      lanes.appendChild(lane)
    }
    card.appendChild(lanes)
    return card
  }

  // ---- frame loop: tick the player (contract), re-render when dirty, keep the cursor marked
  let raf = 0
  let last: number | null = null
  const frame = (now: number) => {
    player.tick(now)
    if (
      (dirty || player.state.applied.length !== lastCount) &&
      performance.now() - lastRender >= RENDER_EVERY_MS
    ) {
      dirty = false
      render()
    }
    const seq = player.position.lastEvent?.seq ?? null
    if (seq !== lastSeq) {
      if (lastSeq !== null) badgeEls.get(lastSeq)?.classList.remove('current')
      const cur = seq !== null ? badgeEls.get(seq) : undefined
      cur?.classList.add('current')
      // stepping or seeking in the grid: bring the badge into view inside its own tile
      if (cur && layout === 'grid' && !player.playing) {
        const body = cur.closest<HTMLElement>('.trace-tile-body')
        if (body) {
          const top = cur.offsetTop - body.offsetTop
          if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - 24)
            body.scrollTop = Math.max(0, top - body.clientHeight / 3)
        }
      }
      lastSeq = seq
    }
    last = now
    raf = requestAnimationFrame(frame)
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
function progressStrip(c: Column): HTMLElement {
  const strip = el('div', 'tile-progress')
  for (const band of BANDS) {
    const list = c.bands[band]
    const bad = list.some((b) => b.mark === 'bad')
    const warn = list.some((b) => b.mark === 'warn')
    const seg = el(
      'span',
      `seg band-${band}${list.length ? ' lit' : ''}${bad ? ' bad' : warn ? ' warn' : ''}`,
    )
    seg.title = `${BAND_TITLE[band]}: ${list.length} step${list.length === 1 ? '' : 's'}${bad ? ', something failed' : ''}`
    strip.appendChild(seg)
  }
  return strip
}

function bandHeight(model: TraceModel, band: Band): number {
  const rows = Math.max(1, ...model.columns.map((c) => c.bands[band].length))
  return 30 + rows * 24
}

function summary(m: TraceModel): string {
  const done = m.columns.filter((c) => c.outcome).length
  const passed = m.columns.filter(
    (c) => c.expectedOutcome && c.outcome === c.expectedOutcome,
  ).length
  return m.columns.length === 0
    ? `no ${CASE_NOUN.many} yet`
    : `${m.columns.length} ${CASE_NOUN.many} · ${done} done · ${passed} matched expectation · ${m.runStatus}`
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
  bar.append(title, layouts, tiles, camera, hint, legend, status)
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
  return { el: bar, status, hint, zoom, zoomIn, zoomOut, fit, reset, sync }
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
