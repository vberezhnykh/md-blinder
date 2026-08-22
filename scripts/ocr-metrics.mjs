// Метрики сравнения OCR. Вынесены отдельно, чтобы bench-ocr.mjs (движки в
// браузере) и score-ocr.mjs (любой внешний движок, например DeepSeek-OCR на
// GPU-машине) считали одно и то же одинаково.

/** Пробелы схлопываем: перенос строки — решение движка, а не ошибка чтения. */
export function normalize(text) {
  return text.replace(/\s+/g, ' ').trim()
}

export function levenshtein(a, b) {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = new Uint32Array(b.length + 1)
  let curr = new Uint32Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

export function cer(gold, hyp) {
  const g = normalize(gold)
  return g.length === 0 ? 0 : levenshtein(g, normalize(hyp)) / g.length
}

export function wer(gold, hyp) {
  const g = normalize(gold).split(' ')
  const h = normalize(hyp).split(' ')
  // Расстояние Левенштейна по словам через отображение слов в кодовые точки.
  const vocab = new Map()
  const enc = (words) =>
    words
      .map((w) => {
        if (!vocab.has(w)) vocab.set(w, String.fromCodePoint(0x4e00 + vocab.size))
        return vocab.get(w)
      })
      .join('')
  return g.length === 0 ? 0 : levenshtein(enc(g), enc(h)) / g.length
}

/**
 * Главная для анонимайзера метрика: доля реквизитов, прочитанных без единой
 * ошибки. Ошибка в цифре ИНН или паспорта — это не «немного хуже качество»,
 * а несработавшая регулярка и утёкший в экспорт реквизит.
 */
export function requisites(gold) {
  const digits = normalize(gold).match(/\d[\d\s -]{3,}\d/g) ?? []
  return [...new Set(digits.map((d) => d.replace(/[\s -]/g, '')))].filter((d) => d.length >= 4)
}

export function requisiteRecall(gold, hyp) {
  const wanted = requisites(gold)
  if (wanted.length === 0) return { found: 0, total: 0, recall: 1, missed: [] }
  const flat = normalize(hyp).replace(/[\s -]/g, '')
  const missed = wanted.filter((r) => !flat.includes(r))
  return {
    found: wanted.length - missed.length,
    total: wanted.length,
    recall: (wanted.length - missed.length) / wanted.length,
    missed,
  }
}

/** Строка результата по одной картинке для одного движка. */
export function scoreOne({ fixture, engine, gold, text, recognizeMs }) {
  const req = requisiteRecall(gold, text)
  return {
    fixture,
    engine,
    cer: cer(gold, text),
    wer: wer(gold, text),
    requisiteRecall: req.recall,
    requisitesFound: req.found,
    requisitesTotal: req.total,
    missedRequisites: req.missed,
    recognizeMs: Math.round(recognizeMs ?? 0),
    text,
  }
}

export function formatRow(row) {
  return (
    `  ${row.engine.padEnd(13)} CER ${(row.cer * 100).toFixed(1)}%  WER ${(row.wer * 100).toFixed(1)}%  ` +
    `реквизиты ${row.requisitesFound}/${row.requisitesTotal}  ${row.recognizeMs} мс` +
    (row.missedRequisites.length ? `  потеряно: ${row.missedRequisites.join(', ')}` : '')
  )
}

export function printSummary(results, engines) {
  console.log('\n── Итого ───────────────────────────────────────────────')
  console.log(['движок', 'CER', 'WER', 'реквизиты', 'мс/страница'].map((h) => h.padEnd(14)).join(''))
  for (const engine of engines) {
    const rows = results.filter((r) => r.engine === engine)
    if (rows.length === 0) continue
    const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length
    const found = rows.reduce((s, r) => s + r.requisitesFound, 0)
    const total = rows.reduce((s, r) => s + r.requisitesTotal, 0)
    console.log(
      [
        engine,
        `${(avg((r) => r.cer) * 100).toFixed(1)}%`,
        `${(avg((r) => r.wer) * 100).toFixed(1)}%`,
        `${found}/${total}`,
        Math.round(avg((r) => r.recognizeMs)),
      ]
        .map((c) => String(c).padEnd(14))
        .join(''),
    )
  }
}
