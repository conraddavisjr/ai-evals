import { CafeEvent } from '@cafe/protocol'
import { describe, expect, it } from 'vitest'
import { EvalCase, PackConfig } from '../config.js'
import {
  caseEndEvents,
  caseSlot,
  caseStartEvents,
  pipelineOf,
  type RecordedEvent,
  runStartEvents,
  stageOf,
  type TargetRunMeta,
} from '../events.js'
import type { TargetResult } from '../http-target.js'
import type { LoadedCase } from '../load.js'
import type { Attempt } from '../runner.js'

const pack = PackConfig.parse({
  contract: 1,
  name: 'Palate',
  target: {
    kind: 'http',
    url: 'http://x',
    bodyTemplate: {},
    responseMap: { outcome: '$.o', outcomeMap: {} },
  },
  datasets: ['d.json'],
})

const mk = (id: string, prompt: string, outcome: 'served' | 'refused'): LoadedCase => ({
  ...EvalCase.parse({
    id,
    title: id,
    tags: ['t'],
    input: { prompt, profile: 'vegan' },
    expect: { outcome },
  }),
  dataset: 'd',
})

const result = (over: Partial<TargetResult>): TargetResult => ({
  outcome: 'served',
  reason: null,
  detail: null,
  output: [{ title: 'Tofu scramble' }],
  steps: [
    { name: 'classify', ms: 800, model: 'claude-haiku-4-5' },
    { name: 'drafting', ms: 40_000, model: 'claude-opus-5' },
    { name: 'reviewing', ms: 5000, model: 'claude-haiku-4-5' },
    { name: 'repairing', ms: 30_000, model: 'claude-opus-5' },
  ],
  usage: { inputTokens: 1000, outputTokens: 2000, usd: 0.2 },
  model: 'claude-opus-5',
  latencyMs: 76_000,
  httpStatus: 200,
  raw: {},
  contractErrors: [],
  ...over,
})

const attempt = (r: TargetResult, passed = true): Attempt => ({
  caseId: 'c',
  attempt: 1,
  result: r,
  checks: [{ kind: 'outcome', label: 'outcome served', ok: passed, detail: 'got served' }],
  judge: {
    spec: 'anthropic/claude-sonnet-5',
    answers: { onlyRecipes: { probability: 0.97 }, cookable: { score: 4 } },
    latencyMs: 3000,
    questions: [{ id: 'onlyRecipes', type: 'boolean', instructions: 'Only recipes?' }],
  },
  passed,
  skipped: null,
  startedAt: 1_000_000,
  index: 0,
})

/** Stamp and validate like the server's EventBus does. */
const valid = (events: RecordedEvent[]) =>
  events.map((e, seq) => CafeEvent.parse({ ...e, id: `e${seq}`, runId: 'r', seq }))

const meta: TargetRunMeta = {
  pack,
  cases: [],
  judgeSpec: 'anthropic/claude-sonnet-5',
  info: {
    project: 'palate',
    projectName: 'Palate',
    pack: 'evals/stardust.config.json',
    url: 'http://x',
    source: 'local',
    git: { branch: 'eval-route' },
    vocabulary: {},
  },
}

