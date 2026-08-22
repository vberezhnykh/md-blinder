// Сравнивает OCR-движки на одинаковых картинках в одном и том же браузере:
// Tesseract (текущий прод) против PP-OCRv5 на onnxruntime-web.
//
// Требуется поднятый dev-сервер (npm run dev) — из него берутся и модули
// движков, и локальные веса из public/models (см. fetch-ppocr-models.mjs --bench).
//
// Usage:
//   node scripts/bench-ocr.mjs [--base http://localhost:5173]
//                              [--dir tests/local/ocr-fixtures]
//                              [--engines tesseract,ppocr]
//                              [--out bench-ocr.json]
//
// Рядом с каждым <name>.png должен лежать <name>.txt с эталонным текстом.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { launchChromium } from './launch-browser.mjs'
import { formatRow, printSummary, scoreOne } from './ocr-metrics.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const base = arg('base', 'http://localhost:5173')
const dir = arg('dir', 'tests/local/ocr-fixtures')
const engines = arg('engines', 'tesseract,ppocr').split(',')
const outPath = arg('out', 'bench-ocr.json')
// Длинная сторона для детектора PP-OCR: полезно перебрать на своём корпусе,
// мелкий шрифт на сканах может требовать больше 960.
const detLimit = Number(arg('det-limit', '960'))

// ── Прогон ─────────────────────────────────────────────────────────────────

const images = readdirSync(dir)
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .sort()
if (images.length === 0) {
  console.error(`Нет картинок в ${dir}. Сначала: node scripts/make-ocr-fixtures.mjs`)
  process.exit(1)
}

const browser = await launchChromium()
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.error('  [browser]', m.text())
})
await page.goto(base, { waitUntil: 'domcontentloaded' })

// Прогреваем модули один раз, чтобы компиляция vite не попала в замеры.
await page.evaluate(() => import('/src/lib/ocr/bench.ts'))

const results = []
for (const file of images) {
  const name = basename(file).replace(/\.(png|jpe?g)$/i, '')
  const gold = readFileSync(join(dir, `${name}.txt`), 'utf8')
  const dataUrl = `data:image/png;base64,${readFileSync(join(dir, file)).toString('base64')}`
  console.log(`\n=== ${name}`)

  for (const engine of engines) {
    const out = await page.evaluate(
      async ({ dataUrl, engine, detLimit }) => {
        const mod = await import('/src/lib/ocr/bench.ts')
        const img = new Image()
        img.src = dataUrl
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        canvas.getContext('2d').drawImage(img, 0, 0)

        const loadStart = performance.now()
        const res =
          engine === 'tesseract'
            ? await mod.benchTesseract(canvas, {
                workerPath: '/models/tesseract/worker.min.js',
                corePath: '/models/tesseract/',
                langPath: '/models/tessdata',
              })
            : await mod.benchPpocr(canvas, undefined, { detLimit })
        return { ...res, totalMs: performance.now() - loadStart }
      },
      { dataUrl, engine, detLimit },
    )

    const row = {
      ...scoreOne({ fixture: name, engine, gold, text: out.text, recognizeMs: out.ms }),
      totalMs: Math.round(out.totalMs),
    }
    results.push(row)
    console.log(formatRow(row))
  }
}

await browser.close()

printSummary(results, engines)

writeFileSync(outPath, JSON.stringify({ dir, engines, results }, null, 2))
console.log(`\nПодробности: ${outPath}`)
