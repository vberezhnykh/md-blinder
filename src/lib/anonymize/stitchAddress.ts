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
  let run: { start: number; end: number } | null = null

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
    if (gap.length <= 45) return true // адреса длинные; зазор увеличен с 30
    return false
  }

  const flush = () => {
    if (run) {
      merged.push({ type: 'ADDRESS', value: text.slice(run.start, run.end), start: run.start, end: run.end })
      run = null
    }
  }

  for (const m of addr) {
    if (run && bridgeable(run.end, m.start)) {
      run.end = Math.max(run.end, m.end)
    } else {
      flush()
      run = { start: m.start, end: m.end }
    }
  }
  flush()

  return [...others, ...merged]
}
