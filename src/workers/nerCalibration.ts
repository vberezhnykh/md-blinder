import type { SpanResult } from './glinerSpan'

// Synthetic multilingual canary: a backend may run successfully while losing
// fp16 discrimination. Require known entities before accepting that backend.
export const CALIBRATION_TEXT = 'Иван Петров подписал договор с ООО «Альфа». Олена Коваленко працює у ТОВ «Весна». John Smith signed for Acme Ltd.'
export const CALIBRATION_LABELS = ['person', 'company', 'address', 'registration number']
const expected: [string, string][] = [
  ['Иван Петров', 'person'], ['ООО «Альфа»', 'company'],
  ['Олена Коваленко', 'person'], ['ТОВ «Весна»', 'company'],
  ['John Smith', 'person'], ['Acme Ltd', 'company'],
]

export function assertCalibration(matches: SpanResult[]): void {
  if (!expected.every(([value, label]) => matches.some((match) =>
    match.label === label && match.start === CALIBRATION_TEXT.indexOf(value)
    && match.end === CALIBRATION_TEXT.indexOf(value) + value.length && Number.isFinite(match.score) && match.score >= 0.5,
  ))) throw new Error('NER backend не прошёл проверку качества RU/UA/EN')
}
