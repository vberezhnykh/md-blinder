// Regression check for the "rejected candidate reappears on control pass" bug.
// A dismissed candidate must stay dismissed across "Контрольная проверка", while
// a genuinely new match still surfaces. Uses EMAIL because the structural regex
// detector finds it offline (deterministic, no NER/network dependency).
//
// Usage: node scripts/e2e-dismiss-persist.mjs [baseUrl]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:4173'

function fail(reason) {
  console.error(`DISMISS-PERSIST E2E: FAIL ${reason}`)
  process.exitCode = 1
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const docName = 'Synthetic Dismiss Persist Doc.docx'

  const seeded = await page.evaluate((docName) => {
    return new Promise((resolve, reject) => {
      const sourceText = 'Контакты: ivan@example.com и petr@example.com для связи.'
      const iStart = sourceText.indexOf('ivan@example.com')
      if (iStart < 0) {
        reject(new Error('synthetic offset not found'))
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
        // Only ivan@ is seeded as a grey-zone candidate. petr@ is unknown to the
        // app and must be discovered fresh by the control pass.
        entities: [
          {
            id: crypto.randomUUID(),
            type: 'EMAIL',
            value: 'ivan@example.com',
            placeholder: '[EMAIL_1]',
            positions: [{ start: iStart, end: iStart + 'ivan@example.com'.length }],
            anonymize: false,
            manual: false,
            candidate: true,
            candidateNote: 'Найдено на контрольном проходе',
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

  if (!seeded) {
    fail('could not seed history doc')
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' })

    const row = page.locator('.history-row', { hasText: docName })
    await row.waitFor({ state: 'visible', timeout: 15000 })
    await row.getByRole('button', { name: 'Открыть' }).click()

    await page.waitForSelector('.result', { timeout: 15000 })
    await page.waitForSelector('.candidate-row', { timeout: 15000 })

    const candidateTexts = () =>
      page.locator('.candidate-row .cell-value').allInnerTexts()

    // Precondition: exactly the ivan@ candidate is showing.
    let cands = await candidateTexts()
    if (!(cands.length === 1 && cands[0].includes('ivan@example.com'))) {
      fail(`precondition: expected only ivan@ candidate, got ${JSON.stringify(cands)}`)
    }

    // Reject ivan@ -> it should disappear from the candidate list.
    await page.locator('.candidate-row .entity-delete').click()
    await page
      .waitForFunction(() => document.querySelectorAll('.candidate-row').length === 0, {
        timeout: 10000,
      })
      .catch(() => {})

    // Run the control pass. NER may or may not load (network); structural EMAIL
    // detection runs regardless. Wait for the pass to finish (button re-enables).
    const controlBtn = page.getByRole('button', { name: 'Контрольная проверка' })
    await controlBtn.click()
    await page
      .waitForSelector('.second-pass-info', { timeout: 120000 })
      .catch(() => {})
    await page
      .waitForFunction(
        () => {
          const b = [...document.querySelectorAll('button')].find((x) =>
            /Контрольная проверка/.test(x.textContent || ''),
          )
          return b && !b.disabled
        },
        { timeout: 120000 },
      )
      .catch(() => {})

    // The decisive assertions:
    cands = await candidateTexts()
    const ivanBack = cands.some((t) => t.includes('ivan@example.com'))
    const petrFound = cands.some((t) => t.includes('petr@example.com'))

    if (ivanBack) {
      fail(`rejected candidate ivan@ reappeared after control pass: ${JSON.stringify(cands)}`)
    }
    if (!petrFound) {
      fail(`control pass did not surface the new petr@ email — pass may not have run: ${JSON.stringify(cands)}`)
    }
    if (!ivanBack && petrFound) {
      console.error(`DISMISS-PERSIST E2E: candidates after control pass = ${JSON.stringify(cands)}`)
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
console.error('DISMISS-PERSIST E2E: PASS')
process.exit(0)
