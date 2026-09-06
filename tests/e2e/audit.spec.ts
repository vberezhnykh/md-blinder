import { test, expect, type BrowserContext, type Download, type Page, type Route } from '@playwright/test'
import type { HistoryDoc } from '../../src/lib/history'
import type { Entity, RawMatch } from '../../src/lib/anonymize/types'

// Only the costly NER boundary is substituted. The production build's React,
// CodeMirror, structural detection workers, IndexedDB and downloads run as-is.
// Holding an inference HTTP response makes the race tests independent of the
// machine's speed and avoids downloading the model in CI.
const nerWorker = `
  self.onmessage = async ({ data }) => {
    self.postMessage({ requestId: data.requestId, type: 'progress', stage: 'detect', chunk: 0, chunks: 1 });
    try {
      const response = await fetch('/__audit_ner_response__', {
        method: 'POST', body: JSON.stringify(data),
      });
      const result = await response.json();
      self.postMessage({ requestId: data.requestId, ...result });
    } catch (error) {
      self.postMessage({ requestId: data.requestId, type: 'error', error: String(error) });
    }
  };
`

interface Inference {
  text: string
  succeed: (matches?: RawMatch[]) => Promise<void>
  fail: () => Promise<void>
}

async function mockNer(context: BrowserContext) {
  const pending: Inference[] = []
  const listeners: ((request: Inference) => void)[] = []
  await context.route(/\/ner\.worker(?:-[^/]+)?\.(?:js|ts)(?:\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: nerWorker }))
  await context.route('**/__audit_ner_response__', async (route: Route) => {
    const input = route.request().postDataJSON() as { text: string }
    const request: Inference = {
      text: input.text,
      succeed: (matches = []) => route.fulfill({ json: { type: 'done', matches } }),
      fail: () => route.fulfill({ json: { type: 'error', error: 'Synthetic NER failure' } }),
    }
    const listener = listeners.shift()
    if (listener) listener(request)
    else pending.push(request)
  })
  // Unexpected real model requests fail immediately rather than downloading
  // hundreds of MB if an asset name or inference protocol changes.
  await context.route(/https:\/\/(?:huggingface\.co|cdn\.jsdelivr\.net)\//, (route) => route.abort())
  return {
    next(): Promise<Inference> {
      const request = pending.shift()
      return request ? Promise.resolve(request) : new Promise((resolve) => listeners.push(resolve))
    },
  }
}

function person(text: string, anonymize = true): Entity {
  const start = text.indexOf('Alex')
  return {
    id: 'person-alex', type: 'PERSON', value: 'Alex', placeholder: '[PERSON_1]',
    positions: [{ start, end: start + 4 }], anonymize, manual: false,
  }
}

function document(id: string, sourceText: string, entities: Entity[] = []): HistoryDoc {
  return {
    id, name: `Synthetic ${id}.docx`, format: 'docx', sourceText, entities,
    createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
  }
}

async function seed(page: Page, documents: HistoryDoc[]) {
  await page.goto('/')
  // Exercise the supported history import flow, including validation and both
  // IndexedDB stores, rather than depending on the database's internal schema.
  await importHistory(page, documents)
  await expect(page.locator('.history-row')).toHaveCount(documents.length)
}

async function importHistory(page: Page, documents: HistoryDoc[]) {
  await page.locator('.history-panel input[type=file]').setInputFiles({
    name: 'synthetic-history.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'md-blinder', kind: 'history', version: 1, documents })),
  })
}

async function open(page: Page, id: string) {
  const row = page.locator('.history-row').filter({ hasText: `Synthetic ${id}.docx` })
  const button = row.locator('button').first()
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page.locator('.cm-content')).toBeVisible()
}

async function readSaved(page: Page, id: string): Promise<HistoryDoc | undefined> {
  return page.evaluate((documentId) => new Promise<HistoryDoc | undefined>((resolve, reject) => {
    const request = indexedDB.open('md-blinder')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('documents', 'readonly')
      const read = transaction.objectStore('documents').get(documentId)
      read.onsuccess = () => resolve(read.result)
      read.onerror = () => reject(read.error)
      transaction.oncomplete = () => database.close()
    }
  }), id)
}

