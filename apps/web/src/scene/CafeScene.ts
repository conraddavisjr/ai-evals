import type { CafeEvent, Station } from '@cafe/protocol'
import Phaser from 'phaser'
import type { TimelinePlayer } from '../playback/TimelinePlayer.js'
import type { AgentView, CafeState, CustomerView } from '../state/cafe-state.js'
import { Actor } from './Actor.js'
import { proceduralSprites } from './art/textures.js'
import {
  buildMap,
  CUSTOMER_AISLE_ROW,
  CUSTOMER_SPOTS,
  PICKUP_SLOTS,
  pxX,
  S,
  type Spot,
  STAFF_LANE_ROW,
  STAFF_SPOTS,
  TILE,
  WAITING_SLOTS,
  worldH,
  worldW,
} from './layout.js'

export interface SceneCallbacks {
  onSelect: (id: string | null) => void
}

const EXPECTED_WORK_MS: Record<string, number> = {
  cashier: 12000,
  barista: 12000,
  manager: 3000,
  judge: 2000,
}
const FONT = '"Pixelify Sans", monospace'

interface Ticket {
  root: Phaser.GameObjects.Container
  paper: Phaser.GameObjects.Image
  orderId: string
  bounce: Phaser.Tweens.Tween | null
}

/**
 * The cafe. A pure consumer of TimelinePlayer callbacks: onApply animates one
 * event, onSnap rebuilds the picture from state. It never reads the network.
 */
export class CafeScene extends Phaser.Scene {
  private player!: TimelinePlayer
  private callbacks!: SceneCallbacks
  private actors = new Map<string, Actor>()
  private tickets = new Map<string, Ticket>()
  private waitingSlot = new Map<string, number>()
  private pickupSlot = new Map<string, number>()
  private steam: Phaser.GameObjects.Particles.ParticleEmitter[] = []
  private banner: Phaser.GameObjects.Text | null = null
  private railX = pxX(9) - (TILE * S) / 2
  private railY = 3 * TILE * S + 4
  private unsubscribe: (() => void) | null = null
  private selectedId: string | null = null

  constructor() {
    super('cafe')
  }

  init(data: { player: TimelinePlayer; callbacks: SceneCallbacks }) {
    this.player = data.player
    this.callbacks = data.callbacks
  }

