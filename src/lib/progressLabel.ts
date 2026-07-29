// Тексты индикатора обработки. Вынесены из App.tsx отдельным чистым модулем,
// потому что главная жалоба на UI — «не видно, что он делает»: 3-страничный
// docx на CPU считается минуту, и большая часть этой минуты раньше выглядела
// как замерший «Загрузка NER-модели… 100%». Логика фаз здесь тестируется без
// рендера.

export type Phase =
  | 'pdf'
  | 'ocr'
  | 'regex'
  | 'ner-download'
  | 'ner-init'
  | 'ner-warmup'
  | 'ner-detect'

export interface UiProgress {
  phase: Phase
  page?: number
  total?: number
  pct?: number
  cached?: boolean
  ep?: 'webgpu' | 'wasm'
  chunk?: number
  chunks?: number
  batch?: number
  batches?: number
  batchChunks?: number
}

// «Куда считаем» человеческими словами: пользователю важно не название
// execution provider'а, а то, что без GPU будет долго.
function epName(ep: UiProgress['ep']): string {
  return ep === 'webgpu' ? 'GPU' : 'CPU'
}

export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function baseLabel(p: UiProgress): string {
  switch (p.phase) {
    case 'pdf':
      return `Извлечение текста из PDF… (страница ${p.page}/${p.total})`
    case 'ocr':
      return p.page === 0
        ? `Загрузка OCR-модели… ${p.pct ?? 0}%`
        : `Распознавание скана (OCR)… страница ${p.page}/${p.total} — ${p.pct ?? 0}%`
    case 'regex':
      return 'Поиск структурных данных…'
    case 'ner-download':
      return p.cached
        ? 'NER-модель читается из кеша браузера…'
        : `Скачивание NER-модели… ${p.pct ?? 0}% (~580 МБ, только при первом запуске)`
    case 'ner-init':
      // Именно здесь onnxruntime разбирает граф на 580 МБ и сыпет в консоль
      // warning'и про ReduceMean — фаза без процентов, поэтому её обязательно
      // надо назвать, иначе она читается как зависание после «100%».
      return `Подготовка NER-модели: сборка графа на ${epName(p.ep)}…`
    case 'ner-warmup':
      return `Прогрев NER-модели на ${epName(p.ep)}…`
    case 'ner-detect': {
      const chunks = p.chunks ?? 0
      const done = p.chunk ?? 0
      const batchPart =
        p.batches && p.batches > 1 ? `, партия ${p.batch}/${p.batches}` : ''
      return `Поиск чувствительных данных на ${epName(p.ep)}… фрагмент ${Math.min(done + 1, chunks)}/${chunks}${batchPart}`
    }
  }
}

// elapsedSec приписывается ко всем фазам: даже когда процентов нет (сборка
// графа, один длинный батч), тикающий таймер показывает, что процесс жив.
export function statusLabel(p: UiProgress | null, elapsedSec = 0): string {
  const base = p ? baseLabel(p) : 'Обработка файла…'
  return elapsedSec > 0 ? `${base} · ${formatElapsed(elapsedSec)}` : base
}

// Подсказка под индикатором: объясняет, почему конкретно сейчас долго.
export function statusHint(p: UiProgress | null): string | null {
  if (!p) return null
  if (p.phase === 'ocr') return 'OCR медленный — распознавание может занять несколько минут.'
  if (p.phase === 'ner-download') {
    return p.cached
      ? 'Модель уже скачана — читается с диска, сеть не нужна.'
      : 'Модель скачивается один раз и остаётся в кеше браузера.'
  }
  if (p.phase === 'ner-init' || p.phase === 'ner-warmup') {
    return p.ep === 'wasm'
      ? 'GPU недоступен — модель разворачивается на CPU, обычно 10–40 секунд. Процентов на этом шаге нет, это нормально.'
      : 'Модель разворачивается на GPU, обычно несколько секунд.'
  }
  if (p.phase === 'ner-detect' && p.ep === 'wasm') {
    return 'GPU недоступен (частая ситуация в RDS/удалённом рабочем столе) — расчёт идёт на CPU и занимает секунды на каждый фрагмент.'
  }
  return null
}