async function downloadedText(download: Download) {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download has no readable stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function history(page: Page) {
  await page.getByRole('button', { name: 'История', exact: true }).click()
  await expect(page.locator('.history-panel')).toBeVisible()
}

test('export rejects a stale revision and a retry exports the latest anonymization', async ({ page, context }) => {
  const ner = await mockNer(context)
  const text = 'Sensitive Alex'
  await seed(page, [document('A', text, [person(text, false)])])
  await open(page, 'A')
  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  const exportButton = page.getByRole('button', { name: 'Экспортировать .md', exact: true })
  await exportButton.click()
  const stalePass = await ner.next()
  expect(stalePass.text).toBe(text)
  await page.locator('.entity-row input[type=checkbox]').check()
  await stalePass.succeed()
  await expect(exportButton).toBeEnabled()
  await expect(page.locator('.second-pass-info')).toContainText(/измен|устар|повтор/i)
  expect(downloads).toHaveLength(0)

  await exportButton.click()
  const freshPass = await ner.next()
  // The NER client strips inline Markdown markers, including underscores.
  expect(freshPass.text).toBe('Sensitive [PERSON1]')
  const downloadPromise = page.waitForEvent('download')
  await freshPass.succeed()
  expect(await downloadedText(await downloadPromise)).toBe('Sensitive [PERSON_1]')
  expect(downloads).toHaveLength(1)
})

test('a control pass cannot add findings at offsets from a pre-edit revision', async ({ page, context }) => {
  const ner = await mockNer(context)
  await seed(page, [document('A', 'Contact alice@example.test')])
  await open(page, 'A')
  const check = page.getByRole('button', { name: 'Контрольная проверка', exact: true })
  await check.click()
  const stalePass = await ner.next()
  const editor = page.locator('.cm-content')
  await editor.press('Control+Home')
  await page.keyboard.insertText('PREFIX ')
  await stalePass.succeed()
  await expect(check).toBeEnabled()
  await expect(page.locator('.second-pass-info')).toContainText(/измен|устар|повтор/i)
  await expect(page.locator('.candidate-row')).toHaveCount(0)
  await expect(editor).toHaveText('PREFIX Contact alice@example.test')

  await check.click()
  await (await ner.next()).succeed()
  await expect(page.locator('.candidate-row')).toHaveCount(1)
  await expect(page.locator('.cm-entity-candidate')).toHaveText('alice@example.test')
})

test('switching A to B discards the unfinished control pass from A', async ({ page, context }) => {
  const ner = await mockNer(context)
  const bText = 'BBBB BBBB BBBB BBBB BBBB BBBB BBBB'
  await seed(page, [document('A', 'Contact alice@example.test'), document('B', bText)])
  await open(page, 'A')
  await page.getByRole('button', { name: 'Контрольная проверка', exact: true }).click()
  const stalePass = await ner.next()
  await history(page)
  await open(page, 'B')
  await stalePass.succeed()
  await expect(page.locator('.cm-content')).toHaveText(bText)
  await expect(page.locator('.entity-row')).toHaveCount(0)
  expect((await readSaved(page, 'B'))?.entities).toEqual([])
  // Starting a new pass also proves cancellation released the shared job slot.
  await page.getByRole('button', { name: 'Контрольная проверка', exact: true }).click()
  const bPass = await ner.next()
  expect(bPass.text).toBe(bText)
  await bPass.succeed()
  await expect(page.locator('.second-pass-info')).toContainText('не нашёл пропусков')
  await expect(page.locator('.entity-row')).toHaveCount(0)
})

test('delete, undo and redo restore text and anonymization as one history event', async ({ page }) => {
  const text = 'Sensitive Alex'
  await seed(page, [document('A', text, [person(text)])])
  await open(page, 'A')
  const editor = page.locator('.cm-content')
  await editor.press('Control+a')
  await editor.press('Backspace')
  await expect(editor).toHaveText('')
  await expect(page.locator('.entity-row')).toHaveCount(0)
  await editor.press('Control+z')
  await expect(editor).toHaveText(text)
  await expect(page.locator('.entity-row input[type=checkbox]')).toBeChecked()
  await expect(page.locator('.cm-entity-PERSON')).toHaveText('Alex')
  await page.getByRole('button', { name: 'Анонимизированный', exact: true }).click()
  await expect(page.locator('.anonymized-preview')).toHaveText('Sensitive [PERSON_1]')
  await page.getByRole('button', { name: 'Редактор', exact: true }).click()
  // CodeMirror uses Mod-y on Windows and Linux (Mod-Shift-z on macOS).
  await editor.press('Control+y')
  await expect(editor).toHaveText('')
  await expect(page.locator('.entity-row')).toHaveCount(0)
})

test('switching documents flushes pending edits, including an empty document', async ({ page }) => {
  await seed(page, [document('A', 'original text'), document('B', 'second document')])
  await open(page, 'A')
  const editor = page.locator('.cm-content')
  await editor.press('Control+End')
  await page.keyboard.insertText(' EDITED')
  // No timeout or debounce wait between the edit and navigation.
  await history(page)
  await open(page, 'B')
  expect((await readSaved(page, 'A'))?.sourceText).toBe('original text EDITED')
  await history(page)
  await open(page, 'A')
  await expect(editor).toHaveText('original text EDITED')
  await editor.press('Control+a')
  await editor.press('Backspace')
  await history(page)
  await open(page, 'B')
  expect((await readSaved(page, 'A'))?.sourceText).toBe('')
  await page.reload()
  await open(page, 'A')
  await expect(editor).toHaveText('')
})

test('the only open document can be reopened from history without losing undo', async ({ page }) => {
  await seed(page, [document('A', 'original text')])
  await open(page, 'A')
  const editor = page.locator('.cm-content')
  await editor.press('Control+End')
  await page.keyboard.insertText(' EDITED')
  await history(page)
  await open(page, 'A')
  await expect(editor).toHaveText('original text EDITED')
  await editor.press('Control+z')
  await expect(editor).toHaveText('original text')
})

test('failed NER requires explicit export acknowledgment even with no candidates', async ({ page, context }) => {
  const ner = await mockNer(context)
  const text = 'Sensitive Alex'
  await seed(page, [document('A', text, [person(text)])])
  await open(page, 'A')
  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  const exportButton = page.getByRole('button', { name: 'Экспортировать .md', exact: true })
  await exportButton.click()
  await (await ner.next()).fail()
  const dialog = page.locator('dialog.export-gate-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/NER|модел|не удалось|не заверш/i)
  expect(downloads).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(downloads).toHaveLength(0)

  await exportButton.click()
  await (await ner.next()).fail()
  await expect(dialog).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Экспортировать всё равно', exact: true }).click()
  expect(await downloadedText(await downloadPromise)).toBe('Sensitive [PERSON_1]')
  expect(downloads).toHaveLength(1)
})

test('fresh control findings must be reviewed before the checked snapshot exports', async ({ page, context }) => {
  const ner = await mockNer(context)
  await seed(page, [document('A', 'Contact alice@example.test')])
  await open(page, 'A')
  await page.getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  await (await ner.next()).succeed()
  const dialog = page.locator('dialog.export-gate-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.locator('.candidate-row')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click()
  await page.locator('.candidate-row').getByTitle('Принять', { exact: true }).click()
  await page.getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  const checkedPass = await ner.next()
  expect(checkedPass.text).toBe('Contact [EMAIL1]')
  const downloadPromise = page.waitForEvent('download')
  await checkedPass.succeed()
  expect(await downloadedText(await downloadPromise)).toBe('Contact [EMAIL_1]')
})

test('IndexedDB v1 migration preserves documents and populates the metadata history', async ({ page }) => {
  const source = 'Legacy Alex'
  const legacy = document('legacy', source, [person(source)])
  const empty = document('empty', '')
  // Load a real static asset on the same origin without booting the app, so
  // its first database open must perform an actual 1 -> 2 schema upgrade.
  await page.goto('/favicon.svg')
  const oldVersion = await page.evaluate((documents) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('md-blinder', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' })
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('documents', 'readwrite')
      for (const doc of documents) transaction.objectStore('documents').put(doc)
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => { const version = database.version; database.close(); resolve(version) }
    }
  }), [legacy, empty])
  expect(oldVersion).toBe(1)

  await page.goto('/')
  await expect(page.locator('.history-row')).toHaveCount(2)
  const migrated = await page.evaluate(() => new Promise<{
    version: number
    metadata: { id: string; entityCount: number; sourceText?: string; entities?: unknown }[]
  }>((resolve, reject) => {
    const request = indexedDB.open('md-blinder')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('documentMeta', 'readonly')
      const read = transaction.objectStore('documentMeta').getAll()
      read.onerror = () => reject(read.error)
      read.onsuccess = () => resolve({ version: database.version, metadata: read.result })
      transaction.oncomplete = () => database.close()
    }
  }))
  expect(migrated.version).toBe(2)
  expect(migrated.metadata).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'legacy', entityCount: 1 }),
    expect.objectContaining({ id: 'empty', entityCount: 0 }),
  ]))
  expect(migrated.metadata.every((meta) => meta.sourceText === undefined && meta.entities === undefined)).toBe(true)
  expect(await readSaved(page, 'legacy')).toEqual(legacy)
  expect(await readSaved(page, 'empty')).toEqual(empty)
  await open(page, 'legacy')
  await expect(page.locator('.cm-content')).toHaveText(source)
  await expect(page.locator('.entity-row input[type=checkbox]')).toBeChecked()
  await page.getByRole('button', { name: 'Анонимизированный', exact: true }).click()
  await expect(page.locator('.anonymized-preview')).toHaveText('Legacy [PERSON_1]')
})

