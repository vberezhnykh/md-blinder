import type { RawMatch } from './types'

// GLiNER (small, браузерная) рвёт длинные составные адреса на куски и уверенно
// отдаёт лишь отдельные фрагменты ("ROOM C05" из целого адреса). Склеиваем
// соседние ADDRESS-спаны в один, когда между ними только "клей" (запятые,
// слэши, цифры, пробелы) в пределах одного абзаца и без границы предложения.
// Не-ADDRESS матчи проходят насквозь без изменений.
export function stitchAddressRuns(matches: RawMatch[], text: string): RawMatch[] {
  const others = matches.filter((m) => m.type !== 'ADDRESS')
  const addr = matches.filter((m) => m.type === 'ADDRESS').sort((a, b) => a.start - b.start)

  const merged: RawMatch[] = []
  let run: { start: number; end: number; score?: number } | null = null

  // Максимум двух опциональных скоров: undefined побеждает (означает "уверенность
  // не ограничена сверху" — например структурный матч), иначе берём Math.max.
  const maxScore = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a === undefined || b === undefined) return undefined
    return Math.max(a, b)
  }

  // Стоп-слова, которые чаще всего разделяют ДВЕ РАЗНЫЕ сущности в перечислении
  // ("1 Main St to 2 Oak Ave", "from ... between ... and ..."), а не куски одного
  // адреса, разорванного NER. Склеенный по ним адрес объединил бы два разных места.
  const STOP_WORDS_RE = /\b(?:to|and|or|from|between|versus|vs)\b/i

  const bridgeable = (prevEnd: number, nextStart: number): boolean => {
    if (nextStart <= prevEnd) return true // перекрытие / вплотную
    const gap = text.slice(prevEnd, nextStart)
    if (/\n[ \t]*\n/.test(gap)) return false // граница абзаца
    // Граница предложения — точка/!/? затем пробел и НЕ-цифра. Первый символ
    // следующего фрагмента лежит за срезом gap, поэтому пробуем gap + этот символ.
    // Точку ПЕРЕД цифрой (сокращения адреса: "No. 1912", "Fsz. 2nd") за границу
    // НЕ считаем — предложения с цифры не начинаются.
    const probe = gap + (text[nextStart] ?? '')
    if (/[.!?]["')\]]?\s+[^\d\s]/u.test(probe)) return false
    if (STOP_WORDS_RE.test(gap)) return false // разделитель перечисления ("... to ...")
    if (gap.length <= 45) return true // адреса длинные; зазор увеличен с 30
    return false
  }

  const flush = () => {
    if (run) {
      merged.push({
        type: 'ADDRESS',
        value: text.slice(run.start, run.end),
        start: run.start,
        end: run.end,
        score: run.score,
      })
      run = null
    }
  }

  for (const m of addr) {
    if (run && bridgeable(run.end, m.start)) {
      run.end = Math.max(run.end, m.end)
      run.score = maxScore(run.score, m.score)
    } else {
      flush()
      run = { start: m.start, end: m.end, score: m.score }
    }
  }
  flush()

  return [...others, ...merged]
}
