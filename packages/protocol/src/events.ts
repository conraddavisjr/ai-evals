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

/**
 * The intent a triage decided. Each domain pack defines its own options (the cafe's
 * are order, question, complaint, adversarial); `adversarial` is shared by convention.
 */
export const TriageIntent = z.string().min(1)
export type TriageIntent = z.infer<typeof TriageIntent>

export const JudgeAnswer = z.union([
  z.object({ probability: z.number().min(0).max(1) }),
  z.object({ score: z.number().int().min(1).max(5) }),
])
export type JudgeAnswer = z.infer<typeof JudgeAnswer>

/**
 * A judge's answers by question id. Simulated domains ask the five standard
 * questions (correct, refusalAppropriate, helpfulness, tone, toolUseQuality);
 * a config pack asks its own, and names them on the verdict (`questions`).
 */
export const JudgeAnswers = z.record(z.string(), JudgeAnswer)
export type JudgeAnswers = z.infer<typeof JudgeAnswers>

/** The wording a verdict was answered against, so a score never silently changes meaning. */
export const JudgeQuestionInfo = z.object({
  id: z.string(),
  type: z.enum(['boolean', 'score']),
  instructions: z.string(),
})
export type JudgeQuestionInfo = z.infer<typeof JudgeQuestionInfo>

/** P(yes) for a boolean question, or null when it was not asked. */
export function probabilityOf(answers: JudgeAnswers, id: string): number | null {
  const a = answers[id]
  return a && 'probability' in a ? a.probability : null
}

/** A 1 to 5 score, or null when it was not asked. */
export function scoreOf(answers: JudgeAnswers, id: string): number | null {
  const a = answers[id]
  return a && 'score' in a ? a.score : null
}

const SHORT_LABEL: Record<string, string> = {
  correct: 'correct',
  refusalAppropriate: 'refusal',
  helpfulness: 'help',
  tone: 'tone',
  toolUseQuality: 'tools',
}

/** "correct 95% · help 4/5 · …" for any question set, standard names shortened. */
export function answersLine(answers: JudgeAnswers, sep = ' · '): string {
  return Object.entries(answers)
    .map(([id, a]) =>
      'probability' in a
        ? `${SHORT_LABEL[id] ?? id} ${Math.round(a.probability * 100)}%`
        : `${SHORT_LABEL[id] ?? id} ${a.score}/5`,
    )
    .join(sep)
}

/** One deterministic check a target run made on a case (outcome, contract, an assertion, a judge expectation). */
export const CaseCheck = z.object({
  kind: z.enum(['outcome', 'reason', 'assertion', 'contract', 'judge']),
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
})
export type CaseCheck = z.infer<typeof CaseCheck>

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

/** How a run went, in four numbers: on run.finished, and on the run's row for lists. */
export const RunSummary = z.object({
  transactions: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  costUsd: z.number(),
})
export type RunSummary = z.infer<typeof RunSummary>

export const CafeEvent = z.discriminatedUnion('type', [
  // run lifecycle
  Base.extend({ type: z.literal('run.started'), config: RunConfig }),
  Base.extend({ type: z.literal('run.finished'), summary: RunSummary }),
  Base.extend({ type: z.literal('run.failed'), error: z.string() }),

  // customer (scripted in V1, an agent later; same events either way)
  Base.extend({
    type: z.literal('customer.arrived'),
    customerId: z.string(),
    name: z.string(),
    scenarioId: z.string(),
    /** The golden case's title, so views can label a case by what it tests rather than by its persona. */
    title: z.string().optional(),
    sprite: z.string(),
    utterance: z.string(),
    /** The golden item's expectations, so a consumer of the stream alone can mark each step right or wrong. */
    expected: z
      .object({
        outcome: z.enum(['served', 'refused', 'failed']),
        /** Every outcome the case accepts, when it is more than one (a decline or a harmless answer). */
        outcomes: z.array(z.enum(['served', 'refused', 'failed'])).optional(),
        cashierTools: z.array(z.string()),
        baristaTools: z.array(z.string()),
        tags: z.array(z.string()),
        /** The rest of the golden output, so the Inspector can show the whole expectation (newer runs). */
        items: z
          .array(
            z.object({
              name: z.string(),
              size: z.string().optional(),
              modifiers: z.array(z.string()).optional(),
            }),
          )
          .optional(),
        totalCents: z.number().int().optional(),
        shouldRefuse: z.boolean().optional(),
        rubric: z.string().optional(),
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
    /** Triage routing was on and this decision sent the case away before agent 1 saw it. */
    routed: z.boolean().optional(),
  }),

  // action gate: the decision model approves or blocks a gated tool call before it runs
  Base.extend({
    type: z.literal('guard.decided'),
    agentId: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
    approveProbability: z.number().min(0).max(1),
    allowed: z.boolean(),
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
    /** The agent's system prompt (its persona), for the Inspector (newer runs). */
    persona: z.string().optional(),
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
    /** The questions asked, when they are a pack's own rather than the standard five. */
    questions: z.array(JudgeQuestionInfo).optional(),
  }),
  /**
   * A target run's verdict on one case: every check, and whether all passed. For
   * cases evaluated against a config pack this, not outcome versus expected
   * outcome, is what makes a case green or red.
   */
  Base.extend({
    type: z.literal('case.scored'),
    customerId: z.string(),
    passed: z.boolean(),
    checks: z.array(CaseCheck),
    /** The app's own reason code for its outcome (off_topic, harmful, capped, timeout). */
    reason: z.string().nullable(),
    /** The app's human explanation, when it gave one. */
    detail: z.string().nullable(),
    /** What the app returned, trimmed for the Inspector. */
    output: z.unknown().optional(),
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
