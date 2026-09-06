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
// One context for the whole run: Cache Storage (the ~580MB NER model) persists
// across files, so it downloads once instead of being re-fetched per file. A
// fresh page per file still gives clean React state; the persisted read below
// picks the newest IndexedDB doc, so accumulated history can't skew a result.
const context = await browser.newContext()
const results = {}

let fileIndex = 0
for (const file of files) {
  fileIndex++
  // Marks when this file's run began. If this file's own upload/processing
  // errors out (or never writes a doc), the persisted-read below must not
  // silently fall back to a stale record left by a previous file in the
  // shared IndexedDB — that would attribute the wrong entities to this file.
  const fileStart = Date.now()
  console.error(`[start] (${fileIndex}/${files.length}) ${basename(file)}`)
  const page = await context.newPage()
  const errors = []
  let nerTiming = null
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error') errors.push(t)
    if (t.includes('[ner] timing')) nerTiming = t // e.g. "[ner] timing EP=wasm chunks=35 nerMs=220694"
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  // Upload the file into the hidden <input type=file>
  await page.locator('input[type=file][accept=".docx,.pdf"]').setInputFiles(file)

  // Wait until processing actually starts (loading spinner appears), then
  // until it finishes (spinner gone AND a result/error is shown). Polling by
  // hand — mirrors the proven debug flow. NER can take ~2 min per file.
  let sawLoading = false
  let finished = false
  const started = Date.now()
  // Large real-world contracts (long RU annexes) + the heavier multilingual
  // model can exceed the old 6-min cap; allow an override via E2E_DEADLINE_MS.
  const deadline = started + Number(process.env.E2E_DEADLINE_MS || 360000)
  let lastBeat = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500)
    const loading = await page.$('.status-loading').then((el) => !!el)
    const result = await page.locator('.result').isVisible()
    const err = await page.$('.status.error').then((el) => !!el)
    if (loading) sawLoading = true
    // Heartbeat every ~10s so a long NER run visibly progresses (and a hang is obvious).
    const elapsed = Math.round((Date.now() - started) / 1000)
    if (elapsed - lastBeat >= 10) {
      lastBeat = elapsed
      const phase = loading ? 'processing' : sawLoading ? 'settling' : 'uploading'
      console.error(`  ...${basename(file)} [${phase}] ${elapsed}s elapsed`)
    }
    if (!loading && (result || err)) {
      finished = true
      break
    }
  }
  // let React settle the entity list after the result appears
  await page.waitForTimeout(1000)

  const errText = await page.$eval('.status.error', (el) => el.textContent).catch(() => null)
  const nerNotice = await page.locator('.ner-notice').filter({ hasText: 'NER-модель' }).count().then((count) => count > 0)
  const anonymizedText = await page.$eval('.anonymized-preview', (el) => el.textContent).catch(() => null)

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

  // Read back the app's persisted sourceText + scored entities from IndexedDB
  // (best-effort). `scored` carries the per-group NER confidence (structural
  // matches have score undefined) so an offline threshold sweep (C3) can
  // reclassify confirmed-vs-candidate without re-running NER. Give the app's
  // initial putDoc a moment to commit before we look.
  await page.waitForFunction(() => document.querySelector('.compact-bar [role="status"]')?.textContent === 'Сохранено в браузере', null, { timeout: 10000 }).catch(() => {})
  const persisted = await page
    .evaluate(
      ({ minUpdatedAt, fileName }) =>
        new Promise((resolve) => {
          let db = null
          let settled = false
          const finish = (value) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            db?.close()
            resolve(value)
          }
          const timeout = setTimeout(() => finish(null), 10000)
          try {
            const req = indexedDB.open('md-blinder')
            req.onerror = () => finish(null)
            req.onblocked = () => finish(null)
            req.onsuccess = () => {
              db = req.result
              if (settled) { db.close(); return }
              try {
                const tx = db.transaction('documents', 'readonly')
                const store = tx.objectStore('documents')
                const getAllReq = store.getAll()
                let captured = null
                tx.oncomplete = () => finish(captured)
                tx.onabort = tx.onerror = () => finish(null)
                getAllReq.onerror = () => finish(null)
                getAllReq.onsuccess = () => {
                  const records = getAllReq.result || []
                  // Only records written by THIS file's run are eligible —
                  // anything older is a stale doc from a previous file that
                  // shared this IndexedDB context and must be ignored.
                  const fresh = records.filter((r) => r.name === fileName && (r.updatedAt || 0) >= minUpdatedAt)
                  if (!fresh.length) return
                  let best = fresh[0]
                  for (const r of fresh) {
                    if ((r.updatedAt || 0) > (best.updatedAt || 0)) best = r
                  }
                  const scored = (best.entities || []).map((e) => ({
                    type: e.type,
                    value: e.value,
                    score: typeof e.score === 'number' ? e.score : null,
                    candidate: e.candidate === true,
                    anonymize: e.anonymize === true,
                    dismissed: e.dismissed === true,
                    placeholder: e.placeholder,
                    positions: Array.isArray(e.positions) ? e.positions : [],
                  }))
                  captured = { sourceText: best.sourceText ?? '', scored }
                }
              } catch {
                finish(null)
              }
            }
          } catch {
            finish(null)
          }
        }),
      { minUpdatedAt: fileStart, fileName: basename(file) },
    )
    .catch(() => null)
  const sourceText = persisted?.sourceText ?? null
  const scored = persisted?.scored ?? []

  results[basename(file)] = {
    finished,
    error: errText,
    nerNotice,
    nerTiming,
    entities,
    candidates,
    sourceText,
    anonymizedText,
    scored,
    pageErrors: errors.slice(0, 10),
  }

  await page.close()
  console.error(`[done] ${basename(file)} -> ${entities.length} entities +${candidates.length} candidates${errText ? ' (ERROR: ' + errText + ')' : ''}`)
}

await context.close()
await browser.close()
console.log(JSON.stringify(results, null, 2))
