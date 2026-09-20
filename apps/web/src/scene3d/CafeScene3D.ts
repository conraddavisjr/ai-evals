import type { CafeEvent, Station } from '@cafe/protocol'
import * as THREE from 'three'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import type { AgentView, CafeState, CustomerView } from '../state/cafe-state.js'
import type { SceneCallbacks } from '../views/types.js'
import { ticketCard } from './builders.js'
import { buildWorld, type World } from './CafeWorld.js'
import { Character } from './Character.js'
import { updateFlicker } from './effects.js'
import {
  CUSTOMER_AISLE_ROW,
  CUSTOMER_SPOTS,
  PICKUP_SLOTS,
  type Spot,
  STAFF_LANE_ROW,
  STAFF_SPOTS,
  WAITING_SLOTS,
} from './layout.js'
import { type BubbleKind, Overlay } from './Overlay.js'

const EXPECTED_WORK_MS: Record<string, number> = {
  cashier: 12000,
  barista: 12000,
  manager: 3000,
  judge: 2000,
}

interface Ticket {
  mesh: THREE.Mesh
  orderId: string
  /** Where it should hang; the mesh eases towards this. */
  target: THREE.Vector3
  bounce: boolean
  dying: boolean
}

interface Tween {
  obj: THREE.Object3D
  from: THREE.Vector3
  to: THREE.Vector3
  t: number
  dur: number
  onDone?: (() => void) | undefined
  scaleTo?: number | undefined
}

/**
 * The village square, driven purely by TimelinePlayer callbacks (onApply animates
 * one event, onSnap rebuilds from state). Same responsibilities as the pixel
 * CafeScene had, different renderer.
 */
export class CafeScene3D {
  readonly scene = new THREE.Scene()
  readonly world: World
  readonly overlay: Overlay
  private characters = new Map<string, Character>()
  private tickets = new Map<string, Ticket>()
  private tweens: Tween[] = []
  private waitingSlot = new Map<string, number>()
  private pickupSlot = new Map<string, number>()
  private rings = new Map<string, ReturnType<typeof Overlay.ring>>()
  private bubbleExpiry = new Map<string, number>()
  private selectedId: string | null = null
  private unsubscribe: () => void
  private time = 0
  private banner: HTMLDivElement | null = null

  constructor(
    private readonly player: TimelinePlayer,
    private readonly callbacks: SceneCallbacks,
    overlayParent: HTMLElement,
  ) {
    this.world = buildWorld()
    this.scene.add(this.world.group)
    this.overlay = new Overlay(overlayParent)
    this.unsubscribe = player.subscribe({
      onApply: (e, state) => this.apply(e, state),
      onSnap: (state) => this.snap(state),
    })
    this.snap(player.state)
  }

  dispose() {
    this.unsubscribe()
    for (const c of this.characters.values()) c.dispose()
    this.overlay.root.remove()
  }

  get characterRoots(): THREE.Object3D[] {
    return [...this.characters.values()].map((c) => c.root)
  }

  select(id: string | null) {
    this.selectedId = id
    for (const [cid, c] of this.characters) {
      c.setSelected(cid === id)
      this.overlay.get(`tag:${cid}`)?.classList.toggle('selected', cid === id)
    }
    this.callbacks.onSelect(id)
  }

  private hoverId: string | null = null
  setHover(id: string | null) {
    if (id === this.hoverId) return
    if (this.hoverId) this.overlay.get(`tag:${this.hoverId}`)?.classList.remove('hover')
    this.hoverId = id
    if (id) this.overlay.get(`tag:${id}`)?.classList.add('hover')
  }

  private speed(): number {
    if (this.player.mode === 'step') return 3
    if (this.player.mode.startsWith('live')) return 1
    return Math.max(0.5, this.player.options.speed)
  }
  private ttl(ms: number) {
    if (this.player.mode === 'step') return Math.max(ms, 45_000)
    return ms / this.speed()
  }

  // ---------- spots ----------

  private customerSpot(c: CustomerView, station: Station): Spot {
    if (station === 'waiting') {
      let idx = this.waitingSlot.get(c.customerId)
      if (idx === undefined) {
        const used = new Set(this.waitingSlot.values())
        idx = WAITING_SLOTS.findIndex((_, i) => !used.has(i))
        if (idx < 0) idx = 0
        this.waitingSlot.set(c.customerId, idx)
      }
      return WAITING_SLOTS[idx] ?? CUSTOMER_SPOTS.door
    }
    this.waitingSlot.delete(c.customerId)
    if (station === 'pickup') {
      let idx = this.pickupSlot.get(c.customerId)
      if (idx === undefined) {
        const used = new Set(this.pickupSlot.values())
        idx = PICKUP_SLOTS.findIndex((_, i) => !used.has(i))
        if (idx < 0) idx = 0
        this.pickupSlot.set(c.customerId, idx)
      }
      return PICKUP_SLOTS[idx] ?? CUSTOMER_SPOTS.pickup
    }
    this.pickupSlot.delete(c.customerId)
    return CUSTOMER_SPOTS[station]
  }

