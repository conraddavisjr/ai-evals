import { describe, expect, it } from 'vitest'
import { clampPanelWidth, PANEL_MIN } from './usePanelWidth.js'

describe('clampPanelWidth', () => {
  it('never exceeds half the viewport', () => {
    expect(clampPanelWidth(2000, 1600)).toBe(800)
  })
  it('never goes below the minimum, even on a tiny viewport', () => {
    expect(clampPanelWidth(10, 1600)).toBe(PANEL_MIN)
    expect(clampPanelWidth(10, 400)).toBe(PANEL_MIN)
  })
  it('passes sensible widths through, rounded', () => {
    expect(clampPanelWidth(420.6, 1600)).toBe(421)
  })
})
