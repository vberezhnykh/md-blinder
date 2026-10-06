import { describe, expect, it } from 'vitest'
import { plural } from './plural'

const forms = ['находка', 'находки', 'находок'] as const

describe('plural', () => {
  it.each([
    [0, '0 находок'], [1, '1 находка'], [2, '2 находки'], [4, '4 находки'], [5, '5 находок'],
    [11, '11 находок'], [12, '12 находок'], [21, '21 находка'], [22, '22 находки'], [101, '101 находка'],
  ])('%i → %s', (n, expected) => {
    expect(plural(n, forms)).toBe(expected)
  })
})
