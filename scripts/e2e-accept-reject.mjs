// B1 DoD: accepting a candidate promotes it to a confirmed entity, rejecting
// a candidate removes it. Seeds a synthetic history doc with two "серая
// зона" candidates straight into IndexedDB, opens it from the History
// panel, then exercises the accept (✓) and reject (✕) controls.
//
// Usage: node scripts/e2e-accept-reject.mjs [baseUrl]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:4173'

function fail(reason) {
  console.error(`ACCEPT-REJECT E2E: FAIL ${reason}`)
  process.exitCode = 1
}

async function expectCount(page, selector, expected, label) {
  const count = await page.locator(selector).count()
  if (count !== expected) {
    fail(`expected ${expected} ${label}, got ${count}`)
    return false
  }
  return true
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const docName = 'Synthetic Accept Reject Doc.docx'

  const seedResult = await page.evaluate((docName) => {
    return new Promise((resolve, reject) => {
      const sourceText = 'Стороны: Alpha Co и Gamma Co заключили договор.'
      const aStart = sourceText.indexOf('Alpha Co')
      const gStart = sourceText.indexOf('Gamma Co')
      if (aStart < 0 || gStart < 0) {
        reject(new Error('synthetic offsets not found'))
        return
      }
      const now = Date.now()
      const doc = {
        id: crypto.randomUUID(),
        name: docName,
        format: 'docx',
        createdAt: now,
        updatedAt: now,
        sourceText,
        entities: [
          {
            id: crypto.randomUUID(),
            type: 'COMPANY',
            value: 'Alpha Co',
            placeholder: '[COMPANY_1]',
            positions: [{ start: aStart, end: aStart + 'Alpha Co'.length }],
            anonymize: false,
            manual: false,
            candidate: true,
            candidateNote: 'Низкая уверенность модели',
          },
          {
            id: crypto.randomUUID(),
            type: 'COMPANY',
            value: 'Gamma Co',
            placeholder: '[COMPANY_2]',
            positions: [{ start: gStart, end: gStart + 'Gamma Co'.length }],
            anonymize: false,
            manual: false,
            candidate: true,
            candidateNote: 'Низкая уверенность модели',
          },
        ],
      }
      const req = indexedDB.open('md-blinder')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('documents', 'readwrite')
        tx.objectStore('documents').put(doc)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
      }
    })
  }, docName)

  if (!seedResult) {
    fail('could not seed history doc into IndexedDB')
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' })

    const row = page.locator('.history-row', { hasText: docName })
    await row.waitFor({ state: 'visible', timeout: 15000 })
    await row.getByRole('button', { name: 'Открыть' }).click()

    await page.waitForSelector('.result', { timeout: 15000 })
    await page.waitForSelector('.candidate-row', { timeout: 15000 })

    const confirmedSelector = '.entity-row:not(.candidate-row)'

    let ok = true
    ok = (await expectCount(page, '.candidate-row', 2, 'candidate rows')) && ok
    ok = (await expectCount(page, confirmedSelector, 0, 'confirmed rows')) && ok

    // Accept the first candidate -> it should move into the confirmed list.
    await page.locator('.candidate-row .entity-accept').first().click()
    await page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length === 1,
      confirmedSelector,
      { timeout: 10000 },
    ).catch(() => {})
    ok = (await expectCount(page, '.candidate-row', 1, 'candidate rows after accept')) && ok
    ok = (await expectCount(page, confirmedSelector, 1, 'confirmed rows after accept')) && ok

    // Reject the remaining candidate -> it should simply disappear.
    await page.locator('.candidate-row .entity-delete').click()
    await page.waitForFunction(
      () => document.querySelectorAll('.candidate-row').length === 0,
      { timeout: 10000 },
    ).catch(() => {})
    ok = (await expectCount(page, '.candidate-row', 0, 'candidate rows after reject')) && ok
    ok = (await expectCount(page, confirmedSelector, 1, 'confirmed rows after reject')) && ok

    if (!ok) {
      // individual expectCount calls already invoked fail() with details
    }
  }

  await context.close()
} catch (e) {
  fail(String(e && e.stack ? e.stack : e))
} finally {
  await browser.close()
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
console.error('ACCEPT-REJECT E2E: PASS')
process.exit(0)