  create() {
    const { ground, props } = buildMap()
    for (const p of ground) {
      const key = proceduralSprites.ensureTile(this, p.tile)
      this.add
        .image(p.x * TILE * S, p.y * TILE * S, key)
        .setOrigin(0, 0)
        .setScale(S)
        .setDepth(0)
    }
    for (const p of props) {
      const key = proceduralSprites.ensureTile(this, p.tile)
      this.add
        .image(p.x * TILE * S, (p.y + 1) * TILE * S, key)
        .setOrigin(0, 1)
        .setScale(S)
        .setDepth((p.y + 1) * TILE * S - 1 + (p.depthBias ?? 0))
    }
    proceduralSprites.ensureTile(this, 'ticket')
    proceduralSprites.ensureTile(this, 'alert')
    proceduralSprites.ensureTile(this, 'cup_icon')

    // the rail the tickets hang from
    const rail = this.add.graphics().setDepth(890)
    rail.lineStyle(3, 0x5f3b1b, 1)
    rail.lineBetween(this.railX - 6, this.railY, this.railX + 5 * TILE * S + 6, this.railY)
    this.add
      .text(this.railX - 4, this.railY - 14, 'TICKETS', {
        fontFamily: FONT,
        fontSize: '9px',
        color: '#fffaf0',
        stroke: '#2b1d16',
        strokeThickness: 3,
      })
      .setDepth(891)

    // steam emitters over both machines, off until a barista is working
    const smoke = this.textures.createCanvas('steam', 4, 4)
    if (smoke) {
      smoke.context.fillStyle = '#ffffff'
      smoke.context.fillRect(0, 0, 4, 4)
      smoke.refresh()
    }
    for (const mx of [4, 7]) {
      const em = this.add.particles(pxX(mx), 2 * TILE * S + 6, 'steam', {
        speedY: { min: -30, max: -55 },
        speedX: { min: -8, max: 8 },
        lifespan: 1400,
        alpha: { start: 0.7, end: 0 },
        scale: { start: 1.5, end: 3 },
        frequency: 140,
        quantity: 1,
        emitting: false,
      })
      em.setDepth(2 * TILE * S + 40)
      this.steam.push(em)
    }

    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length === 0) this.select(null)
    })

    this.unsubscribe = this.player.subscribe({
      onApply: (e, state) => this.apply(e, state),
      onSnap: (state) => this.snap(state),
    })
    this.snap(this.player.state)
    const off = () => {
      this.unsubscribe?.()
      this.unsubscribe = null
    }
    this.events.once('shutdown', off)
    this.events.once('destroy', off)
  }

  select(id: string | null) {
    this.selectedId = id
    for (const [aid, a] of this.actors) a.setSelected(aid === id)
    this.callbacks.onSelect(id)
  }

  private speed(): number {
    if (this.player.mode === 'step') return 3
    if (this.player.mode.startsWith('live')) return 1
    return Math.max(0.5, this.player.options.speed)
  }
  private ttl(ms: number) {
    // In step mode the picture is frozen between beats, so bubbles wait for the reader.
    if (this.player.mode === 'step') return Math.max(ms, 45_000)
    return ms / this.speed()
  }

  // ---------- spots ----------

  private staffSpot(station: Station): Spot {
    return STAFF_SPOTS[station]
  }
  private customerSpot(c: CustomerView, station: Station): Spot {
    if (station === 'waiting') {
      let idx = this.waitingSlot.get(c.customerId)
      if (idx === undefined) {
        const used = new Set(this.waitingSlot.values())
        idx = WAITING_SLOTS.findIndex((_, i) => !used.has(i))
        if (idx < 0) idx = 0
        this.waitingSlot.set(c.customerId, idx)
      }
      return WAITING_SLOTS[idx] ?? WAITING_SLOTS[0] ?? CUSTOMER_SPOTS.door
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

  private ensureAgent(a: AgentView): Actor {
    let actor = this.actors.get(a.agentId)
    if (!actor) {
      const key = proceduralSprites.ensureCharacter(this, a.sprite)
      actor = new Actor(
        this,
        a.agentId,
        key,
        a.name,
        this.staffSpot(a.station),
        (id) => this.select(id),
        false,
      )
      this.actors.set(a.agentId, actor)
    }
    return actor
  }
  private ensureCustomer(c: CustomerView, at: Spot): Actor {
    let actor = this.actors.get(c.customerId)
    if (!actor) {
      const key = proceduralSprites.ensureCharacter(this, c.sprite)
      actor = new Actor(this, c.customerId, key, c.name, at, (id) => this.select(id))
      this.actors.set(c.customerId, actor)
    }
    return actor
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
        const actor = this.actors.get(e.agentId)
        if (actor) void actor.moveTo(this.staffSpot(e.to), STAFF_LANE_ROW, speed)
        break
      }
      case 'agent.thinking': {
        const actor = this.actors.get(e.agentId)
        if (actor) {
          if (e.step === 1) actor.clearAlert()
          actor.say('. . .', 'thought', this.ttl(1400))
        }
        break
      }
      case 'agent.tool_called': {
        const actor = this.actors.get(e.agentId)
        if (actor) actor.say(`⚙ ${e.tool}`, 'tool', this.ttl(6000))
        break
      }
      case 'agent.tool_returned': {
        const actor = this.actors.get(e.agentId)
        if (actor && !e.ok)
          actor.say(`✗ ${e.tool}\n${(e.error ?? 'failed').slice(0, 60)}`, 'shout', this.ttl(2200))
        break
      }
      case 'agent.scope_violation': {
        const actor = this.actors.get(e.agentId)
        if (actor) actor.say(`⛔ not my job: ${e.tool}`, 'shout', this.ttl(2600))
        break
      }
      case 'agent.spoke': {
        const actor = this.actors.get(e.agentId)
        if (actor) actor.say(e.text, 'speech', this.ttl(2200 + e.text.length * 35))
        break
      }
      case 'agent.error': {
        const actor = this.actors.get(e.agentId)
        if (actor) {
          actor.showAlert()
          actor.say(`! ${e.kind}: ${e.message.slice(0, 70)}`, 'shout', this.ttl(3500))
        }
        break
      }
      case 'customer.arrived': {
        const c = state.customers[e.customerId]
        if (!c) break
        const actor = this.ensureCustomer(c, CUSTOMER_SPOTS.offscreen)
        void actor.moveTo(CUSTOMER_SPOTS.door, CUSTOMER_AISLE_ROW, speed)
        break
      }
      case 'customer.moved': {
        const c = state.customers[e.customerId]
        const actor = this.actors.get(e.customerId)
        if (c && actor) void actor.moveTo(this.customerSpot(c, e.to), CUSTOMER_AISLE_ROW, speed)
        break
      }
      case 'customer.spoke': {
        const actor = this.actors.get(e.customerId)
        if (actor) actor.say(e.text, 'speech', this.ttl(2500 + e.text.length * 35))
        break
      }
      case 'customer.left': {
        const actor = this.actors.get(e.customerId)
        this.waitingSlot.delete(e.customerId)
        this.pickupSlot.delete(e.customerId)
        if (actor) {
          const face =
            e.outcome === 'served'
              ? '☕ thanks!'
              : e.outcome === 'refused'
                ? '…fine.'
                : e.outcome === 'failed'
                  ? '✗ no drink?!'
                  : '…'
          actor.say(face, e.outcome === 'served' ? 'speech' : 'shout', this.ttl(1800))
          void actor.moveTo(CUSTOMER_SPOTS.door, CUSTOMER_AISLE_ROW, speed).then(() =>
            actor.moveTo(CUSTOMER_SPOTS.offscreen, CUSTOMER_AISLE_ROW, speed).then(() => {
              actor.destroy()
              if (this.actors.get(e.customerId) === actor) this.actors.delete(e.customerId)
            }),
          )
        }
        break
      }
      case 'triage.decided': {
        const manager = [...this.actors.values()].find((a) => a.id.startsWith('manager'))
        if (manager)
          manager.say(
            e.intent === 'adversarial'
              ? `⚠ ${e.intent} (${Math.round(e.escalateProbability * 100)}%)`
              : `triage: ${e.intent}`,
            'thought',
            this.ttl(2000),
          )
        break
      }
      case 'order.queued':
      case 'order.requeued': {
        const o = state.orders[e.orderId]
        if (o) this.addTicket(o.orderId, o.customerName, e.type === 'order.requeued')
        this.layoutTickets(state)
        break
      }
      case 'order.claimed': {
        const t = this.tickets.get(e.orderId)
        const barista = this.actors.get(e.baristaId)
        if (t) {
          this.tickets.delete(e.orderId)
          t.bounce?.destroy()
          const target = barista
            ? { x: barista.root.x, y: barista.root.y - 24 * S - 10 }
            : { x: t.root.x, y: t.root.y - 40 }
          this.tweens.add({
            targets: t.root,
            x: target.x,
            y: target.y,
            alpha: 0.2,
            scale: 0.6,
            duration: 500 / speed,
            ease: 'Cubic.easeIn',
            onComplete: () => t.root.destroy(true),
          })
        }
        this.layoutTickets(state)
        if (barista)
          barista.say(
            `ticket: ${state.orders[e.orderId]?.customerName ?? ''}`,
            'thought',
            this.ttl(1600),
          )
        break
      }
      case 'order.ready': {
        const barista = this.actors.get(e.baristaId)
        if (barista) barista.say('☕ ready', 'thought', this.ttl(1500))
        break
      }
      case 'order.called_out': {
        const barista = this.actors.get(e.baristaId)
        if (barista) barista.say(`${e.customerName.toUpperCase()}!`, 'shout', this.ttl(2600))
        break
      }
      case 'order.delivered': {
        const o = state.orders[e.orderId]
        const cust = o ? this.actors.get(o.customerId) : undefined
        if (cust) cust.say('☕', 'speech', this.ttl(1500))
        break
      }
      case 'order.failed': {
        const t = this.tickets.get(e.orderId)
        if (t) {
          this.tickets.delete(e.orderId)
          t.paper.setTint(0xd9412f)
          this.tweens.add({
            targets: t.root,
            alpha: 0,
            y: t.root.y + 20,
            duration: 600 / speed,
            onComplete: () => t.root.destroy(true),
          })
        }
        this.layoutTickets(state)
        const o = state.orders[e.orderId]
        const cust = o ? this.actors.get(o.customerId) : undefined
        if (cust) cust.say(`✗ ${e.reason.slice(0, 60)}`, 'shout', this.ttl(3000))
        break
      }
      case 'order.refused': {
        const cashier = this.actors.get(e.cashierId)
        if (cashier) cashier.say(`✋ ${e.reason.slice(0, 60)}`, 'shout', this.ttl(3000))
        break
      }
      case 'judge.verdict': {
        const judge = [...this.actors.values()].find((a) => a.id.startsWith('judge'))
        const ok = e.answers.correct.probability >= 0.5
        if (judge)
          judge.say(
            `${ok ? '✓' : '✗'} correct ${Math.round(e.answers.correct.probability * 100)}%  help ${e.answers.helpfulness.score}/5  tone ${e.answers.tone.score}/5`,
            ok ? 'speech' : 'shout',
            this.ttl(3200),
          )
        break
      }
      case 'run.started': {
        this.showBanner(null)
        this.ensureJudge()
        break
      }
      case 'run.finished': {
        this.showBanner(
          `Shift over · ${e.summary.succeeded}/${e.summary.transactions} passed · $${e.summary.costUsd.toFixed(4)}`,
        )
        break
      }
      default:
        break
    }
  }

  /** The judge is not an agent that acts, but they sit in the corner watching. */
  private ensureJudge() {
    if (this.actors.has('judge-1')) return
    const key = proceduralSprites.ensureCharacter(this, 'judge')
    const actor = new Actor(
      this,
      'judge-1',
      key,
      'Inspector Wren',
      STAFF_SPOTS.judge_table,
      (id) => this.select(id),
      false,
    )
    this.actors.set('judge-1', actor)
  }

  private showBanner(text: string | null) {
    this.banner?.destroy()
    this.banner = null
    if (!text) return
    this.banner = this.add
      .text(worldW() / 2, worldH() / 2 - 20, text, {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#fffaf0',
        stroke: '#2b1d16',
        strokeThickness: 6,
        backgroundColor: 'rgba(43,29,22,0.55)',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(3000)
  }

  // ---------- tickets ----------

  private addTicket(orderId: string, name: string, requeued: boolean) {
    const existing = this.tickets.get(orderId)
    if (existing) {
      existing.paper.setTint(requeued ? 0xffc9c2 : 0xffffff)
      return
    }
    const paper = this.add.image(0, 0, 'tile:ticket').setOrigin(0.5, 0).setScale(S)
    if (requeued) paper.setTint(0xffc9c2)
    const label = this.add
      .text(0, 8, name.split(' ')[0]?.slice(0, 6) ?? '', {
        fontFamily: FONT,
        fontSize: '9px',
        color: '#2b1d16',
      })
      .setOrigin(0.5, 0)
    const root = this.add
      .container(this.railX + 6 * TILE * S, this.railY, [paper, label])
      .setDepth(900)
    root.setAlpha(0)
    this.tweens.add({ targets: root, alpha: 1, duration: 200 })
    this.tickets.set(orderId, { root, paper, orderId, bounce: null })
  }

  private layoutTickets(state: CafeState) {
    const gap = 14 * S
    state.queue.forEach((orderId, i) => {
      const t = this.tickets.get(orderId)
      if (!t) return
      const x = this.railX + 8 + i * gap
      this.tweens.add({ targets: t.root, x, y: this.railY, duration: 250, ease: 'Cubic.easeOut' })
    })
  }

  // ---------- rebuild from state (seek) ----------

  private snap(state: CafeState) {
    for (const a of this.actors.values()) a.destroy()
    this.actors.clear()
    for (const t of this.tickets.values()) t.root.destroy(true)
    this.tickets.clear()
    this.waitingSlot.clear()
    this.pickupSlot.clear()
    this.showBanner(null)
    for (const a of Object.values(state.agents)) {
      const actor = this.ensureAgent(a)
      actor.snapTo(this.staffSpot(a.station))
      if (a.error) actor.showAlert()
    }
    if (state.status !== 'idle') this.ensureJudge()
    for (const c of Object.values(state.customers)) {
      if (c.leftAt !== null || c.station === 'offscreen') continue
      const spot = this.customerSpot(c, c.station)
      const actor = this.ensureCustomer(c, spot)
      actor.snapTo(spot)
    }
    for (const id of state.queue) {
      const o = state.orders[id]
      if (o) this.addTicket(id, o.customerName, o.requeues > 0)
    }
    this.layoutTickets(state)
    if (state.status === 'finished' && state.summary) {
      this.showBanner(
        `Shift over · ${state.summary.succeeded}/${state.summary.transactions} passed · $${state.costUsd.toFixed(4)}`,
      )
    }
    if (this.selectedId && !this.actors.has(this.selectedId)) this.select(null)
    else if (this.selectedId) this.actors.get(this.selectedId)?.setSelected(true)
  }

  // ---------- per frame ----------

  override update(time: number) {
    this.player.tick(time)
    const state = this.player.state
    const clock = this.player.clockEpoch()
    for (const actor of this.actors.values()) actor.update(time)

    // progress rings for working staff
    for (const a of Object.values(state.agents)) {
      const actor = this.actors.get(a.agentId)
      if (!actor) continue
      if (a.busy && a.workStartedAt !== null) {
        const elapsed = Math.max(0, clock - a.workStartedAt)
        const expected = median(a.workDurations) ?? EXPECTED_WORK_MS[a.role] ?? 8000
        actor.drawRing(elapsed / expected, `${(elapsed / 1000).toFixed(1)}s`)
      } else actor.drawRing(null, '')
    }

    // steam over machines with a working barista
    const busyStations = new Set(
      Object.values(state.agents)
        .filter((a) => a.role === 'barista' && a.busy)
        .map((a) => a.station),
    )
    this.steam[0]?.[busyStations.has('espresso_1') ? 'start' : 'stop']()
    this.steam[1]?.[busyStations.has('espresso_2') ? 'start' : 'stop']()

    // ticket ageing and the "someone is free" bounce
    const anyBaristaFree = Object.values(state.agents).some((a) => a.role === 'barista' && !a.busy)
    state.queue.forEach((orderId, i) => {
      const t = this.tickets.get(orderId)
      const o = state.orders[orderId]
      if (!t || !o) return
      const waited = o.queuedAt ? clock - o.queuedAt : 0
      const tint =
        o.requeues > 0
          ? 0xffc9c2
          : waited > 30_000
            ? 0xff9f92
            : waited > 10_000
              ? 0xffe1a6
              : 0xffffff
      t.paper.setTint(tint)
      if (i === 0 && anyBaristaFree && !t.bounce) {
        t.bounce = this.tweens.add({
          targets: t.root,
          y: this.railY - 6,
          duration: 260,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
      } else if ((i !== 0 || !anyBaristaFree) && t.bounce) {
        t.bounce.destroy()
        t.bounce = null
        t.root.y = this.railY
      }
    })
  }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? null
}
