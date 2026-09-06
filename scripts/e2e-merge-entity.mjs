// Functional check for "merge two entities". Seeds a doc with a full company name
// [COMPANY_1] "Tripath Technology, Inc." and a short form [COMPANY_2] "Tripath"
// (2 occurrences), merges the short into the full, and asserts one COMPANY entity
// remains under [COMPANY_1] with the combined occurrence count and no [COMPANY_2].
//
// Usage: node scripts/e2e-merge-entity.mjs [baseUrl]
import { chromium } from 'playwright'
const baseUrl = process.argv[2] || 'http://localhost:4181'
let failed = false
const fail = (m) => { console.error(`MERGE-ENTITY E2E: FAIL ${m}`); failed = true }

const browser = await chromium.launch()
try {
  const page = await (await browser.newContext()).newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  const docName = 'Synthetic Merge Doc.docx'
  const FULL = 'ent-full', SHORT = 'ent-short'
  await page.evaluate(({ docName, FULL, SHORT }) => new Promise((res, rej) => {
    const t = 'Договор с Tripath Technology, Inc. Далее Tripath поставляет чипы, и Tripath отвечает за качество.'
    const fullS = t.indexOf('Tripath Technology, Inc.')
    const p1 = t.indexOf('Tripath', fullS + 'Tripath Technology, Inc.'.length)
    const p2 = t.indexOf('Tripath', p1 + 7)
    const doc = { id: crypto.randomUUID(), name: docName, format: 'docx', createdAt: Date.now(), updatedAt: Date.now(), sourceText: t,
      entities: [
        { id: FULL, type: 'COMPANY', value: 'Tripath Technology, Inc.', placeholder: '[COMPANY_1]', positions: [{ start: fullS, end: fullS + 'Tripath Technology, Inc.'.length }], anonymize: true, manual: false },
        { id: SHORT, type: 'COMPANY', value: 'Tripath', placeholder: '[COMPANY_2]', positions: [{ start: p1, end: p1 + 7 }, { start: p2, end: p2 + 7 }], anonymize: true, manual: false },
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
  }), { docName, FULL, SHORT })

  await page.reload({ waitUntil: 'domcontentloaded' })
  const hrow = page.locator('.history-row', { hasText: docName })
  await hrow.waitFor({ state: 'visible', timeout: 15000 })
  await hrow.getByRole('button', { name: 'Открыть' }).click()
  await page.waitForSelector('.cm-entity-COMPANY', { timeout: 15000 })

  const confirmed = '.entity-row:not(.candidate-row)'
  if ((await page.locator(confirmed).count()) !== 2) fail(`expected 2 confirmed rows, got ${await page.locator(confirmed).count()}`)

  // On the [COMPANY_2] "Tripath" row, click merge, pick [COMPANY_1] as target, confirm.
  const shortRow = page.locator(confirmed, { hasText: '[COMPANY_2]' })
  const mergeBtn = shortRow.locator('.entity-merge')
  if ((await mergeBtn.count()) < 1) fail('merge button not shown on the row (should appear with 2 same-type entities)')
  await mergeBtn.click()
  await shortRow.locator('.merge-target').selectOption(FULL)
  await shortRow.locator('.entity-merge-edit .entity-accept').click()
  await page.waitForTimeout(300)

  const rowsAfter = await page.locator(confirmed).count()
  const placeholders = await page.locator(`${confirmed} .cell-placeholder`).allInnerTexts()
  const count = (await page.locator(confirmed, { hasText: '[COMPANY_1]' }).locator('.cell-count').innerText()).trim()
  console.error(`MERGE-ENTITY E2E: rows 2->${rowsAfter}, placeholders ${JSON.stringify(placeholders)}, [COMPANY_1] count=${count}`)
  if (rowsAfter !== 1) fail(`expected 1 row after merge, got ${rowsAfter}`)
  if (placeholders.some((p) => /COMPANY_2/.test(p))) fail('[COMPANY_2] still present after merge')
  if (!placeholders.some((p) => /COMPANY_1/.test(p))) fail('[COMPANY_1] missing after merge')
  if (count !== '3') fail(`expected merged occurrence count 3, got ${count}`)

  await browser.close()
} catch (e) { fail(String(e && e.stack ? e.stack : e)); await browser.close() }
if (failed) process.exit(1)
console.error('MERGE-ENTITY E2E: PASS')
process.exit(0)
