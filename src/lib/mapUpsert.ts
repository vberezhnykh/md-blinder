// Полифил Map#getOrInsert и Map#getOrInsertComputed (и тех же методов WeakMap).
// pdf.js 6 вызывает их и в основном потоке, и в своем воркере; в браузерах без
// этих методов загрузка любого PDF падала с «getOrInsertComputed is not a
// function». Подключается в main.tsx и в точке входа воркера pdf.js.

type Upsertable = {
  has(key: unknown): boolean
  get(key: unknown): unknown
  set(key: unknown, value: unknown): unknown
}

export function installMapUpsert(prototypes: object[]): void {
  for (const proto of prototypes) {
    if (!('getOrInsert' in proto)) {
      Object.defineProperty(proto, 'getOrInsert', {
        configurable: true,
        writable: true,
        value(this: Upsertable, key: unknown, value: unknown) {
          if (!this.has(key)) this.set(key, value)
          return this.get(key)
        },
      })
    }
    if (!('getOrInsertComputed' in proto)) {
      Object.defineProperty(proto, 'getOrInsertComputed', {
        configurable: true,
        writable: true,
        value(this: Upsertable, key: unknown, compute: (key: unknown) => unknown) {
          if (typeof compute !== 'function') throw new TypeError('getOrInsertComputed: callback is not a function')
          if (!this.has(key)) this.set(key, compute(key))
          return this.get(key)
        },
      })
    }
  }
}

installMapUpsert([Map.prototype, WeakMap.prototype])
