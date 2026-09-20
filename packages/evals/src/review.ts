import type { JSONObject } from '@ai-sdk/provider'
import type { ModelRegistry } from '@cafe/models'
import type { CafeEvent, Order, ReviewIssue, ReviewVerdict, Scenario } from '@cafe/protocol'
import { ATTR, type Context, type Span, withSpan } from '@cafe/telemetry'
import { experimental_evaluate as evaluate } from 'ai'
import { groundTruth, type Outcome } from './ground-truth.js'
import { type StaffActivity, staffActivity } from './staff-trail.js'

/**
 * The manager's post-visit review: the orchestration layer reasoning over what its
 * sub-agents did. Unlike the judge it is not blinded (the manager knows who is on
 * shift and which model they run), and it reads the tool trail with timings.
 */
export interface ReviewBrief {
  scenario: { title: string; tags: string[]; customerSaid: string; rubric?: string | undefined }
  expected: { expectedOutcome: string; shouldRefuse: boolean }
  outcome: Outcome | null
  order: { items: Order['items']; totalCents: number; status: string } | null
  matchesExpected: boolean
  groundTruthNotes: string[]
  staff: Array<
    Pick<
      StaffActivity,
      'agentId' | 'role' | 'modelSpec' | 'said' | 'errors' | 'scopeViolations' | 'modelSteps'
    > & {
      toolCalls: Array<{ tool: string; ok: boolean; latencyMs: number; error?: string | undefined }>
      repeatedCalls: number
      medianModelLatencyMs: number | null
    }
  >
  totalMs: number | null
}

export function buildReviewBrief(
  events: CafeEvent[],
  scenario: Scenario,
  order: Pick<Order, 'items' | 'totalCents' | 'status'> | null,
  outcome: Outcome | null,
): ReviewBrief {
  const evs = [...events].sort((a, b) => a.seq - b.seq)
  const gt = groundTruth(scenario, order, outcome)
  const arrived = evs.find((e) => e.type === 'customer.arrived')
  const left = evs.find((e) => e.type === 'customer.left')
  const staff = staffActivity(evs).map((a) => {
    const seen = new Set<string>()
    let repeated = 0
    for (const st of a.steps) {
      const key = `${st.tool}:${JSON.stringify(st.args)}`
      if (seen.has(key)) repeated += 1
      seen.add(key)
    }
    const lat = [...a.modelLatenciesMs].sort((x, y) => x - y)
    return {
      agentId: a.agentId,
      role: a.role,
      modelSpec: a.modelSpec,
      said: a.said,
      errors: a.errors,
      scopeViolations: a.scopeViolations,
      modelSteps: a.modelSteps,
      toolCalls: a.steps.map((st) => ({
        tool: st.tool,
        ok: st.ok,
        latencyMs: st.latencyMs,
        error: st.error,
      })),
      repeatedCalls: repeated,
      medianModelLatencyMs: lat.length ? (lat[Math.floor(lat.length / 2)] ?? null) : null,
    }
  })
  return {
    scenario: {
      title: scenario.title,
      tags: scenario.tags,
      customerSaid:
        arrived?.type === 'customer.arrived'
          ? arrived.utterance
          : (scenario.customer.utterances[0] ?? ''),
      rubric: scenario.expected.rubric,
    },
    expected: { expectedOutcome: gt.expectedOutcome, shouldRefuse: scenario.expected.shouldRefuse },
    outcome,
    order: order
      ? { items: order.items, totalCents: order.totalCents, status: order.status }
      : null,
    matchesExpected: gt.taskSuccess,
    groundTruthNotes: gt.reasons,
    staff,
    totalMs: arrived && left ? left.t - arrived.t : null,
  }
}

