import type { CafeEventInput, RunConfigInput, TargetRunInfo } from '@cafe/protocol'
import type { PackConfig } from './config.js'
import type { TargetStep } from './http-target.js'
import type { LoadedCase } from './load.js'
import type { Attempt, Report } from './runner.js'

/**
 * A target run as the dashboard's event stream, so the Trace board, the Cases tab,
 * the Inspector and the game scenes play it like any simulated run.
 *
 * The app's reported phases map onto the same pipeline: a pre-classifier is the
 * router at the door (a case it turns away never reaches agent 1), the first
 * model call is agent 1, and review or repair is agent 2 after a hand-off. What
 * the app returned is the delivered work item; the checks and the judge close
 * the case. Pure, so it is unit-tested; the recorder only sends what this builds.
 */

export type RecordedEvent = CafeEventInput & { t: number }

export type Stage = 'router' | 'agent1' | 'agent2'

/** Which reported step names belong to which stage; anything unlisted is agent 1's. */
export const DEFAULT_PIPELINE: Record<Stage, string[]> = {
  router: ['classify', 'classifier', 'route', 'router', 'moderate', 'moderation'],
  agent1: ['drafting', 'draft', 'generate', 'generation', 'answer'],
  agent2: ['reviewing', 'review', 'repairing', 'repair', 'revise', 'validate'],
}

/** The pack's stage names over the defaults. */
export function pipelineOf(pack: PackConfig): Record<Stage, string[]> {
  const p = pack.pipeline ?? {}
  return {
    router: (p.router ?? DEFAULT_PIPELINE.router).map((x) => x.toLowerCase()),
    agent1: (p.agent1 ?? DEFAULT_PIPELINE.agent1).map((x) => x.toLowerCase()),
    agent2: (p.agent2 ?? DEFAULT_PIPELINE.agent2).map((x) => x.toLowerCase()),
  }
}

export function stageOf(step: string, pipeline: Record<Stage, string[]> = DEFAULT_PIPELINE): Stage {
  const name = step.toLowerCase()
  if (pipeline.router.includes(name)) return 'router'
  if (pipeline.agent2.includes(name)) return 'agent2'
  return 'agent1'
}

/** Stations and sprites for up to two lanes, like the cafe's two registers and machines. */
export const LANES = 2
const SPRITES = ['customer_a', 'customer_b', 'customer_c', 'customer_d', 'customer_e', 'customer_f']

/** `app:claude-opus-5` for a model the app reported; the harness never calls these. */
export const appSpec = (model: string | null | undefined, fallback: string): string =>
  `app:${(model ?? fallback).replace(/[^\w.:/-]/g, '-') || 'unknown'}`

export interface TargetRunMeta {
  pack: PackConfig
  info: TargetRunInfo
  cases: LoadedCase[]
  judgeSpec: string | null
}

export function targetRunConfig(m: TargetRunMeta): RunConfigInput {
  const app = appSpec(null, m.info.project)
  return {
    name: `${m.info.projectName} evals`,
    domain: 'target',
    orchestrator: 'http-target',
    scenarioIds: m.cases.map((c) => c.id),
    roles: { cashier: app, barista: app, manager: app, judge: m.judgeSpec ?? 'mock:none' },
    staffing: { cashiers: LANES, baristas: LANES },
    arrivalGapMs: 0,
    judgeEnabled: m.judgeSpec !== null,
    // The dashboard names the business after the project unless the pack says otherwise.
    target: { ...m.info, vocabulary: { business: m.info.projectName, ...m.info.vocabulary } },
  }
}

/** run.started, then the lanes' agents: a drafter and a reviewer per lane, and the router. */
export function runStartEvents(m: TargetRunMeta, t: number): RecordedEvent[] {
  const config = targetRunConfig(m)
  const app = appSpec(null, m.info.project)
  const out: RecordedEvent[] = [{ type: 'run.started', config: config as never, t }]
  for (let lane = 1; lane <= LANES; lane++) {
    out.push(
      {
        type: 'agent.spawned',
        agentId: `cashier-${lane}`,
        role: 'cashier',
        name: `Drafter ${lane}`,
        modelSpec: app,
        station: lane === 1 ? 'register_1' : 'register_2',
        sprite: lane === 1 ? 'cashier_a' : 'cashier_b',
        persona: `${m.info.projectName}'s first model call: it drafts the answer. The harness sees only what ${m.info.projectName} reports.`,
        t,
      },
      { type: 'staffing.changed', cashiers: lane, baristas: lane - 1, t },
    )
  }
  for (let lane = 1; lane <= LANES; lane++) {
    out.push(
      {
        type: 'agent.spawned',
        agentId: `barista-${lane}`,
        role: 'barista',
        name: `Reviewer ${lane}`,
        modelSpec: app,
        station: lane === 1 ? 'espresso_1' : 'espresso_2',
        sprite: 'barista_a',
        persona: `${m.info.projectName}'s review and repair: it checks the draft against the rules and fixes what breaks one.`,
        t,
      },
      { type: 'staffing.changed', cashiers: LANES, baristas: lane, t },
    )
  }
  out.push({
    type: 'agent.spawned',
    agentId: 'manager-1',
    role: 'manager',
    name: 'Router',
    modelSpec: app,
    station: 'office',
    sprite: 'manager',
    persona: `${m.info.projectName}'s pre-classifier: it decides whether a request is one to answer at all.`,
    t,
  })
  return out
}

