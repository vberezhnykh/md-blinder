// Functional check for "attach selection to an existing entity". Seeds a doc
// where a COMPANY ("Acme") is tracked as [COMPANY_1] at its first occurrence but
// a second identical occurrence is untracked. Selects the untracked word, picks
// [COMPANY_1] in the popup's "Куда" select, clicks «Добавить», and asserts the entity now
// has 2 occurrences under the SAME placeholder (no new [COMPANY_2]).
//
// Usage: node scripts/e2e-attach-entity.mjs [baseUrl]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:4181'
let failed = false
const fail = (m) => { console.error(`ATTACH-ENTITY E2E: FAIL ${m}`); failed = true }

const browser = await chromium.launch()
try {
  const page = await (await browser.newContext()).newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const docName = 'Synthetic Attach Entity Doc.docx'
  const ENT_ID = 'ent-acme-fixed'
  await page.evaluate(({ docName, ENT_ID }) => new Promise((resolve, reject) => {
    const sourceText = 'Acme signed the deal. Later that year Acme confirmed it.'
    const first = sourceText.indexOf('Acme')
    const doc = {
      id: crypto.randomUUID(), name: docName, format: 'docx',
      createdAt: Date.now(), updatedAt: Date.now(), sourceText,
      entities: [{
        id: ENT_ID, type: 'COMPANY', value: 'Acme', placeholder: '[COMPANY_1]',
        positions: [{ start: first, end: first + 'Acme'.length }],
        anonymize: true, manual: false,
      }],
    }
    const req = indexedDB.open('md-blinder')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['documents', 'documentMeta'], 'readwrite')
      tx.objectStore('documents').put(doc)
      tx.objectStore('documentMeta').put({ id: doc.id, name: doc.name, format: doc.format, createdAt: doc.createdAt, updatedAt: doc.updatedAt, entityCount: doc.entities.length })
      tx.oncomplete = () => { db.close(); resolve(true) }
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error) }
    }
  }), { docName, ENT_ID })

  await page.reload({ waitUntil: 'domcontentloaded' })
  const row = page.locator('.history-row', { hasText: docName })
  await row.waitFor({ state: 'visible', timeout: 15000 })
  await row.getByRole('button', { name: 'Открыть' }).click()
  await page.waitForSelector('.cm-entity-COMPANY', { timeout: 15000 })

  // Preconditions: one COMPANY row, [COMPANY_1], count 1.
  const rowsBefore = await page.locator('.entity-row:not(.candidate-row)').count()
  const countBefore = (await page.locator('.entity-row:not(.candidate-row) .cell-count').first().innerText()).trim()
  if (rowsBefore !== 1) fail(`expected 1 confirmed entity, got ${rowsBefore}`)
  if (countBefore !== '1') fail(`expected occurrence count 1, got ${countBefore}`)

  // Find the SECOND "Acme" in the editor DOM and double-click it to select it.
  const coords = await page.evaluate(() => {
    const root = document.querySelector('.cm-content')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let seen = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const idx = n.textContent.indexOf('Acme')
      if (idx === -1) continue
      seen++
      if (seen < 2) continue // want the second occurrence
      const range = document.createRange()
      range.setStart(n, idx); range.setEnd(n, idx + 4)
      const r = range.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    return null
  })
  if (!coords) { fail('could not locate second "Acme"'); throw new Error('no coords') }
  await page.mouse.dblclick(coords.x, coords.y)

  const popup = page.locator('.cm-add-popup')
  await popup.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (!(await popup.count())) { fail('add-from-selection popup did not appear on double-click'); throw new Error('no popup') }

  // The target list is filtered by the selected type — set the popup's TYPE
  // select to COMPANY first so [COMPANY_1] appears as a target option.
  await popup.locator('select:not(.cm-add-popup-target)').first().selectOption('COMPANY')
  // Pick [COMPANY_1] as the attach target, then click «Добавить».
  await page.locator('.cm-add-popup-target').selectOption(ENT_ID)
  await popup.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.waitForTimeout(400)

  // Postconditions: still ONE COMPANY row, still [COMPANY_1], count now 2, no [COMPANY_2].
  const rowsAfter = await page.locator('.entity-row:not(.candidate-row)').count()
  const placeholders = await page.locator('.entity-row:not(.candidate-row) .cell-placeholder').allInnerTexts()
  const countAfter = (await page.locator('.entity-row:not(.candidate-row) .cell-count').first().innerText()).trim()
  console.error(`ATTACH-ENTITY E2E: rows ${rowsBefore}->${rowsAfter}, count ${countBefore}->${countAfter}, placeholders ${JSON.stringify(placeholders)}`)
  if (rowsAfter !== 1) fail(`expected still 1 entity after attach, got ${rowsAfter}`)
  if (countAfter !== '2') fail(`expected occurrence count 2 after attach, got ${countAfter}`)
  if (placeholders.some((p) => /COMPANY_2/.test(p))) fail('a new [COMPANY_2] was created instead of attaching')
  if (!placeholders.some((p) => /COMPANY_1/.test(p))) fail('[COMPANY_1] missing after attach')

  await browser.close()
} catch (e) {
  fail(String(e && e.stack ? e.stack : e))
  await browser.close()
}

if (failed) process.exit(1)
console.error('ATTACH-ENTITY E2E: PASS')
process.exit(0)
