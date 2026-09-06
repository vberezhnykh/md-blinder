import { expect, it } from 'vitest'
import { assertCalibration, CALIBRATION_TEXT } from './nerCalibration'

const matches = [
  ['Иван Петров', 'person'], ['ООО «Альфа»', 'company'], ['Олена Коваленко', 'person'],
  ['ТОВ «Весна»', 'company'], ['John Smith', 'person'], ['Acme Ltd', 'company'],
].map(([spanText, label]) => ({ spanText, label, start: CALIBRATION_TEXT.indexOf(spanText), end: CALIBRATION_TEXT.indexOf(spanText) + spanText.length, score: 0.9 }))

it('accepts a backend that finds the six synthetic multilingual entities', () => {
  expect(() => assertCalibration(matches)).not.toThrow()
})
it('rejects a technically successful backend that loses names or companies', () => {
  expect(() => assertCalibration(matches.filter((match) => match.label === 'person'))).toThrow('проверку качества')
  expect(() => assertCalibration(matches.map((match) => ({ ...match, score: NaN })))).toThrow()
})
