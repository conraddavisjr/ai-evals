import { describe, expect, it } from 'vitest'
import { MODE_DOCS, modeDoc } from './mode-docs.js'
import type { PlaybackMode } from './TimelinePlayer.js'

const MODES: PlaybackMode[] = ['live-buffered', 'live-raw', 'replay', 'step', 'directors-cut']
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length

describe('playback mode docs', () => {
  it('cover every mode exactly once, in the order of the switcher', () => {
    expect(MODE_DOCS.map((m) => m.id)).toEqual(MODES)
    for (const id of MODES) expect(modeDoc(id).id).toBe(id)
  })

  it('keep the collapsed summary to two sentences and the long form to two short paragraphs', () => {
    for (const m of MODE_DOCS) {
      expect(sentences(m.summary), `${m.id} summary`).toBe(2)
      expect(m.details.length, `${m.id} paragraphs`).toBe(2)
      for (const p of m.details) expect(sentences(p), `${m.id} paragraph`).toBeLessThanOrEqual(6)
    }
  })

  it('use no em dashes', () => {
    for (const m of MODE_DOCS) expect(`${m.summary}${m.details.join('')}`).not.toMatch(/—/)
  })
})
