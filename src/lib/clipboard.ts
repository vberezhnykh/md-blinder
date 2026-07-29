// Копирование текста в буфер обмена. Отдельный модуль, потому что
// navigator.clipboard есть не везде: он требует secure context (https или
// localhost) и разрешения, а приложение регулярно открывают в удалённых
// сессиях/по http, где его нет. Поэтому — запасной путь через скрытую
// textarea + execCommand('copy'), который работает и там.

// Запасной путь: скрытая textarea + execCommand. Именно так копировали до
// Clipboard API, и в старых/неsecure окружениях это единственный вариант.
function copyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const ta = document.createElement('textarea')
  ta.value = text
  // Вне экрана, но в DOM и не hidden — иначе выделение не сработает.
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
  }
}

// Возвращает true, если текст точно попал в буфер. Не бросает: вызывающему
// коду нужен только результат, чтобы показать «Скопировано» или ошибку.
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Отказ в разрешении / не secure context — пробуем запасной путь.
    }
  }
  return copyViaTextarea(text)
}
