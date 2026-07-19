import { describe, it, expect } from 'vitest'
import { snapToWordBoundary } from './wordSnap'

describe('snapToWordBoundary', () => {
  it('snaps a mid-word position to the nearest word edge', () => {
    // "hello world" -> boundaries at 0, 5, 6, 11
    const text = 'hello world'
    expect(snapToWordBoundary(text, 2)).toBe(0) // "he|llo" closer to 0 than 5
    expect(snapToWordBoundary(text, 4)).toBe(5) // "hell|o" closer to 5 than 0
  })

  it('leaves a position already on a boundary unchanged', () => {
    const text = 'hello world'
    expect(snapToWordBoundary(text, 5)).toBe(5)
    expect(snapToWordBoundary(text, 6)).toBe(6)
  })

  it('handles the start of the string', () => {
    const text = 'hello world'
    expect(snapToWordBoundary(text, 0)).toBe(0)
  })

  it('handles the end of the string', () => {
    const text = 'hello world'
    expect(snapToWordBoundary(text, 11)).toBe(11)
    expect(snapToWordBoundary(text, 999)).toBe(11) // clamps beyond doc length
  })

  it('snaps a position inside a run of spaces to an adjacent word edge', () => {
    const text = 'foo    bar' // spaces at indices 3..6, boundaries at 0,3,7,10
    expect(snapToWordBoundary(text, 4)).toBe(3) // closer to 3 than 7
    expect(snapToWordBoundary(text, 6)).toBe(7) // closer to 7 than 3
  })

  it('resolves ties to the lower index', () => {
    // "foo  bar": boundaries 0,3,5,8. pos 4 is equidistant from 3 and 5.
    const text = 'foo  bar'
    expect(snapToWordBoundary(text, 4)).toBe(3)
  })

  it('returns 0 for an empty string', () => {
    expect(snapToWordBoundary('', 0)).toBe(0)
    expect(snapToWordBoundary('', 5)).toBe(0)
    expect(snapToWordBoundary('', -5)).toBe(0)
  })

  it('clamps a negative position before snapping', () => {
    const text = 'hello world'
    expect(snapToWordBoundary(text, -10)).toBe(0)
  })
})
