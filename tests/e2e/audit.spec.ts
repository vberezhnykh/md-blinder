import { test, expect, type Download, type Page } from '@playwright/test'
import type { HistoryDoc } from '../../src/lib/history'
import type { Entity } from '../../src/lib/anonymize/types'

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
  await page.getByRole('button', { name: 'Все документы', exact: true }).click()
  await expect(page.locator('.history-panel')).toBeVisible()
}

test('export and copy use the current anonymization immediately and report unreviewed candidates', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const text = 'Sensitive Alex, contact alice@example.test'
  const start = text.indexOf('alice@example.test')
  const candidate: Entity = {
    id: 'email-candidate', type: 'EMAIL', value: 'alice@example.test', placeholder: '[EMAIL_1]',
    positions: [{ start, end: start + 18 }], anonymize: false, manual: false, candidate: true,
  }
  await seed(page, [document('A', text, [person(text, false), candidate])])
  await open(page, 'A')
  await expect(page.getByRole('button', { name: 'Контрольная проверка' })).toHaveCount(0)
  await page.locator('.entity-row:not(.candidate-row) input[type=checkbox]').check()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  expect(await downloadedText(await downloadPromise)).toBe('Sensitive [PERSON_1], contact alice@example.test')
  await expect(page.locator('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Не проверено: 1 кандидат')
  await expect(page.getByRole('button', { name: 'Не проверено: 1 кандидат', exact: true })).toBeVisible()
  // The candidate stays visible as unreplaced in the anonymized view.
  await page.getByRole('button', { name: 'Анонимизированный', exact: true }).click()
  await expect(page.locator('.anonymized-preview mark.anon-unreplaced')).toHaveText('alice@example.test')
  await expect(page.locator('.anonymized-preview mark.anon-replaced')).toHaveText('[PERSON_1]')

  await page.getByRole('button', { name: 'Копировать текст', exact: true }).click()
  await expect(page.locator('.toast')).toContainText(/Текст скопирован.*Не проверено: 1 кандидат/s)
  await page.locator('.toast').getByRole('button', { name: 'Показать', exact: true }).click()
  await expect(page.locator('.editor-layout')).toBeVisible()
  await page.locator('.candidate-row').getByTitle('Принять', { exact: true }).click()
  const acceptedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  expect(await downloadedText(await acceptedDownload)).toBe('Sensitive [PERSON_1], contact [EMAIL_1]')
  await expect(page.getByRole('button', { name: /Не проверено/ })).toHaveCount(0)
})

