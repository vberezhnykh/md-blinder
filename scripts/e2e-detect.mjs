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

for (const file of files) {
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
  const deadline = Date.now() + 360000
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500)
    const loading = await page.$('.status-loading').then((el) => !!el)
    const result = await page.$('.result').then((el) => !!el)
    const err = await page.$('.status.error').then((el) => !!el)
    if (loading) sawLoading = true
    if (!loading && (result || err) && (sawLoading || err)) {
      finished = true
      break
    }
  }
  // let React settle the entity list after the result appears
  await page.waitForTimeout(1000)

  const errText = await page.$eval('.status.error', (el) => el.textContent).catch(() => null)
  const nerNotice = await page.$('.ner-notice').then((el) => !!el)

  const entities = await page.$$eval('.entity-row', (rows) =>
    rows.map((row) => ({
      placeholder: row.querySelector('.cell-placeholder')?.textContent?.trim() ?? '',
      type: row.querySelector('select')?.value ?? '',
      value: row.querySelector('.cell-value')?.textContent?.trim() ?? '',
      count: Number(row.querySelector('.cell-count')?.textContent?.trim() ?? '0'),
    })),
  )

  results[basename(file)] = {
    finished,
    error: errText,
    nerNotice,
    entities,
    pageErrors: errors.slice(0, 10),
  }

  await context.close()
  console.error(`[done] ${basename(file)} -> ${entities.length} entities${errText ? ' (ERROR: ' + errText + ')' : ''}`)
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
