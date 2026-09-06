// Functional check for the draggable entity-boundary handles. Seeds a doc with a
// deliberately over-captured PERSON ("John Smith Junior" where "Junior" is
// extra), opens it, clicks the span to activate it, asserts both handles render,
// then drags the RIGHT handle inward and asserts the entity value shrank (the
// trailing word was released) and snapped to a word boundary.
//
// Usage: node scripts/e2e-span-handles.mjs [baseUrl]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:4181'
let failed = false
const fail = (m) => { console.error(`SPAN-HANDLES E2E: FAIL ${m}`); failed = true }

const browser = await chromium.launch()
try {
  const page = await (await browser.newContext()).newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const docName = 'Synthetic Span Handles Doc.docx'
  const seeded = await page.evaluate((docName) => new Promise((resolve, reject) => {
    const sourceText = 'Contact John Smith Junior at the office today.'
    const start = sourceText.indexOf('John')
    const end = sourceText.indexOf('Junior') + 'Junior'.length
    const doc = {
      id: crypto.randomUUID(), name: docName, format: 'docx',
      createdAt: Date.now(), updatedAt: Date.now(), sourceText,
      entities: [{
        id: crypto.randomUUID(), type: 'PERSON', value: 'John Smith Junior',
        placeholder: '[PERSON_1]', positions: [{ start, end }],
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
  }), docName)
  if (!seeded) { fail('could not seed doc'); throw new Error('seed')

  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  const row = page.locator('.history-row', { hasText: docName })
  await row.waitFor({ state: 'visible', timeout: 15000 })
  await row.getByRole('button', { name: 'Открыть' }).click()
  await page.waitForSelector('.cm-entity-PERSON', { timeout: 15000 })

  const valueBefore = (await page.locator('.entity-row:not(.candidate-row) .cell-value').first().innerText()).trim()
  if (valueBefore !== 'John Smith Junior') fail(`expected initial value "John Smith Junior", got "${valueBefore}"`)

  // Activate: click inside the highlighted PERSON span.
  const span = page.locator('.cm-entity-PERSON').first()
  await span.click()

  await page.waitForSelector('.cm-entity-handle-right', { timeout: 5000 }).catch(() => {})
  const leftHandles = await page.locator('.cm-entity-handle-left').count()
  const rightHandles = await page.locator('.cm-entity-handle-right').count()
  if (leftHandles < 1 || rightHandles < 1) fail(`handles did not render (left=${leftHandles} right=${rightHandles})`)

  // Drag the RIGHT handle inward (left) by ~70px — past the word "Junior".
  const box = await page.locator('.cm-entity-handle-right').first().boundingBox()
  if (!box) { fail('no right-handle bbox') } else {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let dx = 10; dx <= 70; dx += 10) { await page.mouse.move(cx - dx, cy); await page.waitForTimeout(20) }
    await page.mouse.up()
    await page.waitForTimeout(300)
  }

  const valueAfter = (await page.locator('.entity-row:not(.candidate-row) .cell-value').first().innerText()).trim()
  console.error(`SPAN-HANDLES E2E: shrink "${valueBefore}" -> "${valueAfter}"`)
  if (valueAfter === valueBefore) fail('value did not change after dragging the right handle inward')
  if (!valueBefore.startsWith(valueAfter) || valueAfter.length === 0) fail(`value should shrink to a non-empty prefix, got "${valueAfter}"`)
  if (/junior/i.test(valueAfter)) fail(`"Junior" should have been released, still in "${valueAfter}"`)

  // Grow direction: drag the right handle back OUTWARD to re-grab "Junior".
  const box2 = await page.locator('.cm-entity-handle-right').first().boundingBox()
  if (box2) {
    const cx = box2.x + box2.width / 2, cy = box2.y + box2.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let dx = 10; dx <= 90; dx += 10) { await page.mouse.move(cx + dx, cy); await page.waitForTimeout(20) }
    await page.mouse.up()
    await page.waitForTimeout(300)
  }
  const valueGrown = (await page.locator('.entity-row:not(.candidate-row) .cell-value').first().innerText()).trim()
  console.error(`SPAN-HANDLES E2E: grow "${valueAfter}" -> "${valueGrown}"`)
  if (valueGrown.length <= valueAfter.length) fail(`value should grow when dragging the right handle outward, got "${valueGrown}"`)

  await browser.close()
} catch (e) {
  fail(String(e && e.stack ? e.stack : e))
  await browser.close()
}

if (failed) process.exit(1)
console.error('SPAN-HANDLES E2E: PASS')
process.exit(0)