  private ensureAgent(a: AgentView): Character {
    let ch = this.characters.get(a.agentId)
    if (!ch) {
      ch = new Character(a.agentId, a.name, a.sprite, STAFF_SPOTS[a.station], true)
      this.scene.add(ch.root)
      this.characters.set(a.agentId, ch)
      this.overlay.set(
        `tag:${a.agentId}`,
        Overlay.tag(firstName(a.name)),
        () => this.feet(ch as Character),
        {
          dy: a.role === 'barista' ? -10 : 6,
          origin: 'top',
        },
      )
      this.overlay.get(`tag:${a.agentId}`)?.classList.add('staff')
    }
    return ch
  }
  private ensureCustomer(c: CustomerView, at: Spot): Character {
    let ch = this.characters.get(c.customerId)
    if (!ch) {
      ch = new Character(c.customerId, c.name, c.sprite, at, false)
      this.scene.add(ch.root)
      this.characters.set(c.customerId, ch)
      this.overlay.set(
        `tag:${c.customerId}`,
        Overlay.tag(firstName(c.name)),
        () => this.feet(ch as Character),
        { dy: 6, origin: 'top' },
      )
    }
    return ch
  }
  private ensureJudge() {
    if (this.characters.has('judge-1')) return
    const ch = new Character('judge-1', 'Inspector Wren', 'judge', STAFF_SPOTS.judge_table, true)
    this.scene.add(ch.root)
    this.characters.set('judge-1', ch)
    this.overlay.set('tag:judge-1', Overlay.tag('Inspector Wren'), () => this.feet(ch), {
      dy: 6,
      origin: 'top',
    })
    this.overlay.get('tag:judge-1')?.classList.add('staff')
  }

  private head(ch: Character): THREE.Vector3 {
    return ch.headAnchor.getWorldPosition(new THREE.Vector3())
  }
  private feet(ch: Character): THREE.Vector3 {
    return ch.root.position.clone()
  }

  private removeCharacter(id: string) {
    const ch = this.characters.get(id)
    if (!ch) return
    ch.dispose()
    this.characters.delete(id)
    this.overlay.removeByPrefix(`tag:${id}`)
    this.overlay.removeByPrefix(`bubble:${id}`)
    this.overlay.removeByPrefix(`ring:${id}`)
    this.overlay.removeByPrefix(`alert:${id}`)
    this.rings.delete(id)
  }

  // ---------- bubbles & alerts ----------

  private say(id: string, text: string, kind: BubbleKind, ttlMs: number) {
    const ch = this.characters.get(id)
    if (!ch) return
    const el = Overlay.bubble(text, kind)
    // neighbours behind the counter stand one tile apart: stagger odd columns
    const lift = ch.tile.x % 2 === 1 ? -26 : 0
    this.overlay.set(`bubble:${id}`, el, () => this.head(ch), { dy: -14 + lift, origin: 'bottom' })
    this.bubbleExpiry.set(id, this.time + ttlMs / 1000)
  }
  private clearBubble(id: string) {
    this.overlay.remove(`bubble:${id}`)
    this.bubbleExpiry.delete(id)
  }
  private showAlert(id: string) {
    const ch = this.characters.get(id)
    if (!ch || this.overlay.get(`alert:${id}`)) return
    this.overlay.set(
      `alert:${id}`,
      Overlay.alert(() => this.select(id)),
      () => this.head(ch),
      { dx: 22, dy: -30, origin: 'center' },
    )
  }
  private clearAlert(id: string) {
    this.overlay.remove(`alert:${id}`)
  }

  private showBanner(text: string | null) {
    this.banner?.remove()
    this.banner = null
    if (!text) return
    this.banner = Overlay.banner(text)
    this.overlay.root.appendChild(this.banner)
  }

  // ---------- tickets ----------

  private ticketPos(index: number): THREE.Vector3 {
    const r = this.world.rail
    return new THREE.Vector3(
      r.x + 0.55 + (index % 4) * 1.1,
      r.y - 0.25 - Math.floor(index / 4) * 0.64,
      r.z,
    )
  }

