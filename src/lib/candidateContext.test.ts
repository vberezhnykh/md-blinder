import { describe, expect, it } from 'vitest'
import { candidateContext } from './candidateContext'

describe('candidateContext', () => {
  it('возвращает весь короткий текст без многоточий', () => {
    const text = 'Подписал Иванов П. С. лично.'
    const start = text.indexOf('Иванов')
    expect(candidateContext(text, start, start + 12)).toEqual({
      before: 'Подписал ', match: 'Иванов П. С.', after: ' лично.', cutBefore: false, cutAfter: false,
    })
  })

  it('обрезает длинный текст по пробелу и не рвет слова', () => {
    const text = `${'слово '.repeat(30)}Петров ${'дальше '.repeat(30)}`
    const start = text.indexOf('Петров')
    const ctx = candidateContext(text, start, start + 6, 20)
    expect(ctx.cutBefore).toBe(true)
    expect(ctx.cutAfter).toBe(true)
    expect(ctx.before).toMatch(/^слово( слово)* $/)
    expect(ctx.after).toMatch(/^ дальше( дальше)*$/)
  })

  it('сводит переводы строк к пробелам', () => {
    const text = 'Сторона:\n\n| ИП Смирнова |\nИНН'
    const start = text.indexOf('Смирнова')
    const ctx = candidateContext(text, start, start + 8)
    expect(ctx.before).toBe('Сторона: | ИП ')
    expect(ctx.after).toBe(' | ИНН')
  })
})
