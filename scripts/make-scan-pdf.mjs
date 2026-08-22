// Собирает из PNG-фикстур image-only PDF — такой же, какой получается при
// сканировании договора: страницы-картинки без текстового слоя. Нужен, чтобы
// прогонять весь конвейер приложения (классификация страниц -> OCR -> NER), а
// не только сам движок OCR.
//
// Usage: node scripts/make-scan-pdf.mjs [inDir] [outFile]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchChromium } from './launch-browser.mjs'

const inDir = process.argv[2] ?? 'tests/local/ocr-fixtures'
const outFile = process.argv[3] ?? 'tests/local/ocr-fixtures/scan.pdf'

const files = readdirSync(inDir).filter((f) => f.endsWith('.png')).sort()
if (files.length === 0) {
  console.error(`Нет PNG в ${inDir}`)
  process.exit(1)
}

// PNG в PDF пришлось бы перекодировать во Flate по полосам; JPEG вставляется
// как есть через DCTDecode, поэтому конвертируем картинки в браузере.
const browser = await launchChromium()
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const images = []
for (const file of files) {
  const dataUrl = `data:image/png;base64,${readFileSync(join(inDir, file)).toString('base64')}`
  const jpeg = await page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const canvas = document.getElementById('c')
    canvas.width = img.width
    canvas.height = img.height
    canvas.getContext('2d').drawImage(img, 0, 0)
    return {
      data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1],
      width: img.width,
      height: img.height,
    }
  }, dataUrl)
  images.push({ ...jpeg, bytes: Buffer.from(jpeg.data, 'base64') })
}
await browser.close()

// ── Минимальный писатель PDF ───────────────────────────────────────────────
const chunks = []
let length = 0
const offsets = []

function push(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'binary')
  chunks.push(b)
  length += b.length
}

function obj(num, body, stream) {
  offsets[num] = length
  push(`${num} 0 obj\n${body}\n`)
  if (stream) {
    push('stream\n')
    push(stream)
    push('\nendstream\n')
  }
  push('endobj\n')
}

push('%PDF-1.4\n')

const pageIds = images.map((_, i) => 3 + i * 3)
obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`)

images.forEach((img, i) => {
  const pageId = pageIds[i]
  const imgId = pageId + 1
  const contentId = pageId + 2
  obj(
    pageId,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${img.width} ${img.height}] ` +
      `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`,
  )
  obj(
    imgId,
    `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`,
    img.bytes,
  )
  const content = `q ${img.width} 0 0 ${img.height} 0 0 cm /Im0 Do Q`
  obj(contentId, `<< /Length ${content.length} >>`, Buffer.from(content, 'latin1'))
})

const maxId = pageIds[pageIds.length - 1] + 2
const xrefStart = length
push(`xref\n0 ${maxId + 1}\n`)
push('0000000000 65535 f \n')
for (let i = 1; i <= maxId; i++) {
  push(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`)
}
push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

writeFileSync(outFile, Buffer.concat(chunks))
console.log(`+ ${outFile} (${images.length} стр., ${(length / 1024).toFixed(0)} КБ)`)
