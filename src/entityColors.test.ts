import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_ENTITY_TYPES } from './lib/anonymize/types'

// Цвет типа задается в CSS вручную. Без него сущность не подсвечивается в
// редакторе, а метка группы в списке остается бесцветной — так случилось с
// ID_DOC и URL. Тест не дает добавить тип без цвета.
const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

function count(needle: string): number {
  return css.split(needle).length - 1
}

describe('цвета типов сущностей', () => {
  // Каждый блок с цветами (сейчас светлая и темная тема) объявляет все типы.
  const blocks = count('--ent-PERSON:')

  it('цвета объявлены хотя бы в одном блоке', () => {
    expect(blocks).toBeGreaterThan(0)
  })

  it.each(ALL_ENTITY_TYPES)('%s: переменная в каждом блоке и класс подсветки', (type) => {
    expect(count(`--ent-${type}:`)).toBe(blocks)
    expect(css).toContain(`.cm-entity-${type} { background-color: var(--ent-${type}); }`)
  })
})
