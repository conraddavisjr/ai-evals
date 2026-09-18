import * as THREE from 'three'

export type BubbleKind = 'speech' | 'thought' | 'tool' | 'shout'

interface Item {
  el: HTMLElement
  anchor: () => THREE.Vector3
  dx: number
  dy: number
  /** Where the element's own origin sits relative to the projected point. */
  origin: 'bottom' | 'top' | 'center'
}

const v = new THREE.Vector3()

/**
 * DOM layer over the canvas. Labels, bubbles, rings and alerts are ordinary HTML,
 * projected from world anchors every frame, so they share the app's typography and
 * stay crisp at any size. Pointer events are off except on the alert badges.
 */
export class Overlay {
  readonly root: HTMLDivElement
  private items = new Map<string, Item>()

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'scene-overlay'
    parent.appendChild(this.root)
  }

  set(
    id: string,
    el: HTMLElement,
    anchor: () => THREE.Vector3,
    opts: { dx?: number; dy?: number; origin?: Item['origin'] } = {},
  ) {
    this.remove(id)
    this.root.appendChild(el)
    this.items.set(id, {
      el,
      anchor,
      dx: opts.dx ?? 0,
      dy: opts.dy ?? 0,
      origin: opts.origin ?? 'bottom',
    })
  }

  get(id: string): HTMLElement | undefined {
    return this.items.get(id)?.el
  }

  remove(id: string) {
    const it = this.items.get(id)
    if (!it) return
    it.el.remove()
    this.items.delete(id)
  }

  removeByPrefix(prefix: string) {
    for (const id of [...this.items.keys()]) if (id.startsWith(prefix)) this.remove(id)
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id)
  }

  update(camera: THREE.Camera, width: number, height: number) {
    for (const it of this.items.values()) {
      v.copy(it.anchor()).project(camera)
      const x = (v.x * 0.5 + 0.5) * width + it.dx
      const y = (-v.y * 0.5 + 0.5) * height + it.dy
      const behind = v.z > 1
      it.el.style.display = behind ? 'none' : ''
      const oy = it.origin === 'bottom' ? '-100%' : it.origin === 'top' ? '0%' : '-50%'
      it.el.style.transform = `translate(-50%, ${oy}) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    }
  }

  // ---------- element factories ----------

  static tag(text: string): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'ov-tag'
    el.textContent = text
    return el
  }

  static bubble(text: string, kind: BubbleKind): HTMLDivElement {
    const el = document.createElement('div')
    el.className = `ov-bubble ${kind}`
    el.textContent = text
    return el
  }

  static ring(): { el: HTMLDivElement; set: (ratio: number, label: string) => void } {
    const el = document.createElement('div')
    el.className = 'ov-ring'
    const r = 13
    const c = 2 * Math.PI * r
    el.innerHTML = `<svg viewBox="0 0 34 34" width="34" height="34"><circle class="bg" cx="17" cy="17" r="${r}"/><circle class="fg" cx="17" cy="17" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}"/><circle class="over" cx="17" cy="17" r="${r + 3.5}" stroke-dasharray="${(2 * Math.PI * (r + 3.5)).toFixed(2)}" stroke-dashoffset="${(2 * Math.PI * (r + 3.5)).toFixed(2)}"/></svg><span class="lbl"></span>`
    const fg = el.querySelector('.fg') as SVGCircleElement
    const over = el.querySelector('.over') as SVGCircleElement
    const lbl = el.querySelector('.lbl') as HTMLSpanElement
    const c2 = 2 * Math.PI * (r + 3.5)
    return {
      el,
      set(ratio, label) {
        const frac = Math.min(1, ratio)
        fg.style.strokeDashoffset = String(c * (1 - frac))
        const overFrac = Math.max(0, Math.min(1, ratio - 1))
        over.style.strokeDashoffset = String(c2 * (1 - overFrac))
        el.dataset.level = ratio > 2 ? 'red' : ratio > 1 ? 'amber' : 'ok'
        lbl.textContent = label
      },
    }
  }

  static alert(onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'ov-alert'
    el.textContent = '!'
    el.title = 'Something went wrong. Click to read.'
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      onClick()
    })
    return el
  }

  static banner(text: string): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'ov-banner'
    el.textContent = text
    return el
  }
}
