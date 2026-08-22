// Скачивает веса PP-OCRv5 в public/models/ppocr/ (каталог в .gitignore —
// бинарники в репозиторий не кладём, ~13 МБ).
//
// Официальные веса PaddleOCR лежат на paddleocr.bj.bcebos.com и Hugging Face
// в формате paddle-inference; здесь берётся готовый ONNX-экспорт из
// PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models (Apache-2.0, как и сам
// PaddleOCR). Файлы там хранятся в git-lfs, поэтому качаем через
// media.githubusercontent.com, а не raw.
//
// Usage: node scripts/fetch-ppocr-models.mjs [--force] [--bench]
//   --bench дополнительно кладёт локально ассеты Tesseract (воркер, core,
//   языковые модели), чтобы scripts/bench-ocr.mjs гонял оба движка без CDN.
import { mkdirSync, existsSync, writeFileSync, statSync, copyFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const REPO = 'PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main'
// Веса лежат в git-lfs и отдаются только media.*; словарь — обычный текстовый
// файл в git, и media.* на него отвечает 404, поэтому он берётся с raw.*.
const LFS = `https://media.githubusercontent.com/media/${REPO}`
const RAW = `https://raw.githubusercontent.com/${REPO}`
const OUT = 'public/models/ppocr'
const force = process.argv.includes('--force')

// Детектор от языка не зависит (DB-сегментация), распознавание — зависит:
// eslav_PP-OCRv5 обучен на восточнославянских языках + латинице, его словарь
// (519 символов) единственный из семейства v5, где вообще есть кириллица.
const FILES = [
  {
    url: `${LFS}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    out: `${OUT}/det.onnx`,
    minBytes: 4_000_000,
  },
  {
    url: `${LFS}/recognition/multi/eslav/v5/eslav_PP-OCRv5_mobile_rec_infer.onnx`,
    out: `${OUT}/rec.onnx`,
    minBytes: 7_000_000,
  },
  {
    url: `${RAW}/recognition/multi/eslav/v5/ppocrv5_eslav_dict.txt`,
    out: `${OUT}/dict.txt`,
    minBytes: 1_000,
  },
]

async function download({ url, out, minBytes }) {
  if (!force && existsSync(out) && statSync(out).size >= minBytes) {
    console.log(`= ${out} (уже на месте, ${statSync(out).size} Б)`)
    return
  }
  mkdirSync(dirname(out), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // git-lfs отдаёт текстовый указатель, если попросить raw вместо media —
  // это самая частая поломка, ловим её сразу, а не в рантайме onnxruntime.
  if (buf.length < minBytes) {
    throw new Error(
      `${url} вернул ${buf.length} Б (ожидалось >= ${minBytes}). Похоже на git-lfs pointer.`,
    )
  }
  writeFileSync(out, buf)
  console.log(`+ ${out} (${(buf.length / 1e6).toFixed(1)} МБ)`)
}

// onnxruntime-web грузит свои .wasm рядом с wasmPaths. По умолчанию проект
// берёт их с jsdelivr (см. ner.worker.ts), но для OCR кладём локально: так
// движок работает в оффлайне и в закрытых сетях, где CDN недоступен.
function copyOrtWasm() {
  const src = 'node_modules/onnxruntime-web/dist'
  const dst = 'public/models/ort'
  if (!existsSync(src)) {
    console.warn(`! ${src} не найден — сначала npm install`)
    return
  }
  mkdirSync(dst, { recursive: true })
  let n = 0
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.wasm') && !/^ort-wasm.*\.mjs$/.test(f)) continue
    copyFileSync(join(src, f), join(dst, f))
    n++
  }
  console.log(`+ ${dst} (${n} файлов onnxruntime-web)`)
}

/**
 * Ассеты Tesseract для офлайн-бенчмарка. Языковые модели берутся из тех же
 * npm-пакетов @tesseract.js-data, что jsdelivr раздаёт приложению в проде
 * (каталог 4.0.0_best_int), — значит базовая линия в бенчмарке считается на
 * байт-в-байт тех же весах, что видит пользователь.
 */
function vendorTesseract() {
  const dst = 'public/models/tesseract'
  const langDst = 'public/models/tessdata'
  mkdirSync(dst, { recursive: true })
  mkdirSync(langDst, { recursive: true })

  copyFileSync('node_modules/tesseract.js/dist/worker.min.js', join(dst, 'worker.min.js'))
  let cores = 0
  for (const f of readdirSync('node_modules/tesseract.js-core')) {
    if (!/\.(wasm|js)$/.test(f)) continue
    copyFileSync(join('node_modules/tesseract.js-core', f), join(dst, f))
    cores++
  }
  console.log(`+ ${dst} (worker + ${cores} файлов tesseract-core)`)
  return langDst
}

async function downloadTessdata(langDst, lang) {
  const out = join(langDst, `${lang}.traineddata.gz`)
  if (!force && existsSync(out) && statSync(out).size > 100_000) {
    console.log(`= ${out} (уже на месте)`)
    return
  }
  const meta = await fetch(`https://registry.npmjs.org/@tesseract.js-data%2F${lang}`)
  if (!meta.ok) throw new Error(`npm registry ${meta.status} для ${lang}`)
  const json = await meta.json()
  const tarball = json.versions[json['dist-tags'].latest].dist.tarball
  const tmp = join(langDst, `${lang}.tgz`)
  const res = await fetch(tarball)
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', [
    'xzf', tmp,
    '-C', langDst,
    '--strip-components=2',
    `package/4.0.0_best_int/${lang}.traineddata.gz`,
  ])
  rmSync(tmp)
  console.log(`+ ${out} (${(statSync(out).size / 1e6).toFixed(1)} МБ)`)
}

for (const f of FILES) await download(f)
copyOrtWasm()

if (process.argv.includes('--bench')) {
  const langDst = vendorTesseract()
  for (const lang of ['rus', 'ukr', 'eng']) await downloadTessdata(langDst, lang)
}
