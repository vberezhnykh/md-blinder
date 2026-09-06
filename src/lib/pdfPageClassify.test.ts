import { describe, it, expect } from 'vitest'
import { classifyPdfPages } from './pdfPageClassify'

describe('classifyPdfPages', () => {
  it('classifies every page as text when each has plenty of non-whitespace content', () => {
    expect(classifyPdfPages([120, 340, 58])).toEqual(['text', 'text', 'text'])
  })

  it('classifies every page as ocr when each has near-empty text content', () => {
    expect(classifyPdfPages([0, 2, 5])).toEqual(['ocr', 'ocr', 'ocr'])
  })

  it('classifies a mixed document per page, preserving order', () => {
    expect(classifyPdfPages([200, 3, 150, 0])).toEqual(['text', 'ocr', 'text', 'ocr'])
  })

  it('treats a count exactly at the threshold as text (boundary)', () => {
    expect(classifyPdfPages([8, 7], 8)).toEqual(['text', 'ocr'])
  })

  it('returns an empty array for an empty document', () => {
    expect(classifyPdfPages([])).toEqual([])
  })

  it('routes a large scanned image with only a text header to OCR', () => {
    expect(classifyPdfPages([
      { nonWsCount: 48, bodyNonWsCount: 0, textAreaRatio: 0.005, imageAreaRatio: 0.8 },
      { nonWsCount: 800, bodyNonWsCount: 740, textAreaRatio: 0.09, imageAreaRatio: 1 },
      { nonWsCount: 48, bodyNonWsCount: 0, textAreaRatio: 0.005, imageAreaRatio: 0.01 },
    ])).toEqual(['ocr', 'text', 'text'])
  })
})