describe('target run events', () => {
  it('maps reported steps onto router, agent 1 and agent 2', () => {
    expect(stageOf('classify')).toBe('router')
    expect(stageOf('Drafting')).toBe('agent1')
    expect(stageOf('repairing')).toBe('agent2')
    expect(stageOf('something-else')).toBe('agent1')
    const p = pipelineOf(PackConfig.parse({ ...pack, pipeline: { router: ['gate'] } }))
    expect(stageOf('gate', p)).toBe('router')
  })

  it('starts a run with a drafter and a reviewer per lane and the router', () => {
    const events = valid(runStartEvents({ ...meta, cases: [mk('a', 'soup', 'served')] }, 5))
    expect(events[0]).toMatchObject({
      type: 'run.started',
      config: { domain: 'target', target: { project: 'palate' } },
    })
    expect(
      events.filter((e) => e.type === 'agent.spawned').map((e) => 'agentId' in e && e.agentId),
    ).toEqual(['cashier-1', 'cashier-2', 'barista-1', 'barista-2', 'manager-1'])
  })

  it('plays a served case through the hand-off, with the checks and the judge last', () => {
    const c = mk('soup', 'a cozy soup', 'served')
    const slot = caseSlot(c, 1, 0)
    const events = valid([
      ...caseStartEvents(c, slot, 1_000_000),
      ...caseEndEvents(attempt(result({})), slot, { t0: 1_000_000, project: 'palate' }),
    ])
    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'customer.arrived',
      'customer.moved',
      'customer.moved',
      'customer.spoke',
      'triage.decided',
      'agent.thinking',
      'model.usage',
      'order.created',
      'order.queued',
      'agent.spoke',
      'customer.moved',
      'order.claimed',
      'agent.thinking',
      'model.usage',
      'agent.thinking',
      'model.usage',
      'order.ready',
      'order.called_out',
      'order.delivered',
      'customer.moved',
      'customer.moved',
      'customer.left',
      'judge.verdict',
      'case.scored',
    ])
    const usage = events.filter((e) => e.type === 'model.usage')
    // usage is reported for the whole call: it lands on the first model step only
    expect(
      usage.map(
        (e) => e.type === 'model.usage' && [e.agentId, e.modelSpec, e.latencyMs, e.costUsd],
      ),
    ).toEqual([
      ['cashier-1', 'app:claude-opus-5', 40_000, 0.2],
      ['barista-1', 'app:claude-haiku-4-5', 5000, 0],
      ['barista-1', 'app:claude-opus-5', 30_000, 0],
    ])
    const left = events.find((e) => e.type === 'customer.left')
    expect(left?.t).toBe(1_000_000 + 76_000)
    expect(events.find((e) => e.type === 'order.created')).toMatchObject({
      items: [{ name: 'Tofu scramble' }],
    })
    expect(events.find((e) => e.type === 'judge.verdict')).toMatchObject({
      questions: [{ id: 'onlyRecipes' }],
    })
    // times never go backwards within a case
    expect(events.every((e, i) => i === 0 || e.t >= (events[i - 1]?.t ?? 0))).toBe(true)
  })

  it('turns a declined case away at the router when nothing else ran', () => {
    const c = mk('ricin', 'ricin', 'refused')
    const slot = caseSlot(c, 1, 1)
    const events = valid(
      caseEndEvents(
        attempt(
          result({
            outcome: 'refused',
            reason: 'harmful',
            detail: 'I only help with food.',
            output: [],
            steps: [{ name: 'classify', ms: 2, model: null }],
            latencyMs: 30,
          }),
        ),
        slot,
        { t0: 5, project: 'palate' },
      ),
    )
    expect(events.find((e) => e.type === 'triage.decided')).toMatchObject({
      routed: true,
      intent: 'harmful',
    })
    expect(events.find((e) => e.type === 'order.refused')).toMatchObject({
      reason: 'harmful: I only help with food.',
    })
    expect(events.some((e) => e.type === 'model.usage')).toBe(false)
    expect(slot).toMatchObject({ lane: 2, customerId: 'case-ricin' })
  })

  it('records a failed case as an agent error and a red score', () => {
    const c = mk('slow', 'x', 'served')
    const events = valid(
      caseEndEvents(
        attempt(
          result({
            outcome: 'failed',
            reason: 'timeout',
            detail: 'No answer',
            steps: [],
            output: null,
          }),
          false,
        ),
        caseSlot(c, 2, 3),
        { t0: 0, project: 'palate' },
      ),
    )
    expect(events.find((e) => e.type === 'agent.error')).toMatchObject({ kind: 'timeout' })
    expect(events.at(-1)).toMatchObject({
      type: 'case.scored',
      passed: false,
      customerId: 'case-slow-2',
    })
  })
})