  private addTicket(orderId: string, name: string, requeued: boolean) {
    const existing = this.tickets.get(orderId)
    if (existing) {
      existing.mesh.material = glowPaper(requeued ? '#ffc9c2' : '#f6efdd')
      return
    }
    const mesh = ticketCard()
    if (requeued) mesh.material = glowPaper('#ffc9c2')
    const r = this.world.rail
    mesh.position.set(r.x + r.length + 0.6, r.y - 0.25, r.z)
    this.scene.add(mesh)
    const t: Ticket = { mesh, orderId, target: this.ticketPos(0), bounce: false, dying: false }
    this.tickets.set(orderId, t)
    const label = document.createElement('div')
    label.className = 'ov-ticket'
    label.textContent = name.split(' ')[0]?.slice(0, 7) ?? ''
    this.overlay.set(`ticket:${orderId}`, label, () => mesh.position.clone(), { origin: 'center' })
  }

  private layoutTickets(state: CafeState) {
    state.queue.forEach((orderId, i) => {
      const t = this.tickets.get(orderId)
      if (t) t.target = this.ticketPos(i)
    })
  }

  private removeTicket(orderId: string) {
    const t = this.tickets.get(orderId)
    if (!t) return
    this.tickets.delete(orderId)
    t.mesh.removeFromParent()
    this.overlay.remove(`ticket:${orderId}`)
  }

  private tween(
    obj: THREE.Object3D,
    to: THREE.Vector3,
    durMs: number,
    onDone?: () => void,
    scaleTo?: number,
  ) {
    const tw: Tween = {
      obj,
      from: obj.position.clone(),
      to,
      t: 0,
      dur: durMs / 1000,
      onDone,
      scaleTo,
    }
    this.tweens.push(tw)
  }

  // ---------- event animation ----------

