import { describe, expect, it } from 'vitest'
import { verdictOf, verdictPill } from './nomenclature.js'

describe('case verdicts', () => {
  it('passes a case that did what its golden expectation says, whatever the outcome', () => {
    expect(verdictOf('served', 'served')).toBe('pass')
    expect(verdictOf('refused', 'refused')).toBe('pass')
    expect(verdictOf('failed', 'failed')).toBe('pass')
    expect(verdictPill('refused', 'refused').cls).toContain('verdict-pass')
  })
  it('fails a deviation, including a success that should have been a refusal', () => {
    expect(verdictOf('served', 'refused')).toBe('fail')
    expect(verdictOf('refused', 'served')).toBe('fail')
    expect(verdictPill('served', 'refused')).toMatchObject({
      cls: 'pill verdict-fail',
      title: 'served; expected refused',
    })
  })
  it('stays neutral while running and when a run recorded no expectation', () => {
    expect(verdictOf(null, 'served')).toBe('pending')
    expect(verdictOf('served', null)).toBe('unknown')
    expect(verdictPill(null, 'served').cls).toBe('pill open')
  })
})