test('importing a newer revision of the current document updates the reopened editor', async ({ page }) => {
  const original = 'Old Alex'
  await seed(page, [document('A', original, [person(original)])])
  await open(page, 'A')
  await history(page)
  const revisedText = 'Revised Alex with new terms'
  const revisedEntity: Entity = { ...person(revisedText, false), type: 'OTHER', placeholder: '[OTHER_1]' }
  const incoming = {
    ...document('A', revisedText, [revisedEntity]),
    name: 'Synthetic A updated.docx', updatedAt: Date.now() + 10_000,
  }
  await importHistory(page, [incoming])
  await expect.poll(async () => (await readSaved(page, 'A'))?.sourceText).toBe(revisedText)
  await expect(page.locator('.history-row')).toHaveCount(1)
  await page.locator('.history-row').filter({ hasText: incoming.name }).locator('button').first().click()
  await expect(page.locator('.filename-compact')).toHaveText(incoming.name)
  await expect(page.locator('.cm-content')).toHaveText(revisedText)
  await expect(page.locator('.cm-entity-OTHER')).toHaveText('Alex')
  await expect(page.locator('.entity-row .cell-placeholder')).toHaveText('[OTHER_1]')
  await expect(page.locator('.entity-row input[type=checkbox]')).not.toBeChecked()
  await page.locator('.entity-row input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Анонимизированный', exact: true }).click()
  await expect(page.locator('.anonymized-preview')).toHaveText('Revised [OTHER_1] with new terms')
})

