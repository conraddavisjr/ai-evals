import { describe, expect, it } from 'vitest'
import { parsePath, query } from '../jsonpath.js'

const doc = {
  output: [
    {
      title: 'A',
      ingredients: [{ name: 'leek' }, { name: 'potato' }],
      derived: { is_vegan: true },
    },
    { title: 'B', ingredients: [{ name: 'egg' }], derived: { is_vegan: false } },
  ],
  raw: { 'guard-issues': [] },
}

describe('jsonpath', () => {
  it('selects keys, indexes and wildcards', () => {
    expect(query(doc, '$.output[0].title')).toEqual(['A'])
    expect(query(doc, '$.output[-1].title')).toEqual(['B'])
    expect(query(doc, '$.output[*].title')).toEqual(['A', 'B'])
    expect(query(doc, "$.raw['guard-issues']")).toEqual([[]])
    expect(query(doc, '$.output.*.derived.is_vegan')).toEqual([true, false])
  })
  it('finds keys at any depth', () => {
    expect(query(doc, '$..name')).toEqual(['leek', 'potato', 'egg'])
  })
  it('returns nothing for a missing path and the root for $', () => {
    expect(query(doc, '$.nope.deeper')).toEqual([])
    expect(query(null, '$.x')).toEqual([])
    expect(query(doc, '$')).toEqual([doc])
  })
  it('rejects paths it does not understand', () => {
    expect(() => parsePath('output')).toThrow(/start with \$/)
    expect(() => parsePath('$[?(@.x)]')).toThrow(/Unsupported/)
  })
})