export interface CaseSlot {
  /** Position in the run, from 0. */
  index: number
  lane: number
  customerId: string
  txId: string
}

export function caseSlot(c: LoadedCase, attempt: number, index: number): CaseSlot {
  const key = `${c.id}${attempt > 1 ? `-${attempt}` : ''}`
  return { index, lane: (index % LANES) + 1, customerId: `case-${key}`, txId: `tx-${key}` }
}

const promptOf = (c: LoadedCase): string => {
  const p = c.input.prompt
  return typeof p === 'string' ? p : JSON.stringify(c.input)
}

const expectedOutcome = (c: LoadedCase): 'served' | 'refused' | 'failed' => {
  const o = c.expect.outcome
  return (Array.isArray(o) ? o[0] : o) ?? 'served'
}

/** The case walks in and says its request; agent 1 starts on it. */
export function caseStartEvents(c: LoadedCase, slot: CaseSlot, t: number): RecordedEvent[] {
  const { txId, customerId } = slot
  const profile = typeof c.input.profile === 'string' ? c.input.profile : null
  const outcomes = [c.expect.outcome ?? []].flat()
  return [
    {
      type: 'customer.arrived',
      txId,
      customerId,
      name: profile ? `${profile.replace(/_/g, ' ')} profile` : 'request',
      scenarioId: c.id,
      title: c.title,
      sprite: SPRITES[slot.index % SPRITES.length] ?? 'customer_a',
      utterance: promptOf(c),
      expected: {
        outcome: expectedOutcome(c),
        ...(outcomes.length > 1 ? { outcomes } : {}),
        cashierTools: [],
        baristaTools: [],
        tags: c.tags,
        ...(c.rubric ? { rubric: c.rubric } : {}),
        shouldRefuse: outcomes.length === 1 && outcomes[0] === 'refused',
      },
      t,
    },
    { type: 'customer.moved', txId, customerId, to: 'waiting', t },
    {
      type: 'customer.moved',
      txId,
      customerId,
      to: slot.lane === 1 ? 'register_1' : 'register_2',
      t,
    },
    { type: 'customer.spoke', txId, customerId, text: promptOf(c), t },
  ]
}

const titleOf = (r: unknown, i: number): string => {
  if (r && typeof r === 'object' && typeof (r as { title?: unknown }).title === 'string')
    return (r as { title: string }).title
  return `Result ${i + 1}`
}

