import { chromium } from 'playwright'

const baseUrl = process.argv[2]
const file = process.argv[3]
const word = process.argv[4] ?? 'Budapest'
const shot = process.argv[5] ?? 'popup.png'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (e) => console.error('[pageerror]', String(e)))

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.setInputFiles('input[type=file]', file)

// wait for the full pipeline to finish and the editor to render
let sawLoading = false
const deadline = Date.now() + 360000
while (Date.now() < deadline) {
  await page.waitForTimeout(1500)
  const loading = await page.$('.status-loading').then((el) => !!el)
  const result = await page.$('.result').then((el) => !!el)
  if (loading) sawLoading = true
  if (!loading && result && sawLoading) break
}
await page.waitForTimeout(500)

// double-click the target word inside the editor to select it
const target = page.locator('.cm-content').getByText(word, { exact: false }).first()
await target.scrollIntoViewIfNeeded()
await target.dblclick()
await page.waitForTimeout(400)

const popup = await page.$('.cm-add-popup')
const popupBox = popup ? await popup.boundingBox() : null
const selBox = await target.boundingBox().catch(() => null)
const popupText = popup ? await popup.innerText() : null

console.log(JSON.stringify({
  popupVisible: !!popup,
  popupBox,
  selBox,
  popupText,
}, null, 2))

await page.screenshot({ path: shot, fullPage: false })
console.error(`screenshot -> ${shot}`)
await browser.close()
