import { describe, it, expect } from 'vitest'
import { statusLabel, statusHint, formatElapsed, type UiProgress } from './progressLabel'

describe('formatElapsed', () => {
  it('форматирует секунды как m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(7)).toBe('0:07')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(600)).toBe('10:00')
  })
})

describe('statusLabel', () => {
  it('различает фазы загрузки модели, а не схлопывает их в одну', () => {
    const labels = (['ner-download', 'ner-init', 'ner-warmup', 'ner-detect'] as const).map((phase) =>
      statusLabel({ phase, pct: 100, ep: 'wasm', chunk: 0, chunks: 3 }),
    )
    expect(new Set(labels).size).toBe(4)
  })

  it('говорит, что модель берётся из кеша, а не скачивается', () => {
    expect(statusLabel({ phase: 'ner-download', cached: true, pct: 100 })).toContain('из кеша')
    expect(statusLabel({ phase: 'ner-download', cached: false, pct: 42 })).toContain('42%')
  })

  it('называет вычислитель словами CPU/GPU', () => {
    expect(statusLabel({ phase: 'ner-init', ep: 'wasm' })).toContain('CPU')
    expect(statusLabel({ phase: 'ner-init', ep: 'webgpu' })).toContain('GPU')
  })

  it('на detect показывает фрагмент, который считается СЕЙЧАС (а не 0 из N)', () => {
    expect(statusLabel({ phase: 'ner-detect', ep: 'wasm', chunk: 0, chunks: 3 })).toContain(
      'фрагмент 1/3',
    )
    expect(statusLabel({ phase: 'ner-detect', ep: 'wasm', chunk: 2, chunks: 3 })).toContain(
      'фрагмент 3/3',
    )
  })

  it('не выходит за пределы общего числа фрагментов на последнем батче', () => {
    expect(statusLabel({ phase: 'ner-detect', ep: 'wasm', chunk: 3, chunks: 3 })).toContain(
      'фрагмент 3/3',
    )
  })

  it('показывает номер партии только когда партий больше одной', () => {
    const one: UiProgress = { phase: 'ner-detect', chunk: 0, chunks: 3, batch: 1, batches: 1 }
    const many: UiProgress = { phase: 'ner-detect', chunk: 8, chunks: 24, batch: 2, batches: 3 }
    expect(statusLabel(one)).not.toContain('партия')
    expect(statusLabel(many)).toContain('партия 2/3')
  })

  it('дописывает таймер, чтобы фазы без процентов не выглядели зависшими', () => {
    expect(statusLabel({ phase: 'ner-init', ep: 'wasm' }, 46)).toContain('· 0:46')
    expect(statusLabel({ phase: 'ner-init', ep: 'wasm' }, 0)).not.toContain('·')
  })

  it('без прогресса возвращает общий текст', () => {
    expect(statusLabel(null)).toBe('Обработка файла…')
  })
})

describe('statusHint', () => {
  it('объясняет отсутствие процентов на подготовке модели', () => {
    expect(statusHint({ phase: 'ner-init', ep: 'wasm' })).toContain('CPU')
    expect(statusHint({ phase: 'ner-warmup', ep: 'wasm' })).toContain('Процентов на этом шаге нет')
  })

  it('предупреждает про CPU на этапе поиска и молчит на GPU', () => {
    expect(statusHint({ phase: 'ner-detect', ep: 'wasm' })).toContain('CPU')
    expect(statusHint({ phase: 'ner-detect', ep: 'webgpu' })).toBeNull()
  })

  it('сохраняет подсказку про медленный OCR', () => {
    expect(statusHint({ phase: 'ocr', page: 1, total: 2 })).toContain('OCR')
  })

  it('на структурном поиске подсказки нет', () => {
    expect(statusHint({ phase: 'regex' })).toBeNull()
    expect(statusHint(null)).toBeNull()
  })
})
