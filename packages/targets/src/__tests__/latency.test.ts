import { describe, expect, it } from 'vitest'
import { runAssertion } from '../assertions.js'
import { Assertion, EvalCase, HttpTargetConfig, LatencyGate } from '../config.js'
import { httpTarget, type TargetResult } from '../http-target.js'
import { judgeState } from '../judge.js'
import { type CaseSummary, latencyGates } from '../runner.js'

const result = (
  outcome: 'served' | 'refused',
  latencyMs: number,
  drafting?: number,
): TargetResult => ({
  outcome,
  reason: null,
  detail: null,
  output: [],
  steps: [
    { name: 'classify', ms: 5, model: null },
    ...(drafting === undefined ? [] : [{ name: 'drafting', ms: drafting, model: null }]),
  ],
  usage: null,
  model: null,
  latencyMs,
  httpStatus: 200,
  raw: {},
  contractErrors: [],
})

const summary = (id: string, tags: string[], results: TargetResult[]): CaseSummary => ({
  id,
  title: id,
  dataset: 'd',
  tags,
  attempts: results.map((r, i) => ({
    caseId: id,
    attempt: i + 1,
    result: r,
    checks: [],
    judge: null,
    passed: true,
    skipped: null,
    startedAt: 0,
    index: i,
  })),
  passes: results.length,
  passAny: true,
  passAll: true,
  flaky: false,
})

const cases = [
  summary('door-1', ['adversarial'], [result('refused', 40), result('refused', 60)]),
  summary('door-2', ['adversarial'], [result('refused', 2500)]),
  summary('soup', ['benign'], [result('served', 50_000, 42_000), result('served', 90_000, 80_000)]),
]

describe('latency gates', () => {
  it('measures the cases they select, by outcome, tag or step, and fail over budget', () => {
    const gates = latencyGates(
      [
        LatencyGate.parse({ outcome: 'refused', maxMs: 2000 }),
        LatencyGate.parse({ name: 'drafting', step: 'drafting', p50Ms: 60_000, warnOnly: true }),
        LatencyGate.parse({ tags: ['benign'], p95Ms: 120_000 }),
        LatencyGate.parse({ tags: ['nothing-selected'], maxMs: 1 }),
      ],
      cases,
    )
    expect(gates.map((g) => [g.name, g.actual, g.ok, g.warnOnly])).toEqual([
      ['latency · refused max', 2500, false, false],
      ['drafting p50', 42_000, true, true],
      ['latency · benign p95', 90_000, true, false],
    ])
    expect(gates.every((g) => g.unit === 'ms')).toBe(true)
    // a warn-only budget reports a miss without failing
    const warn = latencyGates(
      [LatencyGate.parse({ step: 'drafting', maxMs: 1000, warnOnly: true })],
      cases,
    )
    expect(warn[0]).toMatchObject({ ok: false, warnOnly: true, actual: 80_000 })
  })

  it('needs a bound', () => {
    expect(LatencyGate.safeParse({ outcome: 'served' }).success).toBe(false)
  })
})

describe('the latency assertion', () => {
  it('checks the whole request or one reported step', () => {
    const r = result('served', 50_000, 42_000)
    const check = (a: unknown) => runAssertion(Assertion.parse(a), r)
    expect(check({ type: 'latency', maxMs: 60_000 })).toMatchObject({
      ok: true,
      detail: 'took 50.0s',
    })
    expect(check({ type: 'latency', step: 'drafting', maxMs: 30_000 })).toMatchObject({
      ok: false,
      label: 'step "drafting" within 30.0s',
    })
    expect(check({ type: 'latency', step: 'repairing', maxMs: 1 })).toMatchObject({ ok: false })
    // and $.latencyMs is there for JSONPath checks too
    expect(check({ type: 'jsonPath', path: '$.latencyMs', op: 'lte', value: 60_000 }).ok).toBe(true)
  })
})

describe('the applied context', () => {
  it('is read from the response and handed to the judge', async () => {
    const target = httpTarget(
      HttpTargetConfig.parse({
        kind: 'http',
        url: 'http://app.test',
        bodyTemplate: {},
        responseMap: {
          outcome: '$.outcome',
          outcomeMap: { recipes: 'served' },
          output: '$.recipes',
          context: '$.applied_context',
        },
      }),
      {
        fetch: (async () =>
          new Response(
            JSON.stringify({
              outcome: 'recipes',
              recipes: [{ title: 'Soup' }],
              applied_context: {
                diet_absolutes: ['pregnancy_safe'],
                filters: { pregnancy_safe: true },
              },
            }),
          )) as unknown as typeof fetch,
      },
    )
    const c = EvalCase.parse({ id: 'p', title: 'p', input: { prompt: 'sushi' } })
    const r = await target.invoke(c, { runId: 'r', attempt: 1 })
    expect(r.context).toEqual({
      diet_absolutes: ['pregnancy_safe'],
      filters: { pregnancy_safe: true },
    })
    const state = judgeState(c, r, [], 10_000) as { request: { appliedContext: unknown } }
    expect(state.request.appliedContext).toEqual(r.context)
  })
})
