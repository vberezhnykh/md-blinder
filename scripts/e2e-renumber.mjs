// Deleting an entity must close the hole it leaves in the placeholder
// numbering ("[PERSON_1], [PERSON_4]" → "[PERSON_1], [PERSON_2]"). Seeds a
// synthetic history doc with four PERSON entities straight into IndexedDB,
// opens it from the History panel, deletes two of them and checks both the
// entity list and the replacement table.
//
// Usage: node scripts/e2e-renumber.mjs [baseUrl]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:4173'

function fail(reason) {
  console.error(`RENUMBER E2E: FAIL ${reason}`)
  process.exitCode = 1
}

async function placeholders(page, selector) {
  return page.locator(selector).allTextContents()
}

function expectSame(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) {
    fail(`${label}: expected ${b}, got ${a}`)
    return false
  }
  return true
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const docName = 'Synthetic Renumber Doc.docx'

  const seedResult = await page.evaluate((docName) => {
    return new Promise((resolve, reject) => {
      const names = ['Anna Adams', 'Boris Blume', 'Clara Cole', 'Dmitri Dorn']
      const sourceText = `Подписали: ${names.join(', ')}.`
      const now = Date.now()
      const entities = names.map((name, i) => {
        const start = sourceText.indexOf(name)
        if (start < 0) throw new Error(`offset for ${name} not found`)
        return {
          id: crypto.randomUUID(),
          type: 'PERSON',
          value: name,
          placeholder: `[PERSON_${i + 1}]`,
          positions: [{ start, end: start + name.length }],
          anonymize: true,
          manual: false,
        }
      })
      const doc = {
        id: crypto.randomUUID(),
        name: docName,
        format: 'docx',
        createdAt: now,
        updatedAt: now,
        sourceText,
        entities,
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
    const listPlaceholder = '.entity-row .entity-meta .cell-placeholder'
    const tablePlaceholder = '.replacement-table .cell-placeholder'
    await page.waitForSelector(listPlaceholder, { timeout: 15000 })

    // Each expectSame() sets the exit code via fail() on mismatch, so the
    // checks just run in sequence.
    expectSame(
      await placeholders(page, listPlaceholder),
      ['[PERSON_1]', '[PERSON_2]', '[PERSON_3]', '[PERSON_4]'],
      'seeded list',
    )

    // Delete the SECOND entity: 3 and 4 must shift down to 2 and 3.
    await page.locator('.entity-row .entity-delete').nth(1).click()
    await page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length === 3,
      listPlaceholder,
      { timeout: 10000 },
    ).catch(() => {})

    expectSame(
      await placeholders(page, listPlaceholder),
      ['[PERSON_1]', '[PERSON_2]', '[PERSON_3]'],
      'list after deleting the 2nd entity',
    )
    expectSame(
      await placeholders(page, tablePlaceholder),
      ['[PERSON_1]', '[PERSON_2]', '[PERSON_3]'],
      'replacement table after deleting the 2nd entity',
    )

    // Delete the first one too — the rest must stay dense.
    await page.locator('.entity-row .entity-delete').first().click()
    await page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length === 2,
      listPlaceholder,
      { timeout: 10000 },
    ).catch(() => {})

    expectSame(
      await placeholders(page, listPlaceholder),
      ['[PERSON_1]', '[PERSON_2]'],
      'list after deleting the 1st entity',
    )
    expectSame(
      await placeholders(page, tablePlaceholder),
      ['[PERSON_1]', '[PERSON_2]'],
      'replacement table after deleting the 1st entity',
    )

    // The anonymized output must use the new numbers, with no stale [PERSON_3].
    // It only renders once the view is switched away from the editor.
    await page.locator('.view-toggle button').nth(1).click()
    const anonymized = await page
      .locator('.anonymized-preview')
      .first()
      .textContent({ timeout: 10000 })
    if (!anonymized || !anonymized.includes('[PERSON_1]') || !anonymized.includes('[PERSON_2]')) {
      fail(`anonymized text is missing the renumbered placeholders: ${anonymized}`)
    }
    if (anonymized && anonymized.includes('[PERSON_3]')) {
      fail(`anonymized text still carries a stale placeholder: ${anonymized}`)
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
console.error('RENUMBER E2E: PASS')
