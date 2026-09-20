import { describe, expect, it } from 'vitest'
import { toggleGroup } from './run-draft.js'

describe('toggleGroup', () => {
  it('selects the whole group when any member is missing', () => {
    expect(toggleGroup(['a'], ['a', 'b'])).toEqual(['a', 'b'])
    expect(toggleGroup(['z'], ['a', 'b'])).toEqual(['z', 'a', 'b'])
  })
  it('clears the group when every member is selected, leaving other groups alone', () => {
    expect(toggleGroup(['a', 'b', 'z'], ['a', 'b'])).toEqual(['z'])
  })
})
