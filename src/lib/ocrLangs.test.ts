import { describe, it, expect } from 'vitest'
import { OCR_LANGS } from './ocrLangs'

// Регрессия на молчаливый баг: раньше воркер поднимался с одним 'eng', и скан
// русского или украинского договора превращался в бессмысленную латиницу без
// единой ошибки в консоли. Тест фиксирует, что кириллические модели на месте.
describe('OCR_LANGS', () => {
  it('includes both Cyrillic models — they do not substitute for each other', () => {
    // ukr.traineddata не знает ы/ъ/э, rus.traineddata не знает і/ї/є/ґ.
    expect(OCR_LANGS).toContain('rus')
    expect(OCR_LANGS).toContain('ukr')
  })

  it('keeps eng for bilingual documents (company names, SWIFT, IBAN)', () => {
    expect(OCR_LANGS).toContain('eng')
  })

  it('puts rus first — Tesseract treats the first language as primary', () => {
    expect(OCR_LANGS[0]).toBe('rus')
  })
})
