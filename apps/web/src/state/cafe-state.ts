import type { CafeEvent, JudgeAnswers, OrderItem, Role, RunConfig, Station } from '@cafe/protocol'

/**
 * A pure reducer from the event stream to what the scene and panels need to
 * render. It knows nothing about time or animation; the TimelinePlayer decides
 * *when* each event is applied, so the same reducer serves live, replay, step,
 * and director's cut.
 */
export interface ToolCallView {
  callId: string
  tool: string
  args: Record<string, unknown>
  at: number
  ok?: boolean | undefined
  latencyMs?: number | undefined
  result?: unknown
  error?: string | undefined
}

export interface AgentView {
  agentId: string
  role: Exclude<Role, 'customer'>
  name: string
  sprite: string
  modelSpec: string
  station: Station
  busy: boolean
  step: number
  /** Tool currently executing (thought bubble). */
  currentTool: string | null
  lastSpoke: { text: string; at: number } | null
  error: { kind: string; message: string; at: number } | null
  scopeViolations: number
  toolCalls: ToolCallView[]
  usage: { inputTokens: number; outputTokens: number; costUsd: number; calls: number }
  /** Model latency per step, for the inspector. */
  stepLatencies: number[]
  /** When the current piece of work started (for the progress ring). */
  workStartedAt: number | null
  /** Durations of completed work items, for the ring's expected time. */
  workDurations: number[]
  currentTxId: string | null
}

export interface CustomerView {
  customerId: string
  txId: string
  name: string
  sprite: string
  scenarioId: string
  station: Station
  utterance: string
  lastSpoke: { text: string; at: number } | null
  arrivedAt: number
  leftAt: number | null
  outcome: 'served' | 'refused' | 'abandoned' | 'failed' | null
  orderId: string | null
  triage: { intent: string; escalate: boolean; probability: number } | null
}

export interface OrderView {
  orderId: string
  txId: string
  customerId: string
  customerName: string
  items: OrderItem[]
  totalCents: number
  status: 'open' | 'paid' | 'queued' | 'claimed' | 'ready' | 'delivered' | 'failed'
  cashierId: string
  baristaId: string | null
  createdAt: number
  queuedAt: number | null
  claimedAt: number | null
  readyAt: number | null
  deliveredAt: number | null
  failReason: string | null
  requeues: number
}

export interface CafeState {
  runId: string | null
  status: 'idle' | 'running' | 'finished' | 'failed'
  config: RunConfig | null
  /** Virtual clock: the timestamp of the last applied event. */
  clock: number
  startedAt: number | null
  agents: Record<string, AgentView>
  customers: Record<string, CustomerView>
  orders: Record<string, OrderView>
  /** Order ids on the rail, FIFO. */
  queue: string[]
  verdicts: Record<
    string,
    { answers: JudgeAnswers; judgeSpec: string; latencyMs: number; at: number }
  >
  costUsd: number
  applied: CafeEvent[]
  lastEvent: CafeEvent | null
  summary: { transactions: number; succeeded: number; failed: number } | null
}

export const initialState = (): CafeState => ({
  runId: null,
  status: 'idle',
  config: null,
  clock: 0,
  startedAt: null,
  agents: {},
  customers: {},
  orders: {},
  queue: [],
  verdicts: {},
  costUsd: 0,
  applied: [],
  lastEvent: null,
  summary: null,
})

