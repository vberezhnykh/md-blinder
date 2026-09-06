// B5 DoD: export is blocked by a soft-confirmation dialog when unreviewed
// candidates ("серая зона") still exist. Seeds a synthetic history doc
// straight into IndexedDB (one confirmed entity + one candidate entity),
// opens it from the History panel, triggers the export gate, and checks
// both the "cancel" and "export anyway" paths.
//
// Usage: node scripts/e2e-export-gate.mjs [baseUrl]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:4173'

function fail(reason) {
  console.error(`EXPORT-GATE E2E: FAIL ${reason}`)
  process.exitCode = 1
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()

  // Keep the pre-export control pass fast: block the NER model download so
  // detectEntitiesNer rejects immediately instead of pulling ~50MB.
  await context.route('**/huggingface.co/**', (r) => r.abort())
  await context.route('**/cdn.jsdelivr.net/**', (r) => r.abort())

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const docName = 'Synthetic Export Gate Doc.docx'

  // Seed one history doc with a confirmed entity and an unreviewed candidate.
  const seedResult = await page.evaluate((docName) => {
    return new Promise((resolve, reject) => {
      const sourceText = 'Договор с Acme Ltd. Подписал Иван Петров. Контакт Beta Corp.'
      const companyStart = sourceText.indexOf('Acme Ltd')
      const candidateStart = sourceText.indexOf('Beta Corp')
      if (companyStart < 0 || candidateStart < 0) {
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
            value: 'Acme Ltd',
            placeholder: '[COMPANY_1]',
            positions: [{ start: companyStart, end: companyStart + 'Acme Ltd'.length }],
            anonymize: true,
            manual: false,
          },
          {
            id: crypto.randomUUID(),
            type: 'COMPANY',
            value: 'Beta Corp',
            placeholder: '[COMPANY_2]',
            positions: [{ start: candidateStart, end: candidateStart + 'Beta Corp'.length }],
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

    // Open the seeded doc from the History panel.
    const row = page.locator('.history-row', { hasText: docName })
    await row.waitFor({ state: 'visible', timeout: 15000 })
    await row.getByRole('button', { name: 'Открыть' }).click()

    await page.waitForSelector('.result', { timeout: 15000 })
    await page.waitForSelector('.candidate-row', { timeout: 15000 })

    const exportBtn = page.getByRole('button', { name: 'Экспортировать .md', exact: true })

    // 1st click: control pass runs (NER blocked -> fast), gate should trigger.
    await exportBtn.click()
    const dialog = page.locator('dialog.export-gate-dialog')
    await page.waitForFunction(
      () => document.querySelector('dialog.export-gate-dialog')?.hasAttribute('open'),
      { timeout: 20000 },
    )
    const dialogText = (await dialog.textContent()) ?? ''
    if (!dialogText.includes('Кандидатов не просмотрено')) {
      fail(`export gate dialog missing expected text, got: ${dialogText}`)
    }

    // Cancel path: "Вернуться к проверке" closes the dialog, no download.
    let sawDownload = false
    page.on('download', () => { sawDownload = true })
    await dialog.getByRole('button', { name: 'Вернуться к проверке' }).click()
    await page.waitForFunction(
      () => !document.querySelector('dialog.export-gate-dialog')?.hasAttribute('open'),
      { timeout: 10000 },
    )
    if (sawDownload) {
      fail('a download happened after clicking "Вернуться к проверке"')
    }

    // 2nd click: force through with "Экспортировать всё равно".
    await exportBtn.click()
    await page.waitForFunction(
      () => document.querySelector('dialog.export-gate-dialog')?.hasAttribute('open'),
      { timeout: 20000 },
    )
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Экспортировать всё равно' }).click(),
    ])
    if (!download.suggestedFilename().endsWith('.md')) {
      fail(`expected a .md download, got: ${download.suggestedFilename()}`)
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
console.error('EXPORT-GATE E2E: PASS')
process.exit(0)
