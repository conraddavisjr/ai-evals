import { describe, expect, it } from 'vitest'
import { fillTemplate, interpolateEnv, MissingEnvError } from '../template.js'

// Config packs use shell-style ${VAR}; these are plain strings, not template literals.
const v = (name: string) => `$${'{'}${name}}`

describe('interpolateEnv', () => {
  it('fills variables, uses defaults, and names every missing one', () => {
    expect(
      interpolateEnv({ url: `${v('HOST')}/x`, h: [v('TOKEN:-none')] }, { HOST: 'http://a' }),
    ).toEqual({
      url: 'http://a/x',
      h: ['none'],
    })
    try {
      interpolateEnv({ a: v('ONE'), b: v('TWO') }, {})
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError)
      expect((err as MissingEnvError).names).toEqual(['ONE', 'TWO'])
    }
  })
})

describe('fillTemplate', () => {
  const ctx = { input: { prompt: 'soup', count: 2, filters: { vegan: true } }, case: { id: 'c1' } }
  it('keeps the type of a whole placeholder and drops missing keys', () => {
    expect(
      fillTemplate(
        {
          prompt: '{{input.prompt}}',
          count: '{{input.count}}',
          filters: '{{ input.filters }}',
          scope: '{{input.scope}}',
          note: 'case {{case.id}}: {{input.count}}',
        },
        ctx,
      ),
    ).toEqual({ prompt: 'soup', count: 2, filters: { vegan: true }, note: 'case c1: 2' })
  })
})
