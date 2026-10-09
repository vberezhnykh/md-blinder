import { useCallback, useState } from 'react'

// Личная настройка интерфейса в localStorage. Хранилище может быть недоступно
// (приватный режим, запрет сайта), тогда настройка живет до перезагрузки.
export function useStoredFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored === null ? fallback : stored === '1'
    } catch {
      return fallback
    }
  })
  const update = useCallback((next: boolean) => {
    setValue(next)
    try {
      window.localStorage.setItem(key, next ? '1' : '0')
    } catch {
      // Настройка просто не сохранится.
    }
  }, [key])
  return [value, update]
}
