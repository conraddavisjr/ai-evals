import { z } from 'zod'
import { OrderItem, Role, RunConfig, Station } from './domain.js'
import { ModelSpec } from './model-spec.js'

/**
 * Every subsystem emits CafeEvents. They are persisted per run, streamed over SSE,
 * replayed by the scene, and aggregated by the eval harness. The scene never sees
 * anything but this stream, which is what makes replay pixel-identical to live.
 */
const Base = z.object({
  /** ULID: sortable, unique. */
  id: z.string(),
  runId: z.string(),
  /** Monotonic per run; the authoritative ordering key. */
  seq: z.number().int().nonnegative(),
  /** Epoch ms when the event happened on the server. */
  t: z.number(),
  /** Transaction (one customer visit) this event belongs to, when applicable. */
  txId: z.string().optional(),
})

const AgentRef = z.object({ agentId: z.string(), role: Role })

export const AgentErrorKind = z.enum(['crash', 'budget', 'model', 'tool', 'timeout', 'scope'])
export type AgentErrorKind = z.infer<typeof AgentErrorKind>

export const TriageIntent = z.enum(['order', 'question', 'complaint', 'adversarial'])
export type TriageIntent = z.infer<typeof TriageIntent>

export const JudgeAnswers = z.object({
  correct: z.object({ probability: z.number().min(0).max(1) }),
  refusalAppropriate: z.object({ probability: z.number().min(0).max(1) }),
  helpfulness: z.object({ score: z.number().int().min(1).max(5) }),
  tone: z.object({ score: z.number().int().min(1).max(5) }),
  toolUseQuality: z.object({ score: z.number().int().min(1).max(5) }),
})
export type JudgeAnswers = z.infer<typeof JudgeAnswers>

/** The manager's post-visit verdict on how the staff handled a customer. */
export const ReviewVerdict = z.enum(['ok', 'concern', 'escalate'])
export type ReviewVerdict = z.infer<typeof ReviewVerdict>
export const ReviewIssue = z.enum([
  'wrong_result',
  'wasted_tool_calls',
  'scope_breach',
  'unrecovered_error',
  'poor_tone',
])
export type ReviewIssue = z.infer<typeof ReviewIssue>