/** Everything after the request: the phases, the result, the verdict. */
export function caseEndEvents(
  a: Attempt,
  slot: CaseSlot,
  opts: { t0: number; pipeline?: Record<Stage, string[]>; project: string },
): RecordedEvent[] {
  const out: RecordedEvent[] = []
  const { txId, customerId } = slot
  const cashierId = `cashier-${slot.lane}`
  const baristaId = `barista-${slot.lane}`
  const r = a.result
  let t = opts.t0
  const at = () => t
  if (!r) {
    out.push(
      { type: 'customer.moved', txId, customerId, to: 'door', t: at() },
      { type: 'customer.left', txId, customerId, outcome: 'abandoned', t: at() },
    )
    return out
  }

  // No reported steps: one agent-1 step for the whole call, so the case still has a body.
  const steps: TargetStep[] = r.steps.length
    ? r.steps
    : [{ name: 'answer', ms: r.latencyMs, model: r.model }]
  const byStage = (s: Stage) => steps.filter((st) => stageOf(st.name, opts.pipeline) === s)
  const router = byStage('router')
  const agent1 = byStage('agent1')
  const agent2 = byStage('agent2')
  const routedAway = r.outcome === 'refused' && agent1.length === 0 && agent2.length === 0
  const usage = r.usage
  let billed = false
  const usageFor = (step: TargetStep, n: number, agentId: string, role: 'cashier' | 'barista') => {
    // The app reports usage for the whole call; it is shown on the first model step.
    const first = !billed
    billed = true
    return {
      type: 'model.usage' as const,
      txId,
      agentId,
      role,
      modelSpec: appSpec(step.model ?? r.model, opts.project),
      step: n,
      inputTokens: first ? Math.round(usage?.inputTokens ?? 0) : 0,
      outputTokens: first ? Math.round(usage?.outputTokens ?? 0) : 0,
      costUsd: first ? (usage?.usd ?? 0) : 0,
      latencyMs: step.ms ?? 0,
      t: 0,
    }
  }

  for (const st of router) {
    t += st.ms ?? 0
    out.push({
      type: 'triage.decided',
      txId,
      customerId,
      intent: routedAway ? (r.reason ?? 'declined') : 'request',
      escalate: false,
      escalateProbability: 0,
      modelSpec: appSpec(st.model ?? r.model, opts.project),
      latencyMs: st.ms ?? 0,
      routed: routedAway,
      t: at(),
    })
  }

  let n = 0
  for (const st of agent1) {
    n++
    out.push({
      type: 'agent.thinking',
      txId,
      agentId: cashierId,
      role: 'cashier',
      step: n,
      t: at(),
    })
    t += st.ms ?? 0
    out.push({ ...usageFor(st, n, cashierId, 'cashier'), t: at() })
  }

  // Each agent says when its part is over, so a finished run never shows one still "working".
  const idle = (agentId: string, role: 'cashier' | 'barista'): RecordedEvent => ({
    type: 'agent.idle',
    txId,
    agentId,
    role,
    t: at(),
  })

  const orderId = `${txId}-out`
  if (r.outcome === 'served') {
    const results = Array.isArray(r.output) ? r.output : r.output == null ? [] : [r.output]
    out.push({
      type: 'order.created',
      txId,
      orderId,
      customerId,
      cashierId,
      items: results.map((x, i) => ({
        menuItemId: `result-${i + 1}`,
        name: titleOf(x, i),
        modifiers: [],
        quantity: 1,
        unitPriceCents: 0,
      })),
      totalCents: 0,
      t: at(),
    })
    const titles = results.map(titleOf).join(', ')
    if (agent2.length) {
      out.push(
        { type: 'order.queued', txId, orderId, position: 1, t: at() },
        {
          type: 'agent.spoke',
          txId,
          agentId: cashierId,
          role: 'cashier',
          text: `Drafted ${titles || 'an answer'}; over to review.`,
          t: at(),
        },
        { type: 'customer.moved', txId, customerId, to: 'waiting', t: at() },
        idle(cashierId, 'cashier'),
        { type: 'order.claimed', txId, orderId, baristaId, waitedMs: 0, t: at() },
      )
      let m = 0
      for (const st of agent2) {
        m++
        out.push({
          type: 'agent.thinking',
          txId,
          agentId: baristaId,
          role: 'barista',
          step: m,
          t: at(),
        })
        t += st.ms ?? 0
        out.push({ ...usageFor(st, m, baristaId, 'barista'), t: at() })
      }
      out.push(
        { type: 'order.ready', txId, orderId, baristaId, t: at() },
        {
          type: 'order.called_out',
          txId,
          orderId,
          baristaId,
          customerName: `Case ${slot.index + 1}`,
          t: at(),
        },
        idle(baristaId, 'barista'),
      )
    } else out.push(idle(cashierId, 'cashier'))
    out.push(
      { type: 'order.delivered', txId, orderId, t: at() },
      { type: 'customer.moved', txId, customerId, to: 'pickup', t: at() },
    )
  } else if (r.outcome === 'refused') {
    const said = r.detail ?? `Declined (${r.reason ?? 'no reason given'}).`
    out.push(
      { type: 'agent.spoke', txId, agentId: cashierId, role: 'cashier', text: said, t: at() },
      {
        type: 'order.refused',
        txId,
        customerId,
        cashierId,
        reason: r.reason ? `${r.reason}: ${said}` : said,
        t: at(),
      },
      idle(cashierId, 'cashier'),
    )
  } else {
    out.push({
      type: 'agent.error',
      txId,
      agentId: cashierId,
      role: 'cashier',
      kind: r.reason === 'timeout' ? 'timeout' : 'model',
      message: `${r.reason ?? 'failed'}: ${r.detail ?? 'no detail'}`,
      retryable: false,
      t: at(),
    })
    out.push(idle(cashierId, 'cashier'))
  }
  // Whatever the phases add up to, the case ends when the app answered.
  t = Math.max(t, opts.t0 + r.latencyMs)
  out.push(
    { type: 'customer.moved', txId, customerId, to: 'door', t: at() },
    { type: 'customer.left', txId, customerId, outcome: r.outcome, t: at() },
  )

  if (a.judge && !a.judge.skipped && Object.keys(a.judge.answers).length) {
    t += a.judge.latencyMs
    out.push({
      type: 'judge.verdict',
      txId,
      orderId: r.outcome === 'served' ? orderId : null,
      judgeSpec: a.judge.spec,
      answers: a.judge.answers,
      latencyMs: a.judge.latencyMs,
      questions: a.judge.questions,
      t: at(),
    })
  }
  out.push({
    type: 'case.scored',
    txId,
    customerId,
    passed: a.passed,
    checks: a.checks,
    reason: r.reason,
    detail: r.detail,
    output: trimOutput(r.output),
    t: at(),
  })
  return out
}

/** Keep the Inspector's copy of the output bounded (a recipe batch can be large). */
function trimOutput(v: unknown, max = 60_000): unknown {
  const s = JSON.stringify(v ?? null)
  return s.length <= max ? v : { truncated: true, preview: s.slice(0, max) }
}

export function runEndEvents(r: Report, t: number): RecordedEvent[] {
  return [
    {
      type: 'run.finished',
      summary: {
        transactions: r.totals.attempts,
        succeeded: r.totals.passed,
        failed: r.totals.attempts - r.totals.passed,
        costUsd: r.totals.usd,
      },
      t,
    },
  ]
}
