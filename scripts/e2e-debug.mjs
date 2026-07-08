import { chromium } from 'playwright'

const baseUrl = process.argv[2]
const file = process.argv[3]

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
page.on('pageerror', (e) => console.error('[pageerror]', String(e)))
page.on('console', (m) => console.error(`[console.${m.type()}]`, m.text()))
page.on('requestfailed', (r) => console.error('[reqfailed]', r.url(), r.failure()?.errorText))

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.setInputFiles('input[type=file]', file)

for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000)
  const status = await page.$eval('.status', (el) => el.textContent).catch(() => null)
  const hasResult = await page.$('.result').then((el) => !!el)
  const rows = await page.$$('.entity-row').then((r) => r.length)
  console.error(`t=${(i + 1) * 3}s status="${status}" result=${hasResult} rows=${rows}`)
  if (hasResult && !(await page.$('.status-loading'))) break
}

await browser.close()
