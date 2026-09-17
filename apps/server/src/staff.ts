import { type AgentSpec, STAFF_NAMES, STAFF_SPRITES, SYSTEM_PROMPTS } from '@cafe/agents'
import type { StaffingService } from '@cafe/mcp-gateway'
import {
  ESPRESSO_MACHINES,
  REGISTERS,
  type RoleModels,
  type Staffing,
  type Station,
} from '@cafe/protocol'
import type { EventBus } from './event-bus.js'

export interface StaffMember {
  spec: AgentSpec
  busy: boolean
  station: Station
}

/** Who is on shift, where they stand, and whether they are free. */
export class StaffPool implements StaffingService {
  readonly members = new Map<string, StaffMember>()
  private waiters: Array<{ role: AgentSpec['role']; resolve: (m: StaffMember) => void }> = []
  private counters: Record<AgentSpec['role'], number> = { cashier: 0, barista: 0, manager: 0 }
  private onSpawn: ((m: StaffMember) => void) | null = null

  constructor(
    private readonly bus: EventBus,
    private readonly models: RoleModels,
  ) {}

  hire(staffing: Staffing): void {
    for (let i = 0; i < staffing.cashiers; i++) this.spawn('cashier')
    for (let i = 0; i < staffing.baristas; i++) this.spawn('barista')
    this.spawn('manager')
  }

  spawn(role: AgentSpec['role']): StaffMember {
    const n = this.counters[role]++
    const name = STAFF_NAMES[role][n % STAFF_NAMES[role].length] ?? role
    const sprite = STAFF_SPRITES[role][n % STAFF_SPRITES[role].length] ?? role
    const station: Station =
      role === 'cashier'
        ? (REGISTERS[n % REGISTERS.length] ?? 'register_1')
        : role === 'barista'
          ? (ESPRESSO_MACHINES[n % ESPRESSO_MACHINES.length] ?? 'espresso_1')
          : 'office'
    const spec: AgentSpec = {
      agentId: `${role}-${n + 1}`,
      role,
      name: n > 0 && STAFF_NAMES[role].length <= n ? `${name} ${n + 1}` : name,
      modelSpec: this.models[role],
      sprite,
      station,
      systemPrompt: SYSTEM_PROMPTS[role](name),
    }
    const member: StaffMember = { spec, busy: false, station }
    this.members.set(spec.agentId, member)
    this.bus.emit({
      type: 'agent.spawned',
      agentId: spec.agentId,
      role,
      name: spec.name,
      modelSpec: spec.modelSpec,
      station,
      sprite,
    })
    this.bus.emit({
      type: 'staffing.changed',
      cashiers: this.count('cashier'),
      baristas: this.count('barista'),
    })
    this.onSpawn?.(member)
    return member
  }

  count(role: AgentSpec['role']): number {
    return [...this.members.values()].filter((m) => m.spec.role === role).length
  }

  byRole(role: AgentSpec['role']): StaffMember[] {
    return [...this.members.values()].filter((m) => m.spec.role === role)
  }

  /** Borrow a free member of a role, waiting in FIFO order if everyone is busy. */
  acquire(role: AgentSpec['role']): Promise<StaffMember> {
    const free = this.byRole(role).find((m) => !m.busy)
    if (free) {
      free.busy = true
      return Promise.resolve(free)
    }
    return new Promise((resolve) => this.waiters.push({ role, resolve }))
  }

  release(member: StaffMember): void {
    const idx = this.waiters.findIndex((w) => w.role === member.spec.role)
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1)
      w?.resolve(member) // stays busy, handed straight to the next customer
      return
    }
    member.busy = false
    this.bus.emit({ type: 'agent.idle', agentId: member.spec.agentId, role: member.spec.role })
  }

  moveTo(member: StaffMember, station: Station, txId?: string): void {
    if (member.station === station) return
    member.station = station
    this.bus.emit({
      type: 'agent.moved',
      agentId: member.spec.agentId,
      role: member.spec.role,
      to: station,
      ...(txId ? { txId } : {}),
    })
  }

  // StaffingService (what the manager's tools see)
  list() {
    return [...this.members.values()].map((m) => ({
      agentId: m.spec.agentId,
      role: m.spec.role,
      station: m.station,
      busy: m.busy,
    }))
  }
  async spawnBarista() {
    const m = this.spawn('barista')
    return { agentId: m.spec.agentId }
  }
  whenSpawned(cb: (m: StaffMember) => void) {
    this.onSpawn = cb
  }
}
