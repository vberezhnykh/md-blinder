// Запуск Chromium для скриптов бенчмарка. В обычной машине разработчика
// хватает playwright по умолчанию; в контейнерах браузер часто предустановлен
// в другом месте, и тогда путь передаётся через PLAYWRIGHT_CHROMIUM_PATH.
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const FALLBACKS = ['/opt/pw-browsers/chromium']

export function launchChromium(options = {}) {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH
  const executablePath = explicit || FALLBACKS.find((p) => existsSync(p))
  return chromium.launch(executablePath ? { executablePath, ...options } : options)
}
