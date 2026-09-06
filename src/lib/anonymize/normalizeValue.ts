import type { EntityType } from './types'

export function normalizeValue(type: EntityType, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (type === 'CARD' || type === 'IBAN' || type === 'ACCOUNT' || type === 'REG_NUMBER' || type === 'SWIFT' || type === 'ID_DOC') {
    return trimmed.replace(/[\s-]/g, '').toUpperCase()
  }
  if (type === 'PERSON' || type === 'COMPANY' || type === 'ADDRESS' || type === 'EMAIL') {
    return trimmed.toLowerCase()
  }
  if (type === 'PHONE') return trimmed.replace(/[\s\-().]/g, '')
  if (type === 'URL') {
    return trimmed.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  }
  return trimmed
}
