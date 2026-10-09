import { describe, expect, it, vi } from 'vitest'
import { installMapUpsert } from './mapUpsert'

class Store<K, V> extends Map<K, V> {}

describe('installMapUpsert', () => {
  // Отдельный прототип, чтобы проверить полифил независимо от версии Node.
  const proto = Object.create(Map.prototype) as object
  installMapUpsert([proto])
  const make = <K, V>() => Object.setPrototypeOf(new Store<K, V>(), proto) as Map<K, V> & {
    getOrInsert(key: K, value: V): V
    getOrInsertComputed(key: K, compute: (key: K) => V): V
  }

  it('getOrInsert добавляет значение только для нового ключа', () => {
    const map = make<string, number>()
    expect(map.getOrInsert('a', 1)).toBe(1)
    expect(map.getOrInsert('a', 2)).toBe(1)
  })

  it('getOrInsertComputed вызывает функцию только для нового ключа', () => {
    const map = make<string, string[]>()
    const compute = vi.fn(() => [] as string[])
    map.getOrInsertComputed('a', compute).push('x')
    map.getOrInsertComputed('a', compute).push('y')
    expect(map.get('a')).toEqual(['x', 'y'])
    expect(compute).toHaveBeenCalledTimes(1)
    expect(compute).toHaveBeenCalledWith('a')
  })

  it('не заменяет встроенную реализацию', () => {
    const native = { getOrInsert: () => 'native', getOrInsertComputed: () => 'native' }
    installMapUpsert([native])
    expect(native.getOrInsertComputed()).toBe('native')
  })

  it('глобальные Map и WeakMap получают методы', () => {
    expect(typeof (Map.prototype as unknown as Record<string, unknown>).getOrInsertComputed).toBe('function')
    expect(typeof (WeakMap.prototype as unknown as Record<string, unknown>).getOrInsertComputed).toBe('function')
  })
})