test('embedded image payloads are removed from preview, clipboard and downloaded Markdown', async ({ page, context }) => {
  const ner = await mockNer(context)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // Synthetic one-pixel image; no real document or personal data is involved.
  const payload = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const image = `data:image/png;base64,${payload}`
  const source = `Before ![harmlessimage](${image}) After.\n<img alt="embedded sample" src="${image}">`
  const expected = 'Before [Изображение удалено при обезличивании] After.\n[Изображение удалено при обезличивании]'
  await seed(page, [document('images', source)])
  await open(page, 'images')
  await page.getByRole('button', { name: 'Анонимизированный', exact: true }).click()
  await expect(page.locator('.anonymized-preview')).toHaveText(expected)
  await page.getByRole('button', { name: 'Копировать текст', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Скопировано ✓', exact: true })).toBeVisible()
  // The native Windows clipboard converts line endings to CRLF.
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.replace(/\r\n/g, '\n')).toBe(expected)
  await page.getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  const pass = await ner.next()
  expect(pass.text).not.toContain('data:image')
  expect(pass.text).not.toContain(payload)
  expect(pass.text).not.toContain('harmlessimage')
  const downloadPromise = page.waitForEvent('download')
  await pass.succeed()
  expect(await downloadedText(await downloadPromise)).toBe(expected)
  expect((await readSaved(page, 'images'))?.sourceText).toBe(source)
})

test('deleting a document cancels its pending pass without recreating it in history', async ({ page, context }) => {
  const ner = await mockNer(context)
  await seed(page, [document('A', 'Contact alice@example.test')])
  await open(page, 'A')
  await page.getByRole('button', { name: 'Контрольная проверка', exact: true }).click()
  const pass = await ner.next()
  await history(page)
  await page.locator('.history-row').getByTitle('Удалить', { exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(0)
  await pass.succeed()
  // Observe beyond the autosave debounce: a late candidate result must not
  // queue a write that silently resurrects the already-deleted document.
  await page.waitForTimeout(1_000)
  expect(await readSaved(page, 'A')).toBeUndefined()
  await expect(page.locator('.history-row')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.history-panel')).toContainText('История пуста')
})