test('a deleted history document can be restored until the undo window closes', async ({ page }) => {
  await seed(page, [document('A', 'first'), document('B', 'second')])
  await page.locator('.history-row').filter({ hasText: 'Synthetic A.docx' }).getByTitle('Удалить', { exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(1)
  await page.locator('.toast').getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(2)
  expect(await readSaved(page, 'A')).toBeDefined()

  await page.locator('.history-row').filter({ hasText: 'Synthetic A.docx' }).getByTitle('Удалить', { exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(1)
  // Deleting another document commits the pending deletion immediately.
  await page.locator('.history-row').filter({ hasText: 'Synthetic B.docx' }).getByTitle('Удалить', { exact: true }).click()
  await expect.poll(() => readSaved(page, 'A')).toBeUndefined()
  await page.locator('.toast').getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.history-row')).toHaveCount(1)
  await expect(page.locator('.history-row')).toContainText('Synthetic B.docx')
})

test('hovering an entity in the editor highlights its row in the entity list', async ({ page }) => {
  const text = 'Sensitive Alex, contact alice@example.test'
  const start = text.indexOf('alice@example.test')
  const email: Entity = {
    id: 'email', type: 'EMAIL', value: 'alice@example.test', placeholder: '[EMAIL_1]',
    positions: [{ start, end: start + 18 }], anonymize: true, manual: false,
  }
  await seed(page, [document('A', text, [person(text), email])])
  await open(page, 'A')
  const rows = page.locator('.entity-row')
  await page.locator('.cm-entity', { hasText: 'alice@example.test' }).hover()
  await expect(page.locator('.entity-row.is-highlighted')).toHaveCount(1)
  await expect(rows.filter({ hasText: '[EMAIL_1]' })).toHaveClass(/is-highlighted/)
  await page.locator('.cm-entity', { hasText: 'Alex' }).hover()
  await expect(rows.filter({ hasText: '[PERSON_1]' })).toHaveClass(/is-highlighted/)
  await expect(rows.filter({ hasText: '[EMAIL_1]' })).not.toHaveClass(/is-highlighted/)
  await page.locator('.topbar').hover()
  await expect(page.locator('.entity-row.is-highlighted')).toHaveCount(0)
})

test('found entities are grouped by type with a group toggle and collapse', async ({ page }) => {
  const text = 'Alex met Bob at alice@example.test'
  const at = (value: string) => ({ start: text.indexOf(value), end: text.indexOf(value) + value.length })
  const entity = (id: string, type: Entity['type'], value: string, placeholder: string): Entity => ({
    id, type, value, placeholder, positions: [at(value)], anonymize: true, manual: false,
  })
  await seed(page, [document('A', text, [
    entity('p1', 'PERSON', 'Alex', '[PERSON_1]'),
    entity('e1', 'EMAIL', 'alice@example.test', '[EMAIL_1]'),
    entity('p2', 'PERSON', 'Bob', '[PERSON_2]'),
  ])])
  await open(page, 'A')
  const groups = page.locator('.entity-group')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0).locator('.entity-group-name')).toHaveText('PERSON')
  await expect(groups.nth(0).locator('.entity-row')).toHaveCount(2)
  await expect(groups.nth(1).locator('.entity-group-name')).toHaveText('EMAIL')

  await groups.nth(0).locator('.entity-group-header input[type=checkbox]').uncheck()
  await expect(groups.nth(0).locator('.entity-row input[type=checkbox]:checked')).toHaveCount(0)
  await page.getByRole('button', { name: 'Анонимизированный', exact: true }).click()
  await expect(page.locator('.anonymized-preview')).toHaveText('Alex met Bob at [EMAIL_1]')
  await page.getByRole('button', { name: 'Редактор', exact: true }).click()
  await groups.nth(0).locator('.entity-group-header input[type=checkbox]').check()
  await expect(groups.nth(0).locator('.entity-row input[type=checkbox]:checked')).toHaveCount(2)

  const toggle = groups.nth(0).locator('.entity-group-toggle')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(groups.nth(0).locator('.entity-row')).toHaveCount(0)
  await toggle.click()
  await expect(groups.nth(0).locator('.entity-row')).toHaveCount(2)
})

test('the upload zone opens the file picker from the keyboard', async ({ page }) => {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.dropzone').focus()
  await page.keyboard.press('Enter')
  await chooser
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
  await expect(page.locator('.topbar-filename')).toHaveText(incoming.name)
  await expect(page.locator('.cm-content')).toHaveText(revisedText)
  await expect(page.locator('.cm-entity-OTHER')).toHaveText('Alex')
  await expect(page.locator('.entity-row .cell-placeholder')).toHaveText('[OTHER_1]')
  await expect(page.locator('.entity-row input[type=checkbox]')).not.toBeChecked()
  await page.locator('.entity-row input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Анонимизированный', exact: true }).click()
  await expect(page.locator('.anonymized-preview')).toHaveText('Revised [OTHER_1] with new terms')
})

test('embedded image payloads are removed from preview, clipboard and downloaded Markdown', async ({ page, context }) => {
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
  await expect(page.locator('.toast')).toContainText('Текст скопирован')
  // The native Windows clipboard converts line endings to CRLF.
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.replace(/\r\n/g, '\n')).toBe(expected)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  expect(await downloadedText(await downloadPromise)).toBe(expected)
  expect((await readSaved(page, 'images'))?.sourceText).toBe(source)
})

test('the top bar menus open documents and hold the OCR option for the next file', async ({ page }) => {
  await seed(page, [document('A', 'first document'), document('B', 'second document')])
  await open(page, 'A')
  await expect(page.locator('.topbar-filename')).toHaveText('Synthetic A.docx')

  const historyButton = page.getByRole('button', { name: 'История', exact: true })
  await historyButton.click()
  await expect(historyButton).toHaveAttribute('aria-expanded', 'true')
  const menu = page.locator('.menu-panel')
  await expect(menu).toContainText('без шифрования')
  await expect(menu.getByRole('button', { name: /Synthetic A\.docx/ })).toContainText('Открыт сейчас')
  await menu.getByRole('button', { name: /Synthetic B\.docx/ }).click()
  await expect(page.locator('.menu-panel')).toHaveCount(0)
  await expect(page.locator('.topbar-filename')).toHaveText('Synthetic B.docx')
  await expect(page.locator('.cm-content')).toHaveText('second document')

  // Escape closes the menu and returns focus to its button.
  await historyButton.click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.menu-panel')).toHaveCount(0)
  await expect(historyButton).toBeFocused()

  // A click outside closes the menu as well.
  const newFileButton = page.getByRole('button', { name: 'Новый файл', exact: true })
  await newFileButton.click()
  const ocr = page.getByRole('checkbox', { name: /Распознать все страницы через OCR/ })
  await expect(ocr).not.toBeChecked()
  await ocr.check()
  await page.locator('.cm-content').click()
  await expect(page.locator('.menu-panel')).toHaveCount(0)
  await newFileButton.click()
  await expect(page.getByRole('checkbox', { name: /Распознать все страницы через OCR/ })).toBeChecked()
})
