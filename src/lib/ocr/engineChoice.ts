// Выбор OCR-движка. PP-OCRv5 пока экспериментальный, поэтому по умолчанию
// остаётся Tesseract, а переключение живёт в localStorage (и разово — в
// query-параметре ?ocr=ppocr, чтобы гонять сравнения без захода в настройки).
export const OCR_ENGINES = ['tesseract', 'ppocr'] as const
export type OcrEngineName = (typeof OCR_ENGINES)[number]

export const DEFAULT_OCR_ENGINE: OcrEngineName = 'tesseract'
const STORAGE_KEY = 'md-blinder:ocr-engine'

function isEngine(value: string | null): value is OcrEngineName {
  return value !== null && (OCR_ENGINES as readonly string[]).includes(value)
}

export function getOcrEngine(): OcrEngineName {
  if (typeof window === 'undefined') return DEFAULT_OCR_ENGINE
  const fromQuery = new URLSearchParams(window.location.search).get('ocr')
  if (isEngine(fromQuery)) return fromQuery
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isEngine(stored)) return stored
  } catch {
    // Приватный режим и заблокированное хранилище — не повод падать.
  }
  return DEFAULT_OCR_ENGINE
}

export function setOcrEngine(engine: OcrEngineName): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, engine)
  } catch {
    // см. выше
  }
}

export const OCR_ENGINE_LABELS: Record<OcrEngineName, string> = {
  tesseract: 'Tesseract (по умолчанию)',
  ppocr: 'PP-OCRv5 (бета)',
}