export const CafeEvent = z.discriminatedUnion('type', [
  // run lifecycle
  Base.extend({ type: z.literal('run.started'), config: RunConfig }),
  Base.extend({
    type: z.literal('run.finished'),
    summary: z.object({
      transactions: z.number(),
      succeeded: z.number(),
      failed: z.number(),
      costUsd: z.number(),
    }),
  }),
  Base.extend({ type: z.literal('run.failed'), error: z.string() }),

  // customer (scripted in V1, an agent later; same events either way)
  Base.extend({
    type: z.literal('customer.arrived'),
    customerId: z.string(),
    name: z.string(),
    scenarioId: z.string(),
    sprite: z.string(),
    utterance: z.string(),
    /** The golden item's expectations, so a consumer of the stream alone can mark each step right or wrong. */
    expected: z
      .object({
        outcome: z.enum(['served', 'refused', 'failed']),
        cashierTools: z.array(z.string()),
        baristaTools: z.array(z.string()),
        tags: z.array(z.string()),
      })
      .optional(),
  }),
  Base.extend({ type: z.literal('customer.moved'), customerId: z.string(), to: Station }),
  Base.extend({ type: z.literal('customer.spoke'), customerId: z.string(), text: z.string() }),
  Base.extend({
    type: z.literal('customer.left'),
    customerId: z.string(),
    outcome: z.enum(['served', 'refused', 'abandoned', 'failed']),
  }),

  // door triage (manager's decision model: Jev or an LLM adapter)
  Base.extend({
    type: z.literal('triage.decided'),
    customerId: z.string(),
    intent: TriageIntent,
    escalate: z.boolean(),
    escalateProbability: z.number().min(0).max(1),
    modelSpec: ModelSpec,
    latencyMs: z.number(),
  }),

  // agents
  Base.extend(AgentRef.shape).extend({
    type: z.literal('agent.spawned'),
    name: z.string(),
    modelSpec: ModelSpec,
    station: Station,
    sprite: z.string(),
  }),
  Base.extend(AgentRef.shape).extend({ type: z.literal('agent.moved'), to: Station }),
  Base.extend(AgentRef.shape).extend({ type: z.literal('agent.thinking'), step: z.number().int() }),
  Base.extend(AgentRef.shape).extend({ type: z.literal('agent.spoke'), text: z.string() }),
  Base.extend(AgentRef.shape).extend({
    type: z.literal('agent.tool_called'),
    callId: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  Base.extend(AgentRef.shape).extend({
    type: z.literal('agent.tool_returned'),
    callId: z.string(),
    tool: z.string(),
    ok: z.boolean(),
    latencyMs: z.number(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  Base.extend(AgentRef.shape).extend({
    type: z.literal('agent.scope_violation'),
    tool: z.string(),
    allowedScopes: z.array(z.string()),
  }),
  Base.extend(AgentRef.shape).extend({
    type: z.literal('agent.error'),
    kind: AgentErrorKind,
    message: z.string(),
    retryable: z.boolean(),
  }),
  Base.extend(AgentRef.shape).extend({ type: z.literal('agent.idle') }),
  Base.extend(AgentRef.shape).extend({ type: z.literal('agent.retired') }),

  // orders and the queue
  Base.extend({
    type: z.literal('order.created'),
    orderId: z.string(),
    customerId: z.string(),
    cashierId: z.string(),
    items: z.array(OrderItem),
    totalCents: z.number().int(),
  }),
  Base.extend({
    type: z.literal('order.updated'),
    orderId: z.string(),
    items: z.array(OrderItem),
    totalCents: z.number().int(),
  }),
  Base.extend({ type: z.literal('order.queued'), orderId: z.string(), position: z.number().int() }),
  Base.extend({
    type: z.literal('order.claimed'),
    orderId: z.string(),
    baristaId: z.string(),
    waitedMs: z.number(),
  }),
  Base.extend({ type: z.literal('order.requeued'), orderId: z.string(), reason: z.string() }),
  Base.extend({ type: z.literal('order.ready'), orderId: z.string(), baristaId: z.string() }),
  Base.extend({
    type: z.literal('order.called_out'),
    orderId: z.string(),
    baristaId: z.string(),
    customerName: z.string(),
  }),
  Base.extend({ type: z.literal('order.delivered'), orderId: z.string() }),
  Base.extend({ type: z.literal('order.failed'), orderId: z.string(), reason: z.string() }),
  Base.extend({
    type: z.literal('order.refused'),
    customerId: z.string(),
    cashierId: z.string(),
    reason: z.string(),
  }),
  Base.extend({
    type: z.literal('payment.charged'),
    orderId: z.string(),
    amountCents: z.number().int(),
    method: z.enum(['card', 'cash', 'loyalty']),
  }),
  Base.extend({
    type: z.literal('inventory.changed'),
    sku: z.string(),
    delta: z.number(),
    remaining: z.number(),
  }),

  // observability
  Base.extend(AgentRef.shape).extend({
    type: z.literal('model.usage'),
    modelSpec: ModelSpec,
    step: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    latencyMs: z.number(),
  }),
  /** The manager read the whole visit (tool trail, transcript, errors) and reasoned about it. */
  Base.extend({
    type: z.literal('manager.reviewed'),
    customerId: z.string(),
    orderId: z.string().nullable(),
    modelSpec: ModelSpec,
    verdict: ReviewVerdict,
    issues: z.array(ReviewIssue),
    summary: z.string(),
    latencyMs: z.number(),
  }),
  Base.extend({
    type: z.literal('judge.verdict'),
    orderId: z.string().nullable(),
    judgeSpec: ModelSpec,
    answers: JudgeAnswers,
    latencyMs: z.number(),
  }),
  Base.extend({
    type: z.literal('staffing.changed'),
    cashiers: z.number().int(),
    baristas: z.number().int(),
  }),
])

export type CafeEvent = z.infer<typeof CafeEvent>
export type CafeEventType = CafeEvent['type']
export type CafeEventOf<T extends CafeEventType> = Extract<CafeEvent, { type: T }>

/** Payload for emitting: everything except the fields the EventBus fills in. */
export type CafeEventInput = {
  [T in CafeEventType]: Omit<CafeEventOf<T>, 'id' | 'runId' | 'seq' | 't'>
}[CafeEventType]

export const isAgentEvent = (e: CafeEvent): e is CafeEvent & { agentId: string; role: Role } =>
  'agentId' in e && typeof e.agentId === 'string'
