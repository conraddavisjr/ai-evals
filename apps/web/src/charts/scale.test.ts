import { describe, expect, it } from 'vitest'
import { band, labelledTicks, linear, log, niceTicks } from './scale.js'

describe('chart scales', () => {
  it('linear maps the domain onto the range and produces round ticks', () => {
    const x = linear([0, 50], [10, 110])
    expect(x(0)).toBe(10)
    expect(x(25)).toBe(60)
    expect(x(50)).toBe(110)
    expect(niceTicks(0, 50, 5)).toEqual([0, 10, 20, 30, 40, 50])
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
  it('log ticks are 1-2-5 decades inside the domain', () => {
    const x = log([2, 500], [0, 100])
    expect(x.ticks()).toEqual([2, 5, 10, 20, 50, 100, 200, 500])
    expect(x(2)).toBe(0)
    expect(x(500)).toBe(100)
  })
  it('labelled ticks drop duplicates once formatted, so count axes never read 0 0 1 1', () => {
    const t = labelledTicks(niceTicks(0, 1, 4), (v) => String(Math.round(v)))
    expect(t.map((x) => x.label)).toEqual(['0', '1'])
  })
  it('band spaces rows evenly', () => {
    const b = band(4, [0, 100], 0)
    expect(b.step).toBe(25)
    expect(b.center(0)).toBe(12.5)
    expect(b.center(3)).toBe(87.5)
  })
})
