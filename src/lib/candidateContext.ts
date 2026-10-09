export interface CandidateContext {
  before: string
  match: string
  after: string
  // Обрезан ли текст слева или справа: тогда в начале или конце ставится «…».
  cutBefore: boolean
  cutAfter: boolean
}

// Пробелы и переводы строк внутри фрагмента сводятся к одному пробелу: в
// карточке проверки фрагмент показывается одной строкой.
function squash(s: string): string {
  return s.replace(/\s+/g, ' ')
}

// Фрагмент текста вокруг вхождения кандидата: около radius символов с каждой
// стороны, обрезанный по пробелу, чтобы не рвать слова.
export function candidateContext(text: string, start: number, end: number, radius = 60): CandidateContext {
  let from = Math.max(0, start - radius)
  if (from > 0) {
    const space = text.indexOf(' ', from)
    if (space !== -1 && space < start) from = space + 1
  }
  let to = Math.min(text.length, end + radius)
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to)
    if (space > end) to = space
  }
  return {
    before: squash(text.slice(from, start)).trimStart(),
    match: text.slice(start, end),
    after: squash(text.slice(end, to)).trimEnd(),
    cutBefore: from > 0,
    cutAfter: to < text.length,
  }
}