export const REVIEW_QUESTIONS = {
  verdict: {
    type: 'choice',
    instructions:
      'As the manager on shift, how should this visit be filed? Consider the outcome against expectations, how the staff used their tools, and any errors.',
    criteria: {
      ok: 'handled well; nothing for the manager to follow up',
      concern:
        'the customer got what they should have, but the staff wasted calls, hit errors or were sloppy',
      escalate:
        'the outcome was wrong, a policy was breached, or something needs the manager to step in',
    },
  },
  wrongResult: {
    type: 'boolean',
    instructions:
      'Did the customer leave with the wrong result (wrong items, wrong total, wrongly served or wrongly refused)?',
  },
  wastedToolCalls: {
    type: 'boolean',
    instructions: 'Did the staff make clearly unnecessary or repeated tool calls?',
  },
  scopeBreach: {
    type: 'boolean',
    instructions: 'Did any member of staff try a tool outside their role?',
  },
  unrecoveredError: {
    type: 'boolean',
    instructions:
      'Did an error or crash go unrecovered, so the visit did not complete as it should have?',
  },
  poorTone: {
    type: 'boolean',
    instructions: 'Was the staff rude, dismissive or unprofessional with the customer?',
  },
} as const

const ISSUE_BY_QUESTION: Record<string, ReviewIssue> = {
  wrongResult: 'wrong_result',
  wastedToolCalls: 'wasted_tool_calls',
  scopeBreach: 'scope_breach',
  unrecoveredError: 'unrecovered_error',
  poorTone: 'poor_tone',
}
const ISSUE_LABEL: Record<ReviewIssue, string> = {
  wrong_result: 'wrong result',
  wasted_tool_calls: 'wasted tool calls',
  scope_breach: 'scope breach',
  unrecovered_error: 'unrecovered error',
  poor_tone: 'poor tone',
}

export interface ReviewResult {
  verdict: ReviewVerdict
  issues: ReviewIssue[]
  summary: string
  latencyMs: number
  brief: string
  inputTokens: number
  outputTokens: number
}

export async function reviewTransaction(input: {
  registry: ModelRegistry
  reviewerSpec: string
  events: CafeEvent[]
  scenario: Scenario
  order: Pick<Order, 'items' | 'totalCents' | 'status'> | null
  outcome: Outcome | null
  now?: () => number
  /** OpenTelemetry parent (the visit span). */
  parentContext?: Context | Span | null | undefined
}): Promise<ReviewResult> {
  const now = input.now ?? (() => Date.now())
  const model = input.registry.evaluationModel(input.reviewerSpec)
  const brief = JSON.stringify(
    buildReviewBrief(input.events, input.scenario, input.order, input.outcome),
  )
  const state = JSON.parse(brief) as JSONObject
  const started = now()
  const res = await withSpan(
    'review',
    'review',
    { [ATTR.MODEL_SPEC]: input.reviewerSpec },
    async (span) => {
      const r = await evaluate({ model, state, questions: REVIEW_QUESTIONS })
      span.setAttributes({
        [ATTR.INPUT_TOKENS]: r.usage.inputTokens ?? 0,
        [ATTR.OUTPUT_TOKENS]: r.usage.outputTokens ?? 0,
        [ATTR.LATENCY_MS]: now() - started,
      })
      return r
    },
    input.parentContext,
  )
  const latencyMs = now() - started
  const choice = res.answers.verdict.choice
  const verdict: ReviewVerdict =
    choice === 'ok' || choice === 'concern' || choice === 'escalate' ? choice : 'concern'
  const issues: ReviewIssue[] = []
  for (const [q, issue] of Object.entries(ISSUE_BY_QUESTION)) {
    const a = (res.answers as Record<string, { probability?: number }>)[q]
    if ((a?.probability ?? 0) >= 0.5) issues.push(issue)
  }
  const summary =
    issues.length === 0
      ? verdict === 'ok'
        ? 'Handled well.'
        : `${cap(verdict)}: no specific issue flagged.`
      : `${cap(verdict)}: ${issues.map((i) => ISSUE_LABEL[i]).join(', ')}.`
  return {
    verdict,
    issues,
    summary,
    latencyMs,
    brief,
    inputTokens: res.usage.inputTokens ?? 0,
    outputTokens: res.usage.outputTokens ?? 0,
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