  private apply(e: CafeEvent, state: CafeState) {
    const speed = this.speed()
    switch (e.type) {
      case 'agent.spawned': {
        const a = state.agents[e.agentId]
        if (a) this.ensureAgent(a)
        break
      }
      case 'agent.moved': {
        const ch = this.characters.get(e.agentId)
        if (ch) void ch.moveTo(STAFF_SPOTS[e.to], STAFF_LANE_ROW, speed)
        break
      }
      case 'agent.thinking': {
        if (e.step === 1) this.clearAlert(e.agentId)
        this.say(e.agentId, '. . .', 'thought', this.ttl(1400))
        break
      }
      case 'agent.tool_called':
        this.say(e.agentId, `⚙ ${e.tool}`, 'tool', this.ttl(6000))
        break
      case 'agent.tool_returned':
        if (!e.ok)
          this.say(
            e.agentId,
            `✗ ${e.tool}: ${(e.error ?? 'failed').slice(0, 70)}`,
            'shout',
            this.ttl(2200),
          )
        break
      case 'agent.scope_violation':
        this.say(e.agentId, `⛔ not my job: ${e.tool}`, 'shout', this.ttl(2600))
        break
      case 'agent.spoke':
        this.say(e.agentId, e.text, 'speech', this.ttl(2200 + e.text.length * 35))
        break
      case 'agent.error':
        this.showAlert(e.agentId)
        this.say(e.agentId, `! ${e.kind}: ${e.message.slice(0, 80)}`, 'shout', this.ttl(3500))
        break
      case 'customer.arrived': {
        const c = state.customers[e.customerId]
        if (!c) break
        const ch = this.ensureCustomer(c, CUSTOMER_SPOTS.offscreen)
        void ch.moveTo(CUSTOMER_SPOTS.door, CUSTOMER_AISLE_ROW, speed)
        break
      }
      case 'customer.moved': {
        const c = state.customers[e.customerId]
        const ch = this.characters.get(e.customerId)
        if (c && ch) void ch.moveTo(this.customerSpot(c, e.to), CUSTOMER_AISLE_ROW, speed)
        break
      }
      case 'customer.spoke':
        this.say(e.customerId, e.text, 'speech', this.ttl(2500 + e.text.length * 35))
        break
      case 'customer.left': {
        const ch = this.characters.get(e.customerId)
        this.waitingSlot.delete(e.customerId)
        this.pickupSlot.delete(e.customerId)
        if (ch) {
          const line =
            e.outcome === 'served'
              ? '☕ thanks!'
              : e.outcome === 'refused'
                ? '…fine.'
                : e.outcome === 'failed'
                  ? '✗ no drink?!'
                  : '…'
          this.say(e.customerId, line, e.outcome === 'served' ? 'speech' : 'shout', this.ttl(1800))
          void ch.moveTo(CUSTOMER_SPOTS.door, CUSTOMER_AISLE_ROW, speed).then(() =>
            ch.moveTo(CUSTOMER_SPOTS.offscreen, CUSTOMER_AISLE_ROW, speed).then(() => {
              if (this.characters.get(e.customerId) === ch) this.removeCharacter(e.customerId)
            }),
          )
        }
        break
      }
      case 'triage.decided':
        this.say(
          'manager-1',
          e.intent === 'adversarial'
            ? `⚠ ${e.intent} (${Math.round(e.escalateProbability * 100)}%)`
            : `triage: ${e.intent}`,
          'thought',
          this.ttl(2000),
        )
        break
      case 'order.queued':
      case 'order.requeued': {
        const o = state.orders[e.orderId]
        if (o) this.addTicket(o.orderId, o.customerName, e.type === 'order.requeued')
        this.layoutTickets(state)
        break
      }
      case 'order.claimed': {
        const t = this.tickets.get(e.orderId)
        const barista = this.characters.get(e.baristaId)
        if (t) {
          t.dying = true
          this.overlay.remove(`ticket:${e.orderId}`)
          const target = barista
            ? this.head(barista).add(new THREE.Vector3(0, 0.3, 0))
            : t.mesh.position.clone().add(new THREE.Vector3(0, 1, 0))
          this.tween(t.mesh, target, 500 / speed, () => this.removeTicket(e.orderId), 0.4)
        }
        this.layoutTickets(state)
        if (barista)
          this.say(
            e.baristaId,
            `ticket: ${state.orders[e.orderId]?.customerName ?? ''}`,
            'thought',
            this.ttl(1600),
          )
        break
      }
      case 'order.ready':
        this.say(e.baristaId, '☕ ready', 'thought', this.ttl(1500))
        break
      case 'order.called_out':
        this.say(e.baristaId, `${e.customerName.toUpperCase()}!`, 'shout', this.ttl(2600))
        break
      case 'order.delivered': {
        const o = state.orders[e.orderId]
        if (o) this.say(o.customerId, '☕', 'speech', this.ttl(1500))
        break
      }
      case 'order.failed': {
        const t = this.tickets.get(e.orderId)
        if (t) {
          t.dying = true
          t.mesh.material = glowPaper('#ff8a7a')
          this.overlay.remove(`ticket:${e.orderId}`)
          this.tween(
            t.mesh,
            t.mesh.position.clone().add(new THREE.Vector3(0, -1.2, 0.3)),
            700 / speed,
            () => this.removeTicket(e.orderId),
            0.2,
          )
        }
        this.layoutTickets(state)
        const o = state.orders[e.orderId]
        if (o) this.say(o.customerId, `✗ ${e.reason.slice(0, 70)}`, 'shout', this.ttl(3000))
        break
      }
      case 'order.refused':
        this.say(e.cashierId, `✋ ${e.reason.slice(0, 70)}`, 'shout', this.ttl(3000))
        break
      case 'judge.verdict': {
        const ok = e.answers.correct.probability >= 0.5
        this.say(
          'judge-1',
          `${ok ? '✓' : '✗'} correct ${Math.round(e.answers.correct.probability * 100)}% · help ${e.answers.helpfulness.score}/5 · tone ${e.answers.tone.score}/5`,
          ok ? 'speech' : 'shout',
          this.ttl(3200),
        )
        break
      }
      case 'run.started':
        this.showBanner(null)
        this.ensureJudge()
        break
      case 'run.finished':
        this.showBanner(
          `Shift over · ${e.summary.succeeded}/${e.summary.transactions} passed · $${e.summary.costUsd.toFixed(4)}`,
        )
        break
      default:
        break
    }
  }

  // ---------- rebuild from state (seek) ----------

  private snap(state: CafeState) {
    for (const id of [...this.characters.keys()]) this.removeCharacter(id)
    for (const id of [...this.tickets.keys()]) this.removeTicket(id)
    this.tweens = []
    this.waitingSlot.clear()
    this.pickupSlot.clear()
    this.bubbleExpiry.clear()
    this.showBanner(null)
    for (const a of Object.values(state.agents)) {
      const ch = this.ensureAgent(a)
      ch.snapTo(STAFF_SPOTS[a.station])
      if (a.error) this.showAlert(a.agentId)
    }
    if (state.status !== 'idle') this.ensureJudge()
    for (const c of Object.values(state.customers)) {
      if (c.leftAt !== null || c.station === 'offscreen') continue
      const spot = this.customerSpot(c, c.station)
      this.ensureCustomer(c, spot).snapTo(spot)
    }
    state.queue.forEach((id, i) => {
      const o = state.orders[id]
      if (!o) return
      this.addTicket(id, o.customerName, o.requeues > 0)
      const t = this.tickets.get(id)
      if (t) {
        t.target = this.ticketPos(i)
        t.mesh.position.copy(t.target)
      }
    })
    if (state.status === 'finished' && state.summary) {
      this.showBanner(
        `Shift over · ${state.summary.succeeded}/${state.summary.transactions} passed · $${state.costUsd.toFixed(4)}`,
      )
    }
    if (this.selectedId && !this.characters.has(this.selectedId)) this.select(null)
    else if (this.selectedId) this.characters.get(this.selectedId)?.setSelected(true)
  }

