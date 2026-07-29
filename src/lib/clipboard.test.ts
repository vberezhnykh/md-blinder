// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { copyText } from './clipboard'

function stubClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  })
}

afterEach(() => {
  stubClipboard(undefined)
  vi.restoreAllMocks()
  // @ts-expect-error — снимаем стаб execCommand между тестами
  delete document.execCommand
})

describe('copyText', () => {
  it('пишет через Clipboard API, когда он доступен', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    expect(await copyText('Иванов И. И.')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Иванов И. И.')
  })

  it('падает на textarea-фолбэк, когда Clipboard API отказал (нет secure context)', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    const exec = vi.fn().mockReturnValue(true)
    // @ts-expect-error — happy-dom не реализует execCommand
    document.execCommand = exec

    expect(await copyText('[PERSON_1]')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('использует фолбэк и когда Clipboard API вовсе нет', async () => {
    stubClipboard(undefined)
    // @ts-expect-error — happy-dom не реализует execCommand
    document.execCommand = vi.fn().mockReturnValue(true)

    expect(await copyText('текст')).toBe(true)
  })

  it('возвращает false, когда не сработал ни один путь', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))

    expect(await copyText('текст')).toBe(false)
  })

  it('не оставляет служебную textarea в DOM', async () => {
    stubClipboard(undefined)
    // @ts-expect-error — happy-dom не реализует execCommand
    document.execCommand = vi.fn().mockReturnValue(true)

    await copyText('текст')
    expect(document.querySelectorAll('textarea').length).toBe(0)
  })

  it('убирает textarea даже когда execCommand бросил', async () => {
    stubClipboard(undefined)
    // @ts-expect-error — happy-dom не реализует execCommand
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error('boom')
    })

    expect(await copyText('текст')).toBe(false)
    expect(document.querySelectorAll('textarea').length).toBe(0)
  })
})
