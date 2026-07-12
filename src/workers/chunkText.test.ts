import { describe, it, expect } from 'vitest'
import { chunkText } from './chunkText'

const MARKER = 'ZZUNIQUEENTITYZZ'

function makeFiller(len: number): string {
  const words: string[] = []
  let total = 0
  let i = 0
  while (total < len) {
    const word = `word${i}`
    words.push(word)
    total += word.length + 1 // + space
    i++
  }
  return words.join(' ')
}

describe('chunkText', () => {
  it('keeps a marker straddling the 1500-char hard-split boundary intact', () => {
    // No blank lines anywhere: one giant paragraph, like raw OCR output.
    const before = makeFiller(1490)
    const after = makeFiller(2000)
    const text = `${before} ${MARKER} ${after}`

    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.some((c) => c.text.includes(MARKER))).toBe(true)
  })

  it('reports correct base offsets for every chunk (text.slice(base, base+len) === chunk.text)', () => {
    const before = makeFiller(1490)
    const after = makeFiller(2000)
    const text = `${before} ${MARKER} ${after}`

    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(text.slice(chunk.base, chunk.base + chunk.text.length)).toBe(chunk.text)
    }
  })

  it('overlaps consecutive hard-split chunks when a paragraph exceeds maxLen', () => {
    const longPara = makeFiller(5000)

    const chunks = chunkText(longPara)

    expect(chunks.length).toBeGreaterThan(1)
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i + 1].base).toBeLessThan(chunks[i].base + chunks[i].text.length)
    }
  })

  it('still chunks short text on paragraph boundaries', () => {
    const paraA = 'First paragraph.'
    const paraB = 'Second paragraph.'
    const text = `${paraA}\n\n${paraB}`

    const chunks = chunkText(text)

    expect(chunks.length).toBe(1)
    expect(chunks[0].text).toBe(`${paraA}\n\n${paraB}`)
    expect(chunks[0].base).toBe(0)
  })

  it('splits into separate chunks when paragraphs together exceed maxLen', () => {
    const paraA = makeFiller(1000)
    const paraB = makeFiller(1000)
    const text = `${paraA}\n\n${paraB}`

    const chunks = chunkText(text, 1500)

    expect(chunks.length).toBe(2)
    expect(chunks[0].text).toBe(paraA)
    expect(chunks[1].text).toBe(paraB)
    expect(chunks[1].base).toBe(paraA.length + 2)
  })
})