  // ---------- per frame ----------

  update(dt: number, now: number) {
    this.player.tick(now)
    this.time += dt
    const state = this.player.state
    const clock = this.player.clockEpoch()
    // Relative simulation seconds retain shader precision even for epoch timestamps.
    const sceneSeconds = (clock - (this.player.events[0]?.t ?? clock)) / 1000
    this.world.update(dt, sceneSeconds)
    updateFlicker(sceneSeconds)

    for (const ch of this.characters.values()) ch.update(dt)

    // bubbles expire on scene time
    for (const [id, exp] of this.bubbleExpiry) if (this.time > exp) this.clearBubble(id)

    // progress rings
    for (const a of Object.values(state.agents)) {
      const ch = this.characters.get(a.agentId)
      if (!ch) continue
      if (a.busy && a.workStartedAt !== null) {
        let ring = this.rings.get(a.agentId)
        if (!ring) {
          ring = Overlay.ring()
          this.rings.set(a.agentId, ring)
          this.overlay.set(`ring:${a.agentId}`, ring.el, () => this.head(ch), {
            dx: -30,
            dy: -18,
            origin: 'center',
          })
        }
        const elapsed = Math.max(0, clock - a.workStartedAt)
        const expected = median(a.workDurations) ?? EXPECTED_WORK_MS[a.role] ?? 8000
        ring.set(elapsed / expected, `${(elapsed / 1000).toFixed(1)}s`)
      } else if (this.rings.has(a.agentId)) {
        this.overlay.remove(`ring:${a.agentId}`)
        this.rings.delete(a.agentId)
      }
    }

    // steam over machines with a working barista
    const busyStations = new Set(
      Object.values(state.agents)
        .filter((a) => a.role === 'barista' && a.busy)
        .map((a) => a.station),
    )
    for (const [station, s] of Object.entries(this.world.steam))
      if (s) s.active = busyStations.has(station as Station)

    // tickets: ease to slot, age colour, bounce the front one when a barista is free
    const anyBaristaFree = Object.values(state.agents).some((a) => a.role === 'barista' && !a.busy)
    state.queue.forEach((orderId, i) => {
      const t = this.tickets.get(orderId)
      const o = state.orders[orderId]
      if (!t || !o || t.dying) return
      const waited = o.queuedAt ? clock - o.queuedAt : 0
      const color =
        o.requeues > 0
          ? '#ffc9c2'
          : waited > 30_000
            ? '#ff9f92'
            : waited > 10_000
              ? '#ffe1a6'
              : '#f6efdd'
      t.mesh.material = glowPaper(color)
      const label = this.overlay.get(`ticket:${orderId}`)
      if (label) label.dataset.age = waited > 30_000 ? 'hot' : waited > 10_000 ? 'warm' : 'fresh'
      const target = t.target.clone()
      if (i === 0 && anyBaristaFree) target.y += Math.abs(Math.sin(this.time * 6)) * 0.12
      t.mesh.position.lerp(target, Math.min(1, dt * 8))
    })

    // tweens
    for (const tw of this.tweens) {
      tw.t = Math.min(tw.dur, tw.t + dt)
      const k = easeInCubic(tw.t / tw.dur)
      tw.obj.position.lerpVectors(tw.from, tw.to, k)
      if (tw.scaleTo !== undefined) tw.obj.scale.setScalar(1 + (tw.scaleTo - 1) * k)
    }
    const done = this.tweens.filter((tw) => tw.t >= tw.dur)
    this.tweens = this.tweens.filter((tw) => tw.t < tw.dur)
    for (const tw of done) tw.onDone?.()
  }
}

const paperCache = new Map<string, THREE.MeshToonMaterial>()
function glowPaper(color: string): THREE.MeshToonMaterial {
  let m = paperCache.get(color)
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: new THREE.Color(color) })
    paperCache.set(color, m)
  }
  return m
}

const easeInCubic = (x: number) => x * x * x
const firstName = (name: string) => name.split(' ')[0] ?? name

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? null
}
