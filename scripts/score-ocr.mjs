// Считает те же метрики, что bench-ocr.mjs, но для движка, который прогнали
// снаружи браузера (например DeepSeek-OCR на GPU-машине) и сохранили в JSON:
//
//   { "engine": "deepseek-ocr", "results": [ { "fixture": "...", "text": "...",
//     "recognizeMs": 1234 } ] }
//
// Usage:
//   node scripts/score-ocr.mjs [--dir tests/local/ocr-fixtures] out-a.json out-b.json
//
// Файлы, снятые самим bench-ocr.mjs, тоже принимаются — тогда все движки
// попадают в одну таблицу и сравниваются на одном эталоне.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatRow, printSummary, scoreOne } from './ocr-metrics.mjs'

const args = process.argv.slice(2)
const dirIndex = args.indexOf('--dir')
const dir = dirIndex === -1 ? 'tests/local/ocr-fixtures' : args[dirIndex + 1]
const dirValueIndex = dirIndex === -1 ? -1 : dirIndex + 1
const files = args.filter((a, i) => !a.startsWith('--') && i !== dirValueIndex)

if (files.length === 0) {
  console.error('Укажите хотя бы один JSON с результатами. См. шапку файла.')
  process.exit(1)
}

const results = []
const engines = []
for (const file of files) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  for (const row of parsed.results) {
    const engine = row.engine ?? parsed.engine
    if (!engines.includes(engine)) engines.push(engine)
    const gold = readFileSync(join(dir, `${row.fixture}.txt`), 'utf8')
    results.push(scoreOne({ ...row, engine, gold }))
  }
}

for (const fixture of [...new Set(results.map((r) => r.fixture))]) {
  console.log(`\n=== ${fixture}`)
  for (const row of results.filter((r) => r.fixture === fixture)) console.log(formatRow(row))
}

printSummary(results, engines)
