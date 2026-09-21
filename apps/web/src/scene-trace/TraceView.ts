import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import type { SceneCallbacks, SceneHandle } from '../views/types.js'
import { BAND_TITLE, BANDS, type Badge, buildTrace, fmt, type TraceModel } from './model.js'
import './trace.css'

const MIN_SCALE = 0.3
const MAX_SCALE = 2.5

/**
 * The Trace view: the whole shift as a board. One column per golden item in
 * arrival order, four bands top to bottom (item, orchestration, agents + tools,
 * evaluation), every event a badge in sequence. No characters; maximum
 * legibility. Pan by dragging, zoom with the wheel around the cursor, click a
 * badge to seek the player there.
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
  const empty = el('div', 'trace-empty', 'No shift loaded. Open the cafe or pick a recent shift.')
  world.append(shiftStrip, cols)
  canvas.append(world, empty)
  const bar = buildBar()
  root.append(bar.el, canvas)
  parent.appendChild(root)

  // ---- camera: one transform on the world, zoom anchored at the cursor
  const cam = { x: 24, y: 16, k: 1 }
  const apply = () => {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`
    bar.zoom.textContent = `${Math.round(cam.k * 100)}%`
  }
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.k * factor))
    const r = k / cam.k
    cam.x = cx - (cx - cam.x) * r
    cam.y = cy - (cy - cam.y) * r
    cam.k = k
    apply()
  }
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const cx = ev.clientX - rect.left
    const cy = ev.clientY - rect.top
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
    if (ev.button !== 0) return
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
  const fit = () => {
    const w = world.scrollWidth || 1
    const h = world.scrollHeight || 1
    const cw = canvas.clientWidth - 48
    const ch = canvas.clientHeight - 32
    cam.k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(cw / w, ch / h, 1)))
    cam.x = 24
    cam.y = 16
    apply()
  }
  bar.fit.addEventListener('click', fit)
  bar.reset.addEventListener('click', () => {
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

  // ---- rendering: rebuild from the applied events whenever something changed
  let dirty = true
  let lastCount = -1
  let lastSeq: number | null = null
  const badgeEls = new Map<number, HTMLElement>()
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
    badgeEls.clear()
    shiftStrip.replaceChildren(...model.shift.map((b) => badge(b)))
    cols.replaceChildren(...model.columns.map((c) => column(c, model)))
    bar.status.textContent = summary(model)
    if (lastCount < 0) fit()
    lastCount = player.state.applied.length
  }

  const badge = (b: Badge): HTMLElement => {
    const e = el('button', `trace-badge layer-${b.layer}${b.indent ? ' indent' : ''}`)
    e.type = 'button'
    e.dataset.seq = String(b.seq)
    const mark = el('span', `mark ${b.mark ?? 'none'}`, markGlyph(b.mark))
    const head = el('span', 'head', b.head)
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

  const column = (c: TraceModel['columns'][number], model: TraceModel): HTMLElement => {
    const col = el('section', `trace-col outcome-${c.outcome ?? 'open'}`)
    const head = el('header', 'trace-col-head')
    head.append(
      el('span', 'idx', `#${c.index}`),
      el('span', 'sid', c.scenarioId.replace(/^ds:[^:]+:/, '')),
      el('span', 'who', c.name),
      el('span', `pill ${c.outcome ?? 'open'}`, c.outcome ?? 'in progress'),
    )
    col.appendChild(head)
    for (const band of BANDS) {
      const sec = el('div', `trace-band band-${band}`)
      sec.style.minHeight = `${bandHeight(model, band)}px`
      sec.appendChild(el('div', 'band-title', BAND_TITLE[band]))
      const list = el('div', 'band-list')
      for (const b of c.bands[band]) list.appendChild(badge(b))
      if (c.bands[band].length === 0) list.appendChild(el('div', 'band-none', '·'))
      sec.appendChild(list)
      col.appendChild(sec)
    }
    return col
  }

  // ---- frame loop: tick the player (contract), re-render when dirty, keep the cursor marked
  let raf = 0
  let last: number | null = null
  const frame = (now: number) => {
    player.tick(now)
    if (dirty || player.state.applied.length !== lastCount) {
      dirty = false
      render()
    }
    const seq = player.position.lastEvent?.seq ?? null
    if (seq !== lastSeq) {
      if (lastSeq !== null) badgeEls.get(lastSeq)?.classList.remove('current')
      if (seq !== null) badgeEls.get(seq)?.classList.add('current')
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

function bandHeight(model: TraceModel, band: Band): number {
  const rows = Math.max(1, ...model.columns.map((c) => c.bands[band].length))
  return 30 + rows * 24
}
type Band = (typeof BANDS)[number]

function summary(m: TraceModel): string {
  const done = m.columns.filter((c) => c.outcome).length
  const passed = m.columns.filter(
    (c) => c.expectedOutcome && c.outcome === c.expectedOutcome,
  ).length
  return m.columns.length === 0
    ? 'no visits yet'
    : `${m.columns.length} items · ${done} done · ${passed} matched expectation · ${m.runStatus}`
}

function markGlyph(m: Badge['mark']): string {
  return m === 'ok' ? '✓' : m === 'bad' ? '✗' : m === 'warn' ? '!' : m === 'unknown' ? '?' : ''
}

function buildBar() {
  const bar = el('div', 'trace-bar')
  const title = el('span', 'title', 'Trace')
  const hint = el(
    'span',
    'hint',
    'drag to pan · scroll to zoom at the cursor · click a badge to jump there',
  )
  const status = el('span', 'status', '')
  const zoomOut = btn('−', 'Zoom out')
  const zoom = el('span', 'zoom', '100%')
  const zoomIn = btn('+', 'Zoom in')
  const fit = btn('Fit', 'Fit the board')
  const reset = btn('1:1', 'Reset zoom')
  const legend = el('div', 'legend')
  for (const [cls, label] of [
    ['input', 'golden item'],
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
  bar.append(title, hint, legend, status, zoomOut, zoom, zoomIn, fit, reset)
  return { el: bar, status, zoom, zoomIn, zoomOut, fit, reset }
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
