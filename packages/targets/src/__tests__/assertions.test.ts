import { describe, expect, it } from 'vitest'
import { deterministicChecks, runAssertion } from '../assertions.js'
import { Assertion, EvalCase } from '../config.js'
import type { TargetResult } from '../http-target.js'

const result = (over: Partial<TargetResult> = {}): TargetResult => ({
  outcome: 'served',
  reason: null,
  detail: null,
  output: [{ title: 'Street tacos', ingredients: [{ name: 'Cilantro' }], total_minutes: 25 }],
  steps: [{ name: 'drafting', ms: 10, model: null }],
  usage: null,
  model: null,
  latencyMs: 5,
  httpStatus: 200,
  raw: { guard_issues: ['too long'] },
  contractErrors: [],
  ...over,
})

describe('assertions', () => {
  it('checks JSON paths with every operator', () => {
    const r = result()
    const ok = (a: unknown) => runAssertion(Assertion.parse(a), r).ok
    expect(ok({ type: 'jsonPath', path: '$.output[*].total_minutes', op: 'lte', value: 30 })).toBe(
      true,
    )
    expect(ok({ type: 'jsonPath', path: '$.output[*].total_minutes', op: 'gte', value: 30 })).toBe(
      false,
    )
    expect(ok({ type: 'jsonPath', path: '$..name', op: 'excludes', value: 'cilantro' })).toBe(false)
    expect(
      ok({ type: 'jsonPath', path: '$.raw.guard_issues', op: 'includes', value: 'too long' }),
    ).toBe(true)
    expect(ok({ type: 'jsonPath', path: '$.output[0].missing', op: 'absent' })).toBe(true)
    expect(ok({ type: 'jsonPath', path: '$.outcome', op: 'equals', value: 'served' })).toBe(true)
    expect(ok({ type: 'count', path: '$.output', min: 1, max: 1 })).toBe(true)
    expect(ok({ type: 'regexAbsent', pattern: 'cilantro' })).toBe(false)
    expect(ok({ type: 'regexPresent', pattern: 'tacos' })).toBe(true)
    expect(ok({ type: 'stepPresent', name: 'repairing' })).toBe(false)
    // a check scoped to served answers is skipped on a refusal
    const refused = runAssertion(
      Assertion.parse({ type: 'count', path: '$.output', min: 1, when: ['served'] }),
      result({ outcome: 'refused', output: [] }),
    )
    expect(refused).toMatchObject({ ok: true, detail: 'skipped: outcome refused' })
  })

  it('checks outcome, reason and the contract before any assertion', () => {
    const c = EvalCase.parse({
      id: 'x',
      title: 'x',
      input: {},
      expect: {
        outcome: 'refused',
        reason: ['off_topic'],
        assertions: [{ type: 'count', path: '$.output', max: 0 }],
      },
    })
    const checks = deterministicChecks(
      c,
      result({
        outcome: 'refused',
        reason: 'harmful',
        output: [],
        contractErrors: ['recipes: expected array'],
      }),
    )
    expect(checks.map((k) => [k.kind, k.ok])).toEqual([
      ['outcome', true],
      ['reason', false],
      ['contract', false],
      ['assertion', true],
    ])
  })
})
