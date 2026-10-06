import { useMemo, type ReactNode } from 'react'
import type { AnonSegment } from '../lib/anonymize/apply'
import type { Entity } from '../lib/anonymize/types'

interface Mark { start: number; end: number; title: string }

// Итоговый текст с подсветкой: метки замены выделены, а фрагменты, которые
// остались в тексте как есть (непроверенные кандидаты и выключенные замены),
// отмечены предупреждением. textContent посимвольно совпадает с копируемым текстом.
function AnonymizedPreview({ text, sourceText, segments, entities, hidden }: {
  text: string
  sourceText: string
  segments: AnonSegment[]
  entities: Entity[]
  hidden: boolean
}) {
  const pieces = useMemo(() => {
    const marks: Mark[] = entities
      .filter((e) => !e.anonymize && !e.dismissed)
      .flatMap((e) => e.positions.map((p) => ({
        start: p.start,
        end: p.end,
        title: e.candidate ? `Не проверено: ${e.placeholder}` : `Замена выключена: ${e.placeholder}`,
      })))
      .sort((a, b) => a.start - b.start)

    const out: ReactNode[] = []
    segments.forEach((seg, i) => {
      if (seg.opaque) {
        out.push(<mark className="anon-replaced" key={`r${i}`}>{text.slice(seg.outStart, seg.outEnd)}</mark>)
        return
      }
      let cur = seg.srcStart
      marks.forEach((m, j) => {
        const start = Math.max(m.start, cur)
        const end = Math.min(m.end, seg.srcEnd)
        if (start >= end) return
        if (start > cur) out.push(sourceText.slice(cur, start))
        out.push(<mark className="anon-unreplaced" title={m.title} key={`u${i}-${j}`}>{sourceText.slice(start, end)}</mark>)
        cur = end
      })
      if (cur < seg.srcEnd) out.push(sourceText.slice(cur, seg.srcEnd))
    })
    return out
  }, [text, sourceText, segments, entities])

  return (
    <div className="anonymized-wrap" hidden={hidden}>
      <p className="anonymized-legend">
        <span><mark className="anon-replaced">[ЗАМЕНА]</mark> заменено</span>
        <span><mark className="anon-unreplaced">текст</mark> осталось без замены</span>
      </p>
      <pre className="markdown-preview anonymized-preview">{pieces}</pre>
    </div>
  )
}

export default AnonymizedPreview
