import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { AnonSegment } from '../lib/anonymize/apply'
import type { Entity } from '../lib/anonymize/types'

interface Mark { start: number; end: number; title: string }

// Кусок итогового текста: обычный текст, метка замены или фрагмент, оставшийся
// без замены. srcStart — смещение в исходнике, по нему панель прокручивается к
// значению, выбранному в списке или в очереди проверки.
interface Piece {
  text: string
  kind: 'plain' | 'replaced' | 'unreplaced'
  srcStart: number
  title?: string
}

// Строка Markdown-таблицы набирается моноширинным шрифтом, остальной текст —
// шрифтом с засечками.
const TABLE_LINE = /^\s*\|/

function renderPiece(piece: Piece, key: string, focusedStart: number | null): ReactNode {
  if (piece.kind === 'plain') return piece.text
  const focused = piece.srcStart === focusedStart ? ' is-focused' : ''
  return (
    <mark
      key={key}
      className={`${piece.kind === 'replaced' ? 'anon-replaced' : 'anon-unreplaced'}${focused}`}
      title={piece.title}
      data-src-start={piece.srcStart}
    >
      {piece.text}
    </mark>
  )
}

// Итоговый текст с подсветкой: метки замены показаны плашками, а фрагменты,
// которые остались в тексте как есть (непроверенные кандидаты и выключенные
// замены), подчеркнуты волнистой линией. textContent посимвольно совпадает с
// копируемым текстом: строки разделены теми же переводами строк.
function AnonymizedPreview({ text, sourceText, segments, entities, hidden, focus }: {
  text: string
  sourceText: string
  segments: AnonSegment[]
  entities: Entity[]
  hidden: boolean
  // Смещение в исходнике, к которому прокрутить; nonce повторяет прокрутку.
  focus?: { pos: number; nonce: number } | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => {
    const marks: Mark[] = entities
      .filter((e) => !e.anonymize && !e.dismissed)
      .flatMap((e) => e.positions.map((p) => ({
        start: p.start,
        end: p.end,
        title: e.candidate ? `Не проверено: ${e.placeholder}` : `Замена выключена: ${e.placeholder}`,
      })))
      .sort((a, b) => a.start - b.start)

    const pieces: Piece[] = []
    segments.forEach((seg) => {
      if (seg.opaque) {
        pieces.push({ text: text.slice(seg.outStart, seg.outEnd), kind: 'replaced', srcStart: seg.srcStart })
        return
      }
      let cur = seg.srcStart
      marks.forEach((m) => {
        const start = Math.max(m.start, cur)
        const end = Math.min(m.end, seg.srcEnd)
        if (start >= end) return
        if (start > cur) pieces.push({ text: sourceText.slice(cur, start), kind: 'plain', srcStart: cur })
        pieces.push({ text: sourceText.slice(start, end), kind: 'unreplaced', srcStart: start, title: m.title })
        cur = end
      })
      if (cur < seg.srcEnd) pieces.push({ text: sourceText.slice(cur, seg.srcEnd), kind: 'plain', srcStart: cur })
    })

    // Разбиваем куски по переводам строк, чтобы каждой строке дать свой шрифт.
    const out: Piece[][] = [[]]
    for (const piece of pieces) {
      piece.text.split('\n').forEach((part, i) => {
        if (i > 0) out.push([])
        if (part) out[out.length - 1].push({ ...piece, text: part })
      })
    }
    return out
  }, [text, sourceText, segments, entities])

  const focusPos = focus?.pos ?? null
  const focusNonce = focus?.nonce ?? 0
  const focusedStart = useMemo(() => {
    if (focusPos === null) return null
    for (const line of lines) {
      for (const piece of line) {
        if (piece.kind !== 'plain' && piece.srcStart === focusPos) return focusPos
      }
    }
    return null
  }, [lines, focusPos])

  // Прокручиваем только саму панель результата: scrollIntoView сдвинул бы и
  // страницу вместе с редактором.
  useEffect(() => {
    const box = scrollRef.current
    if (!box || hidden || focusedStart === null) return
    const mark = box.querySelector<HTMLElement>(`[data-src-start="${focusedStart}"]`)
    if (!mark) return
    const boxRect = box.getBoundingClientRect()
    const markRect = mark.getBoundingClientRect()
    box.scrollTop += markRect.top - boxRect.top - box.clientHeight / 2 + markRect.height / 2
  }, [focusedStart, focusNonce, hidden])

  return (
    <div className="anonymized-wrap" hidden={hidden}>
      <div className="pane-head">
        <span className="pane-title">Результат</span>
        <span className="anonymized-legend">
          <span><mark className="anon-replaced">[ЗАМЕНА]</mark> закрыто</span>
          <span><mark className="anon-unreplaced">текст</mark> осталось как есть</span>
        </span>
      </div>
      <div className="markdown-preview anonymized-preview" ref={scrollRef}>
        {lines.map((line, i) => {
          const lineText = line.map((p) => p.text).join('')
          return (
            <span key={i}>
              {i > 0 && '\n'}
              <span className={TABLE_LINE.test(lineText) ? 'preview-line is-table' : 'preview-line'}>
                {line.map((piece, j) => renderPiece(piece, `${i}-${j}`, focusedStart))}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default AnonymizedPreview
