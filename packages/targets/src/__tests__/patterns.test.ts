import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadPack } from '../load.js'

/** A one-case pack whose single assertion is a regex check with this pattern. */
function packWith(pattern: string, flags?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pack-'))
  writeFileSync(
    join(dir, 'pack.json'),
    JSON.stringify({
      contract: 1,
      name: 'p',
      target: {
        kind: 'http',
        url: 'http://x',
        bodyTemplate: {},
        responseMap: { outcome: '$.o', outcomeMap: {} },
      },
      datasets: ['d.json'],
    }),
  )
  writeFileSync(
    join(dir, 'd.json'),
    JSON.stringify({
      name: 'd',
      cases: [
        {
          id: 'c1',
          title: 'c1',
          input: {},
          expect: {
            assertions: [
              { type: 'regexAbsent', pattern, ...(flags === undefined ? {} : { flags }) },
            ],
          },
        },
      ],
    }),
  )
  return join(dir, 'pack.json')
}

describe('regex checks are compiled when the pack loads', () => {
  it('turns a leading inline flag group into a JavaScript flag', () => {
    const [c] = loadPack(packWith('(?i)cilantro|coriander', '')).cases
    expect(c?.expect.assertions[0]).toMatchObject({ pattern: 'cilantro|coriander', flags: 'i' })
    const [d] = loadPack(packWith('(?is)a.b', 'i')).cases
    expect(d?.expect.assertions[0]).toMatchObject({ pattern: 'a.b', flags: 'is' })
  })

  it('rejects a pattern JavaScript cannot compile, naming the case', () => {
    expect(() => loadPack(packWith('(unclosed'))).toThrow(ConfigError)
    expect(() => loadPack(packWith('(unclosed'))).toThrow(
      /case c1: \/\(unclosed\/i is not a valid JavaScript regex/,
    )
    expect(() => loadPack(packWith('(?x)spaced out'))).toThrow(
      /inline flag \(\?x\) .* no JavaScript equivalent/,
    )
  })
})