/** Apply one event. Mutates a shallow copy; callers treat the result as immutable. */
export function reduce(prev: CafeState, e: CafeEvent): CafeState {
  const s: CafeState = {
    ...prev,
    clock: e.t,
    lastEvent: e,
    applied: [...prev.applied, e],
    runId: e.runId,
  }
  const agents = { ...s.agents }
  const customers = { ...s.customers }
  const orders = { ...s.orders }
  s.agents = agents
  s.customers = customers
  s.orders = orders

  const agent = (id: string): AgentView | undefined => {
    const a = agents[id]
    if (!a) return undefined
    const copy = { ...a }
    agents[id] = copy
    return copy
  }
  const order = (id: string): OrderView | undefined => {
    const o = orders[id]
    if (!o) return undefined
    const copy = { ...o }
    orders[id] = copy
    return copy
  }

  switch (e.type) {
    case 'run.started':
      s.status = 'running'
      s.config = e.config
      s.startedAt = e.t
      break
    case 'run.finished':
      s.status = 'finished'
      s.summary = e.summary
      break
    case 'run.failed':
      s.status = 'failed'
      break

    case 'agent.spawned':
      agents[e.agentId] = {
        agentId: e.agentId,
        role: e.role as AgentView['role'],
        name: e.name,
        sprite: e.sprite,
        modelSpec: e.modelSpec,
        station: e.station,
        busy: false,
        step: 0,
        currentTool: null,
        lastSpoke: null,
        error: null,
        scopeViolations: 0,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 },
        stepLatencies: [],
        workStartedAt: null,
        workDurations: [],
        currentTxId: null,
      }
      break
    case 'agent.moved': {
      const a = agent(e.agentId)
      if (a) a.station = e.to
      break
    }
    case 'agent.thinking': {
      const a = agent(e.agentId)
      if (a) {
        // Step 1 always opens a new piece of work: a cashier handed straight to the next
        // customer never goes idle in between, so we cannot rely on agent.idle alone.
        if (!a.busy || e.step === 1) {
          if (a.busy && a.workStartedAt !== null)
            a.workDurations = [...a.workDurations, e.t - a.workStartedAt]
          a.busy = true
          a.workStartedAt = e.t
          a.error = null
          a.toolCalls = []
          a.stepLatencies = []
          a.currentTxId = e.txId ?? null
        }
        a.step = e.step
        a.currentTool = null
      }
      break
    }
    case 'agent.tool_called': {
      const a = agent(e.agentId)
      if (a) {
        a.currentTool = e.tool
        a.toolCalls = [...a.toolCalls, { callId: e.callId, tool: e.tool, args: e.args, at: e.t }]
      }
      break
    }
    case 'agent.tool_returned': {
      const a = agent(e.agentId)
      if (a) {
        a.currentTool = null
        a.toolCalls = a.toolCalls.map((c) =>
          c.callId === e.callId
            ? { ...c, ok: e.ok, latencyMs: e.latencyMs, result: e.result, error: e.error }
            : c,
        )
      }
      break
    }
    case 'agent.scope_violation': {
      const a = agent(e.agentId)
      if (a) a.scopeViolations += 1
      break
    }
    case 'agent.spoke': {
      const a = agent(e.agentId)
      if (a) a.lastSpoke = { text: e.text, at: e.t }
      break
    }
    case 'agent.error': {
      const a = agent(e.agentId)
      if (a) {
        a.error = { kind: e.kind, message: e.message, at: e.t }
        a.currentTool = null
      }
      break
    }
    case 'agent.idle': {
      const a = agent(e.agentId)
      if (a) {
        if (a.busy && a.workStartedAt !== null)
          a.workDurations = [...a.workDurations, e.t - a.workStartedAt]
        a.busy = false
        a.currentTool = null
        a.workStartedAt = null
        a.currentTxId = null
      }
      break
    }
    case 'model.usage': {
      const a = agent(e.agentId)
      if (a) {
        a.usage = {
          inputTokens: a.usage.inputTokens + e.inputTokens,
          outputTokens: a.usage.outputTokens + e.outputTokens,
          costUsd: a.usage.costUsd + e.costUsd,
          calls: a.usage.calls + 1,
        }
        a.stepLatencies = [...a.stepLatencies, e.latencyMs]
      }
      s.costUsd += e.costUsd
      break
    }

    case 'customer.arrived':
      customers[e.customerId] = {
        customerId: e.customerId,
        txId: e.txId ?? e.customerId,
        name: e.name,
        sprite: e.sprite,
        scenarioId: e.scenarioId,
        station: 'door',
        utterance: e.utterance,
        lastSpoke: null,
        arrivedAt: e.t,
        leftAt: null,
        outcome: null,
        orderId: null,
        triage: null,
      }
      break
    case 'customer.moved': {
      const c = customers[e.customerId]
      if (c) customers[e.customerId] = { ...c, station: e.to }
      break
    }
    case 'customer.spoke': {
      const c = customers[e.customerId]
      if (c) customers[e.customerId] = { ...c, lastSpoke: { text: e.text, at: e.t } }
      break
    }
    case 'customer.left': {
      const c = customers[e.customerId]
      if (c)
        customers[e.customerId] = { ...c, outcome: e.outcome, leftAt: e.t, station: 'offscreen' }
      break
    }
    case 'triage.decided': {
      const c = customers[e.customerId]
      if (c)
        customers[e.customerId] = {
          ...c,
          triage: { intent: e.intent, escalate: e.escalate, probability: e.escalateProbability },
        }
      break
    }

    case 'order.created': {
      orders[e.orderId] = {
        orderId: e.orderId,
        txId: e.txId ?? '',
        customerId: e.customerId,
        customerName: customers[e.customerId]?.name ?? e.customerId,
        items: e.items,
        totalCents: e.totalCents,
        status: 'open',
        cashierId: e.cashierId,
        baristaId: null,
        createdAt: e.t,
        queuedAt: null,
        claimedAt: null,
        readyAt: null,
        deliveredAt: null,
        failReason: null,
        requeues: 0,
      }
      const c = customers[e.customerId]
      if (c) customers[e.customerId] = { ...c, orderId: e.orderId }
      break
    }
    case 'order.updated': {
      const o = order(e.orderId)
      if (o) {
        o.items = e.items
        o.totalCents = e.totalCents
      }
      break
    }
    case 'payment.charged': {
      const o = order(e.orderId)
      if (o) o.status = 'paid'
      break
    }
    case 'order.queued': {
      const o = order(e.orderId)
      if (o) {
        o.status = 'queued'
        o.queuedAt = e.t
      }
      s.queue = [...s.queue.filter((id) => id !== e.orderId), e.orderId]
      break
    }
    case 'order.claimed': {
      const o = order(e.orderId)
      if (o) {
        o.status = 'claimed'
        o.baristaId = e.baristaId
        o.claimedAt = e.t
      }
      s.queue = s.queue.filter((id) => id !== e.orderId)
      break
    }
    case 'order.requeued': {
      const o = order(e.orderId)
      if (o) {
        o.status = 'queued'
        o.baristaId = null
        o.claimedAt = null
        o.requeues += 1
        o.failReason = e.reason
      }
      // back to the front: it kept its original place in line
      s.queue = [e.orderId, ...s.queue.filter((id) => id !== e.orderId)]
      break
    }
    case 'order.ready': {
      const o = order(e.orderId)
      if (o) {
        o.status = 'ready'
        o.readyAt = e.t
      }
      break
    }
    case 'order.delivered': {
      const o = order(e.orderId)
      if (o) {
        o.status = 'delivered'
        o.deliveredAt = e.t
      }
      break
    }
    case 'order.failed': {
      const o = order(e.orderId)
      if (o) {
        o.status = 'failed'
        o.failReason = e.reason
      }
      s.queue = s.queue.filter((id) => id !== e.orderId)
      break
    }
    case 'order.refused': {
      const c = customers[e.customerId]
      if (c) customers[e.customerId] = { ...c, outcome: 'refused' }
      break
    }
    case 'judge.verdict':
      if (e.txId)
        s.verdicts = {
          ...s.verdicts,
          [e.txId]: { answers: e.answers, judgeSpec: e.judgeSpec, latencyMs: e.latencyMs, at: e.t },
        }
      break
    default:
      break
  }
  return s
}

export function reduceAll(events: CafeEvent[], from: CafeState = initialState()): CafeState {
  let s = from
  for (const e of events) s = reduce(s, e)
  return s
}
