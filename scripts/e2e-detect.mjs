// Drives the real MD Blinder UI in a headless browser, uploads a file,
// waits for the full pipeline (extract -> regex -> NER) to finish, and
// prints the detected entities as JSON.
//
// Usage: node scripts/e2e-detect.mjs <baseUrl> <file1> [file2 ...]
import { chromium } from 'playwright'
import { basename } from 'node:path'

const baseUrl = process.argv[2]
const files = process.argv.slice(3)
if (!baseUrl || files.length === 0) {
  console.error('Usage: node scripts/e2e-detect.mjs <baseUrl> <file...>')
  process.exit(1)
}

const browser = await chromium.launch()
const results = {}

let fileIndex = 0
for (const file of files) {
  fileIndex++
  console.error(`[start] (${fileIndex}/${files.length}) ${basename(file)}`)
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  // Upload the file into the hidden <input type=file>
  await page.setInputFiles('input[type=file]', file)

  // Wait until processing actually starts (loading spinner appears), then
  // until it finishes (spinner gone AND a result/error is shown). Polling by
  // hand — mirrors the proven debug flow. NER can take ~2 min per file.
  let sawLoading = false
  let finished = false
  const started = Date.now()
  const deadline = started + 360000
  let lastBeat = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500)
    const loading = await page.$('.status-loading').then((el) => !!el)
    const result = await page.$('.result').then((el) => !!el)
    const err = await page.$('.status.error').then((el) => !!el)
    if (loading) sawLoading = true
    // Heartbeat every ~10s so a long NER run visibly progresses (and a hang is obvious).
    const elapsed = Math.round((Date.now() - started) / 1000)
    if (elapsed - lastBeat >= 10) {
      lastBeat = elapsed
      const phase = loading ? 'processing' : sawLoading ? 'settling' : 'uploading'
      console.error(`  ...${basename(file)} [${phase}] ${elapsed}s elapsed`)
    }
    if (!loading && (result || err) && (sawLoading || err)) {
      finished = true
      break
    }
  }
  // let React settle the entity list after the result appears
  await page.waitForTimeout(1000)

  const errText = await page.$eval('.status.error', (el) => el.textContent).catch(() => null)
  const nerNotice = await page.$('.ner-notice').then((el) => !!el)

  // Confirmed detections only — candidate rows also carry the .entity-row
  // class, so they must be excluded here to stay comparable to the
  // pre-stage-5 baseline (which only ever saw confirmed entities).
  const entities = await page.$$eval('.entity-row:not(.candidate-row)', (rows) =>
    rows.map((row) => ({
      placeholder: row.querySelector('.cell-placeholder')?.textContent?.trim() ?? '',
      type: row.querySelector('select')?.value ?? '',
      value: row.querySelector('.cell-value')?.textContent?.trim() ?? '',
      count: Number(row.querySelector('.cell-count')?.textContent?.trim() ?? '0'),
    })),
  )

  // Gray-zone review candidates (Stage 5) — tracked separately from `entities`.
  const candidates = await page.$$eval('.candidate-row', (rows) =>
    rows.map((row) => ({
      type: row.querySelector('select')?.value ?? '',
      value: row.querySelector('.cell-value')?.textContent?.trim() ?? '',
    })),
  )

  // Read back the app's persisted sourceText from IndexedDB (best-effort).
  // Give the app's initial putDoc a moment to commit before we look.
  await page.waitForTimeout(500)
  const sourceText = await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          try {
            const req = indexedDB.open('md-blinder')
            req.onerror = () => resolve(null)
            req.onsuccess = () => {
              const db = req.result
              try {
                const tx = db.transaction('documents', 'readonly')
                const store = tx.objectStore('documents')
                const getAllReq = store.getAll()
                getAllReq.onerror = () => resolve(null)
                getAllReq.onsuccess = () => {
                  const records = getAllReq.result || []
                  if (!records.length) return resolve('')
                  let best = records[0]
                  for (const r of records) {
                    if ((r.updatedAt || 0) > (best.updatedAt || 0)) best = r
                  }
                  resolve(best.sourceText ?? '')
                }
              } catch {
                resolve(null)
              }
            }
          } catch {
            resolve(null)
          }
        }),
    )
    .catch(() => null)

  results[basename(file)] = {
    finished,
    error: errText,
    nerNotice,
    entities,
    candidates,
    sourceText,
    pageErrors: errors.slice(0, 10),
  }

  await context.close()
  console.error(`[done] ${basename(file)} -> ${entities.length} entities +${candidates.length} candidates${errText ? ' (ERROR: ' + errText + ')' : ''}`)
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
