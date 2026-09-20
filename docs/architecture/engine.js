/* Pannable, zoomable architecture canvas. Renders `options.data`; theme decides copy and chrome. */
/**
 * Mount the diagram into `container`. `options.controls` are optional toolbar elements
 * the caller renders (zoomIn, zoomOut, fit, zoom, status, search, searchList).
 * `options.onSelect(id | null)` fires whenever the selection changes; with
 * `options.expandOnClick === false` a click selects the node (highlighting its edges,
 * dimming the rest) without widening the card, which lets a host render the node's
 * controls elsewhere. Returns { destroy, fit, expand, select, setSummary }.
 */
export function mountArchitecture(container, options) {
  const NS = 'http://www.w3.org/2000/svg'
  const XH = 'http://www.w3.org/1999/xhtml'
  const DEF_W = 250
  const DEF_H = 120
  const EXP_W = 470

  const opts = options || {}
  const controls = opts.controls || {}
  const useNick = !!opts.nicknames
  const expandOnClick = opts.expandOnClick !== false
  const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null
  const data = opts.data
  const segById = Object.fromEntries(data.segments.map((s) => [s.id, s]))
  const nodeById = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
  for (const n of data.nodes) {
    n.w = n.w || DEF_W
    n.h = n.h || DEF_H
  }

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(e)
    return e
  }
  const html = (tag, cls, text) => {
    const e = document.createElementNS(XH, tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  const root = container
  root.classList.add('archv-canvas')
  const svg = el(
    'svg',
    {
      class: 'archv-svg',
      tabindex: '0',
      role: 'application',
      'aria-label': 'Architecture diagram',
    },
    root,
  )
  const defs = el('defs', {}, svg)
  for (const [id, cls] of [
    ['arrow', 'arrow'],
    ['arrow-hi', 'arrow hi'],
  ]) {
    const m = el(
      'marker',
      {
        id,
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '8',
        markerHeight: '8',
        orient: 'auto-start-reverse',
      },
      defs,
    )
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m)
  }
  const world = el('g', { class: 'world' }, svg)
  const gSeg = el('g', { class: 'segments' }, world)
  const gEdge = el('g', { class: 'edges' }, world)
  const gNode = el('g', { class: 'nodes' }, world)

  // ---- segments
  for (const s of data.segments) {
    const g = el('g', { class: `seg tone-${s.tone}`, 'data-id': s.id }, gSeg)
    el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 18, class: 'seg-box' }, g)
    const title = useNick ? s.nick : s.title
    const sub = useNick ? `${s.title} · ${s.sub}` : s.sub
    const fo = el('foreignObject', { x: s.x + 18, y: s.y - 22, width: s.w - 36, height: 60 }, g)
    const wrap = html('div', 'seg-title')
    const t = html('span', 'seg-name', title)
    const u = html('span', 'seg-sub', sub)
    wrap.appendChild(t)
    wrap.appendChild(u)
    fo.appendChild(wrap)
  }

  // ---- edges
  const center = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })
  function anchors(a, b) {
    const ca = center(a)
    const cb = center(b)
    const dx = cb.x - ca.x
    const dy = cb.y - ca.y
    if (Math.abs(dx) * 0.8 > Math.abs(dy)) {
      const sx = dx > 0 ? a.x + a.w : a.x
      const tx = dx > 0 ? b.x : b.x + b.w
      return { s: { x: sx, y: ca.y }, t: { x: tx, y: cb.y }, horiz: true }
    }
    const sy = dy > 0 ? a.y + a.h : a.y
    const ty = dy > 0 ? b.y : b.y + b.h
    return { s: { x: ca.x, y: sy }, t: { x: cb.x, y: ty }, horiz: false }
  }
  function pathFor(a, b) {
    const { s, t, horiz } = anchors(a, b)
    const k = horiz
      ? Math.max(40, Math.abs(t.x - s.x) * 0.45)
      : Math.max(40, Math.abs(t.y - s.y) * 0.45)
    const c1 = horiz
      ? { x: s.x + Math.sign(t.x - s.x) * k, y: s.y }
      : { x: s.x, y: s.y + Math.sign(t.y - s.y) * k }
    const c2 = horiz
      ? { x: t.x - Math.sign(t.x - s.x) * k, y: t.y }
      : { x: t.x, y: t.y - Math.sign(t.y - s.y) * k }
    const mid = {
      x: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8,
      y: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8,
    }
    return { d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`, mid }
  }
  const edgeEls = []
  for (const e of data.edges) {
    const a = nodeById[e.from]
    const b = nodeById[e.to]
    if (!a || !b) continue
    const g = el('g', { class: 'edge', 'data-from': e.from, 'data-to': e.to }, gEdge)
    const { d, mid } = pathFor(a, b)
    el('path', { d, class: 'edge-hit' }, g)
    const p = el('path', { d, class: 'edge-line', 'marker-end': 'url(#arrow)' }, g)
    if (e.label) {
      const t = el(
        'text',
        { x: mid.x, y: mid.y - 6, class: 'edge-label', 'text-anchor': 'middle' },
        g,
      )
      t.textContent = e.label
    }
    edgeEls.push({ g, p, e })
  }

  // ---- nodes
  const nodeEls = {}
  let expanded = null
  for (const n of data.nodes) {
    const seg = segById[n.seg]
    const g = el('g', { class: `node tone-${seg.tone}`, 'data-id': n.id }, gNode)
    const fo = el('foreignObject', { x: n.x, y: n.y, width: n.w, height: n.h + 400 }, g)
    const card = html('div', 'card')
    card.setAttribute('role', 'button')
    card.setAttribute('tabindex', '0')
    card.style.width = `${n.w}px`
    card.style.minHeight = `${n.h}px`
    const head = html('div', 'card-head')
    head.appendChild(html('div', 'card-title', useNick ? n.title : n.title))
    if (useNick && n.nick) head.appendChild(html('div', 'card-nick', n.nick))
    card.appendChild(head)
    card.appendChild(html('p', 'card-summary', n.summary))
    const more = html('div', 'card-more')
    if (n.details?.length) {
      const ul = html('ul', 'card-details')
      for (const d of n.details) ul.appendChild(html('li', '', d))
      more.appendChild(ul)
    }
    if (n.files?.length) {
      const files = html('div', 'card-files')
      for (const f of n.files) files.appendChild(html('code', '', f))
      more.appendChild(files)
    }
    const hint = html(
      'div',
      'card-hint',
      opts.hint || (useNick ? 'tap to peek behind the counter' : 'click to expand'),
    )
    card.appendChild(more)
    card.appendChild(hint)
    fo.appendChild(card)
    nodeEls[n.id] = { g, fo, card, n, summary: card.querySelector('.card-summary') }
    const toggle = (ev) => {
      ev.stopPropagation()
      expand(expanded === n.id ? null : n.id)
    }
    card.addEventListener('click', (ev) => {
      if (dragMoved) return
      toggle(ev)
    })
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        toggle(ev)
      }
    })
  }

  function expand(id) {
    if (expanded && nodeEls[expanded]) {
      const prev = nodeEls[expanded]
      prev.g.classList.remove('open', 'selected')
      prev.fo.setAttribute('width', prev.n.w)
      prev.card.style.width = `${prev.n.w}px`
    }
    const changed = expanded !== id
    expanded = id
    svg.classList.toggle('has-open', !!id)
    for (const { g, e } of edgeEls) g.classList.toggle('hi', !!id && (e.from === id || e.to === id))
    for (const k in nodeEls) {
      const isLinked =
        !!id &&
        data.edges.some((e) => (e.from === id && e.to === k) || (e.to === id && e.from === k))
      nodeEls[k].g.classList.toggle('linked', isLinked)
      nodeEls[k].g.classList.toggle('dim', !!id && k !== id && !isLinked)
    }
    if (!id) {
      if (changed && onSelect) onSelect(null)
      return
    }
    const cur = nodeEls[id]
    if (expandOnClick) {
      cur.g.classList.add('open')
      cur.fo.setAttribute('width', EXP_W)
      cur.card.style.width = `${EXP_W}px`
    } else cur.g.classList.add('selected')
    gNode.appendChild(cur.g) // on top
    const info = controls.status
    if (info) info.textContent = `${cur.n.title} · ${segById[cur.n.seg].title}`
    if (changed && onSelect) onSelect(id)
  }

  /** Replace a node's summary line in place (a host showing live choices on the cards). */
  function setSummary(id, text) {
    const cur = nodeEls[id]
    if (cur?.summary) cur.summary.textContent = text
  }

  // ---- pan & zoom
  const view = { x: 0, y: 0, k: 1 }
  let dragging = false
  let dragMoved = false
  let start = null
  const apply = () => {
    world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`)
    svg.classList.toggle('zoomed-in', view.k >= 0.7)
    const z = controls.zoom
    if (z) z.textContent = `${Math.round(view.k * 100)}%`
  }
  function fitView() {
    const r = root.getBoundingClientRect()
    const pad = 40
    const k = Math.min((r.width - pad * 2) / data.world.w, (r.height - pad * 2) / data.world.h)
    view.k = Math.max(0.12, Math.min(2.5, k))
    view.x = (r.width - data.world.w * view.k) / 2
    view.y = (r.height - data.world.h * view.k) / 2
    apply()
  }
  function zoomAt(factor, cx, cy) {
    const nk = Math.max(0.12, Math.min(3, view.k * factor))
    const f = nk / view.k
    view.x = cx - (cx - view.x) * f
    view.y = cy - (cy - view.y) * f
    view.k = nk
    apply()
  }
  svg.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault()
      const r = root.getBoundingClientRect()
      const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015))
      zoomAt(factor, ev.clientX - r.left, ev.clientY - r.top)
    },
    { passive: false },
  )
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    dragging = true
    dragMoved = false
    start = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, id: ev.pointerId }
  })
  svg.addEventListener('pointermove', (ev) => {
    if (!dragging || !start) return
    const dx = ev.clientX - start.x
    const dy = ev.clientY - start.y
    if (!dragMoved && Math.hypot(dx, dy) > 4) {
      dragMoved = true
      svg.classList.add('grabbing')
      // capture only once a real drag starts, so plain clicks still reach the cards
      try {
        svg.setPointerCapture(start.id)
      } catch {
        /* ignore */
      }
    }
    if (dragMoved) {
      view.x = start.vx + dx
      view.y = start.vy + dy
      apply()
    }
  })
  const endDrag = (ev) => {
    if (!dragging) return
    dragging = false
    svg.classList.remove('grabbing')
    if (!dragMoved && ev.target === svg) expand(null)
    setTimeout(() => {
      dragMoved = false
    }, 0)
  }
  svg.addEventListener('pointerup', endDrag)
  svg.addEventListener('pointercancel', endDrag)
  svg.addEventListener('click', (ev) => {
    if (ev.target === svg && !dragMoved) expand(null)
  })
  // pinch on touch devices
  const touches = new Map()
  let pinchStart = null
  svg.addEventListener(
    'touchstart',
    (ev) => {
      for (const t of ev.changedTouches) touches.set(t.identifier, t)
      if (ev.touches.length === 2) {
        const [a, b] = [ev.touches[0], ev.touches[1]]
        pinchStart = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), k: view.k }
      }
    },
    { passive: true },
  )
  svg.addEventListener(
    'touchmove',
    (ev) => {
      if (ev.touches.length === 2 && pinchStart) {
        const [a, b] = [ev.touches[0], ev.touches[1]]
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const r = root.getBoundingClientRect()
        const cx = (a.clientX + b.clientX) / 2 - r.left
        const cy = (a.clientY + b.clientY) / 2 - r.top
        zoomAt((pinchStart.k * (d / pinchStart.d)) / view.k, cx, cy)
      }
    },
    { passive: true },
  )
  svg.addEventListener('touchend', () => {
    if (touches.size < 2) pinchStart = null
    touches.clear()
  })

  controls.zoomIn?.addEventListener('click', () => {
    const r = root.getBoundingClientRect()
    zoomAt(1.25, r.width / 2, r.height / 2)
  })
  controls.zoomOut?.addEventListener('click', () => {
    const r = root.getBoundingClientRect()
    zoomAt(0.8, r.width / 2, r.height / 2)
  })
  controls.fit?.addEventListener('click', fitView)
  const onKey = (ev) => {
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return
    const r = root.getBoundingClientRect()
    if (ev.key === '+' || ev.key === '=') zoomAt(1.25, r.width / 2, r.height / 2)
    else if (ev.key === '-') zoomAt(0.8, r.width / 2, r.height / 2)
    else if (ev.key === '0') fitView()
    else if (ev.key === 'Escape') expand(null)
  }
  window.addEventListener('keydown', onKey)
  const ro = new ResizeObserver(() => {
    if (!userMoved) fitView()
  })
  let userMoved = false
  svg.addEventListener(
    'pointerdown',
    () => {
      userMoved = true
    },
    { once: true },
  )
  ro.observe(root)

  // ---- search / jump
  const search = controls.search
  if (search) {
    const list = controls.searchList
    if (list)
      for (const n of data.nodes)
        list.appendChild(Object.assign(html('option'), { value: n.title }))
    search.addEventListener('change', () => {
      const q = search.value.trim().toLowerCase()
      const n =
        data.nodes.find((x) => x.title.toLowerCase() === q) ||
        data.nodes.find((x) => x.title.toLowerCase().includes(q))
      if (!n) return
      const r = root.getBoundingClientRect()
      view.k = Math.max(view.k, 0.9)
      view.x = r.width / 2 - (n.x + n.w / 2) * view.k
      view.y = r.height / 2 - (n.y + n.h / 2) * view.k
      userMoved = true
      apply()
      expand(n.id)
    })
  }

  fitView()
  if (opts.initialSelected) expand(opts.initialSelected)
  return {
    fit: fitView,
    expand,
    select: expand,
    setSummary,
    destroy() {
      ro.disconnect()
      window.removeEventListener('keydown', onKey)
      svg.remove()
    },
  }
}
