import { describe, it, expect } from 'vitest'
import { pickExecutionProvider } from './pickEp'

describe('pickExecutionProvider', () => {
  it('returns webgpu when navigator.gpu is present', () => {
    expect(pickExecutionProvider({ gpu: {} })).toBe('webgpu')
  })

  it('returns wasm when navigator has no gpu property', () => {
    expect(pickExecutionProvider({})).toBe('wasm')
  })

  it('returns wasm when navigator is undefined', () => {
    expect(pickExecutionProvider(undefined)).toBe('wasm')
  })

  it('returns wasm when navigator.gpu is undefined', () => {
    expect(pickExecutionProvider({ gpu: undefined })).toBe('wasm')
  })
})
