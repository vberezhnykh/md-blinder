// Functional check for the in-editor merge popup. Seeds two same-type COMPANY
// entities, clicks an entity highlight in the editor (→ active span → "↦
// Объединить" button appears), opens it, picks the other entity as target, and
// asserts the two folded into one.
//
// Usage: node scripts/e2e-merge-editor.mjs [baseUrl]
import { chromium } from 'playwright'
const baseUrl = process.argv[2] || 'http://localhost:4181'
let failed = false
const fail = (m) => { console.error(`MERGE-EDITOR E2E: FAIL ${m}`); failed = true }

const browser = await chromium.launch()
try {
  const page = await (await browser.newContext()).newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  const docName = 'Synthetic Merge Editor Doc.docx'
  await page.evaluate((docName) => new Promise((res, rej) => {
    const t = 'Договор с Tripath Technology, Inc. Далее Tripath поставляет чипы, и Tripath отвечает за качество.'
    const fullS = t.indexOf('Tripath Technology, Inc.')
    const p1 = t.indexOf('Tripath', fullS + 24); const p2 = t.indexOf('Tripath', p1 + 7)
    const doc = { id: crypto.randomUUID(), name: docName, format: 'docx', createdAt: Date.now(), updatedAt: Date.now(), sourceText: t, entities: [
      { id: 'f', type: 'COMPANY', value: 'Tripath Technology, Inc.', placeholder: '[COMPANY_1]', positions: [{ start: fullS, end: fullS + 24 }], anonymize: true, manual: false },
      { id: 's', type: 'COMPANY', value: 'Tripath', placeholder: '[COMPANY_2]', positions: [{ start: p1, end: p1 + 7 }, { start: p2, end: p2 + 7 }], anonymize: true, manual: false },
    ] }
    const r = indexedDB.open('md-blinder'); r.onerror = () => rej(r.error)
    r.onsuccess = () => {
      const db = r.result
      const tx = db.transaction(['documents', 'documentMeta'], 'readwrite')
      tx.objectStore('documents').put(doc)
      tx.objectStore('documentMeta').put({ id: doc.id, name: doc.name, format: doc.format, createdAt: doc.createdAt, updatedAt: doc.updatedAt, entityCount: doc.entities.length })
      tx.oncomplete = () => { db.close(); res() }
      tx.onabort = tx.onerror = () => { db.close(); rej(tx.error) }
    }
  }), docName)

  await page.reload({ waitUntil: 'domcontentloaded' })
  const hrow = page.locator('.history-row', { hasText: docName })
  await hrow.waitFor({ state: 'visible', timeout: 15000 })
  await hrow.getByRole('button', { name: 'Открыть' }).click()
  await page.waitForSelector('.cm-entity-COMPANY', { timeout: 15000 })
  const confirmed = '.entity-row:not(.candidate-row)'
  if ((await page.locator(confirmed).count()) !== 2) fail('expected 2 confirmed rows before merge')

  // Click a COMPANY highlight in the text → active span → merge button.
  await page.locator('.cm-entity-COMPANY').first().click()
  const openBtn = page.locator('.cm-merge-open')
  await openBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if ((await openBtn.count()) < 1) fail('"↦ Объединить" button did not appear after clicking an entity')
  await openBtn.click()
  // Pick the other same-type entity as the target.
  const sel = page.locator('.cm-merge-select')
  const optionValues = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean))
  if (optionValues.length < 1) fail('no merge targets in the picker')
  await sel.selectOption(optionValues[0])
  await page.waitForTimeout(400)

  const rowsAfter = await page.locator(confirmed).count()
  const placeholders = await page.locator(`${confirmed} .cell-placeholder`).allInnerTexts()
  console.error(`MERGE-EDITOR E2E: rows 2->${rowsAfter}, placeholders ${JSON.stringify(placeholders)}`)
  if (rowsAfter !== 1) fail(`expected 1 row after merge, got ${rowsAfter}`)
  const remaining = placeholders.filter((p) => /COMPANY_/.test(p))
  if (remaining.length !== 1) fail(`expected exactly one COMPANY placeholder left, got ${JSON.stringify(placeholders)}`)

  await browser.close()
} catch (e) { fail(String(e && e.stack ? e.stack : e)); await browser.close() }
if (failed) process.exit(1)
console.error('MERGE-EDITOR E2E: PASS')
process.exit(0)
