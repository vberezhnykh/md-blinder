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

// In a wide window the source and the result stand side by side; otherwise the
// view toggle switches between them.
async function showResult(page: Page) {
  const toggle = page.getByRole('button', { name: 'Результат', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await expect(page.locator('.anonymized-preview')).toBeVisible()
}

async function showSource(page: Page) {
  const toggle = page.getByRole('button', { name: 'Исходник', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await expect(page.locator('.cm-content')).toBeVisible()
}

async function acceptCurrentCandidate(page: Page) {
  await page.locator('.candidate-card').getByRole('button', { name: /^Принять/ }).first().click()
}

async function copyFromExportMenu(page: Page) {
  await page.getByRole('button', { name: 'Другие варианты выдачи', exact: true }).click()
  await page.getByRole('button', { name: /^Копировать текст/ }).click()
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
  await page.getByRole('tab', { name: /Найденные данные/ }).click()
  await page.locator('.entity-row input[type=checkbox]').check()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('.status-strip').getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  expect(await downloadedText(await downloadPromise)).toBe('Sensitive [PERSON_1], contact alice@example.test')
  await expect(page.locator('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Не проверено: 1 кандидат')
  await expect(page.getByRole('button', { name: 'Не проверено: 1 кандидат', exact: true })).toBeVisible()
  // The candidate stays visible as unreplaced in the anonymized view.
  await showResult(page)
  await expect(page.locator('.anonymized-preview mark.anon-unreplaced')).toHaveText('alice@example.test')
  await expect(page.locator('.anonymized-preview mark.anon-replaced')).toHaveText('[PERSON_1]')

  await copyFromExportMenu(page)
  await expect(page.locator('.toast')).toContainText(/Текст скопирован.*Не проверено: 1 кандидат/s)
  await page.locator('.toast').getByRole('button', { name: 'Показать', exact: true }).click()
  await expect(page.locator('.editor-layout')).toBeVisible()
  await expect(page.getByRole('tab', { name: /Проверка/ })).toHaveAttribute('aria-selected', 'true')
  await acceptCurrentCandidate(page)
  const acceptedDownload = page.waitForEvent('download')
  await page.locator('.status-strip').getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  expect(await downloadedText(await acceptedDownload)).toBe('Sensitive [PERSON_1], contact [EMAIL_1]')
  await expect(page.getByRole('button', { name: /Не проверено/ })).toHaveCount(0)
  await expect(page.locator('.status-chip.is-ready')).toHaveText('Готово к выдаче')
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
  await showResult(page)
  await expect(page.locator('.anonymized-preview')).toHaveText('Alex met Bob at [EMAIL_1]')
  await showSource(page)
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
  await showResult(page)
  await expect(page.locator('.anonymized-preview')).toHaveText('Sensitive [PERSON_1]')
  await showSource(page)
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
  await showResult(page)
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
  await showResult(page)
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
  await showResult(page)
  await expect(page.locator('.anonymized-preview')).toHaveText(expected)
  await copyFromExportMenu(page)
  await expect(page.locator('.toast')).toContainText('Текст скопирован')
  // The native Windows clipboard converts line endings to CRLF.
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.replace(/\r\n/g, '\n')).toBe(expected)
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.status-strip').getByRole('button', { name: 'Экспортировать .md', exact: true }).click()
  expect(await downloadedText(await downloadPromise)).toBe(expected)
  expect((await readSaved(page, 'images'))?.sourceText).toBe(source)
})

test('the top bar opens documents from the history menu and picks a new file', async ({ page }) => {
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
  await historyButton.click()
  await page.locator('.cm-content').click()
  await expect(page.locator('.menu-panel')).toHaveCount(0)

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Новый файл', exact: true }).click()
  await chooser

  await page.getByRole('button', { name: 'На главную', exact: true }).click()
  await expect(page.locator('.topbar')).toHaveCount(0)
  await expect(page.locator('.dropzone')).toBeVisible()
  await expect(page.locator('.history-panel')).toContainText('Synthetic B.docx')
})

test('the status strip follows the review and the export menu holds the replacement table', async ({ page }) => {
  const text = 'Sensitive Alex, contact alice@example.test'
  const start = text.indexOf('alice@example.test')
  const candidate: Entity = {
    id: 'email-candidate', type: 'EMAIL', value: 'alice@example.test', placeholder: '[EMAIL_1]',
    positions: [{ start, end: start + 18 }], anonymize: false, manual: false, candidate: true,
  }
  await seed(page, [document('A', text, [person(text), candidate])])
  await open(page, 'A')
  await expect(page.locator('.replacement-section')).toHaveCount(0)
  await expect(page.locator('.status-steps [aria-current="step"] .status-step-label')).toHaveText('Проверка')
  await expect(page.locator('.status-summary')).toHaveText('Заменено 1 значение в 1 месте')

  await page.getByRole('button', { name: 'Другие варианты выдачи', exact: true }).click()
  const csvItem = page.getByRole('button', { name: /^Таблица замен \(\.csv\)/ })
  await expect(csvItem).toContainText('исходные данные')
  const csvDownload = page.waitForEvent('download')
  await csvItem.click()
  const csv = await csvDownload
  expect(csv.suggestedFilename()).toBe('Synthetic A-replacements.csv')
  expect(await downloadedText(csv)).toContain('Alex')
  await expect(page.locator('.menu-panel')).toHaveCount(0)

  await acceptCurrentCandidate(page)
  await expect(page.locator('.status-chip.is-ready')).toHaveText('Готово к выдаче')
  await expect(page.locator('.status-steps [aria-current="step"] .status-step-label')).toHaveText('Выдача')
  await expect(page.locator('.status-summary')).toHaveText('Заменено 2 значения в 2 местах')
})

test('accepting a related candidate merges it into the original placeholder and undo restores it', async ({ page }) => {
  const text = 'Signed by Alex Smith. Smith agreed.'
  const full = text.indexOf('Alex Smith')
  const short = text.indexOf('Smith agreed')
  const original: Entity = {
    id: 'person-smith', type: 'PERSON', value: 'Alex Smith', placeholder: '[PERSON_1]',
    positions: [{ start: full, end: full + 10 }], anonymize: true, manual: false,
  }
  const candidate: Entity = {
    id: 'smith-candidate', type: 'PERSON', value: 'Smith', placeholder: '[PERSON_2]',
    positions: [{ start: short, end: short + 5 }], anonymize: false, manual: false,
    candidate: true, relatedTo: 'person-smith',
  }
  await seed(page, [document('A', text, [original, candidate])])
  await open(page, 'A')
  await expect(page.locator('.candidate-card .candidate-reason')).toHaveText('Похоже на [PERSON_1]')

  await acceptCurrentCandidate(page)
  await expect(page.locator('.candidate-card')).toHaveCount(0)
  await expect(page.locator('.review-done')).toContainText('Все кандидаты разобраны')
  await page.getByRole('tab', { name: /Найденные данные/ }).click()
  await expect(page.locator('.entity-row')).toHaveCount(1)
  await expect(page.locator('.entity-row .cell-count')).toHaveText('2')
  await showResult(page)
  await expect(page.locator('.anonymized-preview')).toHaveText('Signed by [PERSON_1]. [PERSON_1] agreed.')
  await showSource(page)

  await page.locator('.cm-content').press('Control+z')
  await expect(page.locator('.entity-row .cell-count')).toHaveText('1')
  await page.getByRole('tab', { name: /Проверка/ }).click()
  await expect(page.locator('.candidate-card')).toContainText('Smith')
  await showResult(page)
  await expect(page.locator('.anonymized-preview')).toHaveText('Signed by [PERSON_1]. Smith agreed.')
})

test('the review queue walks candidates with buttons and keys, rejects, restores and accepts related ones together', async ({ page }) => {
  const text = 'Alex Smith signed. Smith agreed. A. Smith left. Bob came.'
  const at = (value: string, from = 0) => {
    const start = text.indexOf(value, from)
    return [{ start, end: start + value.length }]
  }
  const original: Entity = {
    id: 'person-smith', type: 'PERSON', value: 'Alex Smith', placeholder: '[PERSON_1]',
    positions: at('Alex Smith'), anonymize: true, manual: false,
  }
  const candidate = (id: string, value: string, placeholder: string, from: number, extra: Partial<Entity>): Entity => ({
    id, type: 'PERSON', value, placeholder, positions: at(value, from), anonymize: false, manual: false, candidate: true, ...extra,
  })
  const surname = candidate('c-surname', 'Smith', '[PERSON_2]', text.indexOf('Smith agreed'), { relatedTo: 'person-smith' })
  const initials = candidate('c-initials', 'A. Smith', '[PERSON_3]', 0, { relatedTo: 'person-smith' })
  const bob = candidate('c-bob', 'Bob', '[PERSON_4]', 0, { candidateNote: 'Низкая уверенность модели' })
  await seed(page, [document('A', text, [original, surname, initials, bob])])
  await open(page, 'A')

  const card = page.locator('.candidate-card')
  await expect(page.getByRole('tab', { name: /Проверка/ })).toHaveAttribute('aria-selected', 'true')
  await expect(card.locator('.candidate-card-count')).toHaveText('Кандидат 1 из 3')
  await expect(card.locator('.candidate-card-value')).toHaveText('Smith')
  await expect(card.locator('.candidate-card-context mark')).toHaveText('Smith')
  await expect(page.locator('.cm-entity-current')).toHaveText('Smith')

  await card.getByRole('button', { name: 'Следующий кандидат' }).click()
  await expect(card.locator('.candidate-card-value')).toHaveText('A. Smith')
  await expect(page.locator('.cm-entity-current')).toHaveText('A. Smith')
  await expect(card).toBeFocused()

  // Backspace rejects the current candidate and moves on to the next one.
  await page.keyboard.press('Backspace')
  await expect(card.locator('.candidate-card-count')).toHaveText('Кандидат 2 из 2')
  await expect(card.locator('.candidate-card-value')).toHaveText('Bob')
  await expect(card.locator('.candidate-reason')).toHaveText('Низкая уверенность модели')
  await expect(card).toBeFocused()

  // Enter on the card accepts; a candidate without a related entity gets its own placeholder.
  await page.keyboard.press('Enter')
  await expect(card.locator('.candidate-card-count')).toHaveText('Кандидат 1 из 1')
  await expect(card.locator('.candidate-card-value')).toHaveText('Smith')

  await page.locator('.review-dismissed summary').click()
  await page.locator('.review-dismissed').getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(card.locator('.candidate-card-count')).toHaveText('Кандидат 1 из 2')

  await card.getByRole('button', { name: 'Принять все похожие на [PERSON_1] (2)' }).click()
  await expect(page.locator('.review-done')).toContainText('Все кандидаты разобраны')
  await expect(page.locator('.status-chip.is-ready')).toHaveText('Готово к выдаче')
  await showResult(page)
  await expect(page.locator('.anonymized-preview')).toHaveText('[PERSON_1] signed. [PERSON_1] agreed. [PERSON_1] left. [PERSON_2] came.')
})

test('a found value opens its actions on click and can be merged and deleted from there', async ({ page }) => {
  const text = 'Alex met Bob'
  const entity = (id: string, value: string, placeholder: string): Entity => {
    const start = text.indexOf(value)
    return { id, type: 'PERSON', value, placeholder, positions: [{ start, end: start + value.length }], anonymize: true, manual: false }
  }
  await seed(page, [document('A', text, [entity('alex', 'Alex', '[PERSON_1]'), entity('bob', 'Bob', '[PERSON_2]')])])
  await open(page, 'A')
  await expect(page.getByRole('tab', { name: /Найденные данные/ })).toHaveAttribute('aria-selected', 'true')
  const alexRow = page.locator('.entity-row').filter({ hasText: 'Alex' })
  await expect(page.locator('.entity-row-actions')).toHaveCount(0)

  await alexRow.locator('.entity-value-button').click()
  await expect(alexRow).toHaveClass(/is-selected/)
  await expect(alexRow.getByRole('button', { name: 'Удалить «Alex»' })).toBeVisible()
  await alexRow.locator('.entity-value-button').click()
  await expect(page.locator('.entity-row-actions')).toHaveCount(0)

  await alexRow.locator('.entity-value-button').click()
  await alexRow.getByRole('button', { name: 'Объединить…' }).click()
  await alexRow.getByLabel('Объединить с').selectOption({ label: '[PERSON_2] · Bob' })
  await alexRow.getByRole('button', { name: 'Объединить', exact: true }).click()
  await expect(page.locator('.entity-row')).toHaveCount(1)
  await expect(page.locator('.entity-row .cell-count')).toHaveText('2')
  await showResult(page)
  await expect(page.locator('.anonymized-preview')).toHaveText('[PERSON_1] met [PERSON_1]')
  await showSource(page)

  const row = page.locator('.entity-row')
  await row.locator('.entity-value-button').click()
  await row.getByRole('button', { name: /^Удалить/ }).click()
  await expect(page.locator('.entity-row')).toHaveCount(0)
  // Without any replacement the view toggle is hidden; the summary reports it.
  await expect(page.locator('.status-summary')).toHaveText('Замен пока нет')
})

test('the result stands beside the source in a wide window, and the choice survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const text = 'Sensitive Alex\n\n| Name | Note |\n|---|---|\n| Alex | ok |'
  const positions = [...text.matchAll(/Alex/g)].map((m) => ({ start: m.index!, end: m.index! + 4 }))
  const alex: Entity = { id: 'alex', type: 'PERSON', value: 'Alex', placeholder: '[PERSON_1]', positions, anonymize: true, manual: false }
  await seed(page, [document('A', text, [alex])])
  await open(page, 'A')

  const preview = page.locator('.anonymized-preview')
  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(preview).toBeVisible()
  await expect(page.getByRole('button', { name: 'Результат', exact: true })).toHaveCount(0)
  await expect(preview.locator('mark.anon-replaced')).toHaveText(['[PERSON_1]', '[PERSON_1]'])
  await expect(preview.locator('.preview-line.is-table')).toHaveCount(3)
  await expect(page.locator('.cm-table-line')).toHaveCount(3)

  // Choosing a value scrolls the result to it and marks it.
  await page.getByRole('tab', { name: /Найденные данные/ }).click()
  await page.locator('.entity-row .entity-value-button').click()
  await expect(preview.locator('mark.anon-replaced.is-focused')).toHaveCount(1)

  const option = page.getByRole('checkbox', { name: 'Результат рядом' })
  await option.uncheck()
  await expect(preview).toBeHidden()
  await page.getByRole('button', { name: 'Результат', exact: true }).click()
  await expect(preview).toBeVisible()
  await expect(page.locator('.cm-content')).toBeHidden()

  await page.reload()
  await open(page, 'A')
  await expect(page.getByRole('checkbox', { name: 'Результат рядом' })).not.toBeChecked()
  await expect(preview).toBeHidden()

  // In a narrow window the option is not offered and the toggle is used.
  await page.getByRole('checkbox', { name: 'Результат рядом' }).check()
  await page.setViewportSize({ width: 1000, height: 900 })
  await expect(page.getByRole('checkbox', { name: 'Результат рядом' })).toHaveCount(0)
  await expect(preview).toBeHidden()
  await showResult(page)
  await expect(page.locator('.cm-content')).toBeHidden()
})

test('the start screen states privacy and the first download and asks nothing about OCR up front', async ({ page }) => {
  await seed(page, [document('A', 'text')])
  await expect(page.locator('.start-fact.is-privacy')).toContainText('Документы не покидают браузер')
  await expect(page.locator('.start-facts')).toContainText('580 МБ')
  await expect(page.locator('.history-panel')).toContainText('без шифрования')

  await expect(page.getByRole('checkbox', { name: /OCR/ })).toHaveCount(0)

  // A document opened from history has no PDF file in memory to recognize again.
  await open(page, 'A')
  await expect(page.locator('.ocr-retry')).toHaveCount(0)
})

// A one-page PDF with a text layer, built by hand so the test carries no real document.
function syntheticPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

test('a freshly uploaded PDF offers to recognize it again through OCR', async ({ page, context }) => {
  // No model or OCR data is downloaded in this test: detection falls back to rules.
  await context.route(/^https:\/\//, (route) => route.abort())
  // pdf.js 6 calls Map#getOrInsertComputed; the app polyfills it, so the test
  // browser (older than that API) must open the PDF without help from the test.
  await page.goto('/')
  await page.locator('input[type=file][accept=".docx,.pdf"]').setInputFiles({
    name: 'synthetic.pdf', mimeType: 'application/pdf',
    buffer: syntheticPdf('Synthetic agreement text for the OCR retry check'),
  })
  await expect(page.locator('.cm-content')).toContainText('Synthetic agreement text', { timeout: 30_000 })
  const retry = page.locator('.ocr-retry')
  await expect(retry).toContainText('Текст выглядит битым')
  await retry.getByRole('button', { name: 'Распознать заново через OCR' }).click()
  // Recognition starts again for the same file; OCR data is unreachable here, so
  // the run either reports progress or fails, but the offer is gone.
  await expect(page.locator('.status-block, .status.error')).toBeVisible()
  await expect(page.locator('.ocr-retry')).toHaveCount(0)
})
