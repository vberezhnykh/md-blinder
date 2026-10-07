import { describe, expect, it } from 'vitest'
import { detectPresidioIds, isZaIdNumber } from './presidioDetectors'
import { detectStructural } from './regexDetectors'
import type { RawMatch } from './types'

const found = (text: string) => detectPresidioIds(text).map((m) => [m.type, m.value])
// Повторяет resolveOverlaps из index.ts: раньше начавшийся и более длинный спан
// побеждает, при равенстве — первый в выдаче detectStructural.
const structural = (text: string) => {
  const accepted: RawMatch[] = []
  const sorted = [...detectStructural(text)].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  for (const m of sorted) {
    const prev = accepted[accepted.length - 1]
    if (!prev || prev.end <= m.start) accepted.push(m)
  }
  return accepted.map((m) => [m.type, m.value])
}

describe('South African identifiers', () => {
  it('validates ID numbers by birth date, status digits and Luhn', () => {
    expect(isZaIdNumber('8001015009087')).toBe(true)
    expect(isZaIdNumber('8001015009088')).toBe(false) // checksum
    expect(isZaIdNumber('8013015009081')).toBe(false) // month 13
    expect(isZaIdNumber('8001015009387')).toBe(false) // citizenship digit 3
    expect(isZaIdNumber('8001015009787')).toBe(false) // legacy digit 7
    expect(isZaIdNumber('9912315009087', new Date('2026-10-07'))).toBe(false) // checksum differs
  })

  it('detects an ID number as ID_DOC instead of a card, with or without grouping', () => {
    expect(structural('ID Number: 8001015009087')).toEqual([['ID_DOC', '8001015009087']])
    expect(found('identity 800101 5009 087 of the signatory')).toEqual([['ID_DOC', '800101 5009 087']])
  })

  it('detects CIPC company registration numbers in modern and legacy form', () => {
    expect(found('Codencium (Pty) Ltd, 2025/717145/07')).toEqual([['REG_NUMBER', '2025/717145/07']])
    expect(found('close corporation CK1995/012345')).toEqual([['REG_NUMBER', 'CK1995/012345']])
    expect(found('reference 2999/123456/07')).toEqual([])
  })

  it('detects a SARS tax number only after a label', () => {
    expect(found('Income tax reference number: 0123456789')).toEqual([['REG_NUMBER', '0123456789']])
    expect(found('SARS tax number 9123456780')).toEqual([['REG_NUMBER', '9123456780']])
    expect(found('The amount of 0123456789 units')).toEqual([])
    expect(found('Tax No. 4123456789')).toEqual([])
  })
})

describe('US and UK identifiers', () => {
  it('detects a valid SSN and drops known invalid ones', () => {
    expect(structural('SSN 536-90-4399')).toEqual([['REG_NUMBER', '536-90-4399']])
    expect(found('SSN 123-45-6789')).toEqual([])
    expect(found('SSN 666-12-3456 or 536-00-4399 or 536-90-0000')).toEqual([])
    expect(found('536-90.4399')).toEqual([])
  })

  it('detects a UK National Insurance number', () => {
    expect(found('NI number JG 12 34 56 C')).toEqual([['REG_NUMBER', 'JG 12 34 56 C']])
    expect(found('QQ 12 34 56 C')).toEqual([])
    expect(found('NINO AB123456D')).toEqual([['REG_NUMBER', 'AB123456D']])
    expect(found('GB123456A')).toEqual([])
  })
})

describe('network identifiers', () => {
  it('detects labelled IPv4 addresses, including lists', () => {
    expect(found('IP address 192.168.10.25')).toEqual([['OTHER', '192.168.10.25']])
    expect(found('IP addresses 10.0.0.1, 10.0.0.2 and 10.0.0.3')).toEqual([
      ['OTHER', '10.0.0.1'], ['OTHER', '10.0.0.2'], ['OTHER', '10.0.0.3'],
    ])
  })

  it('does not take clause numbering, times, dates or amounts for addresses', () => {
    expect(found('See clause 12.1.3.4 and 1.2.3.4 of the Agreement')).toEqual([])
    expect(found('Meeting at 10:30 on 10.09.2026, fee EUR 5 000.00')).toEqual([])
  })

  it('detects IPv6 and UUIDs', () => {
    expect(found('host 2001:db8::8a2e:370:7334 is allowed')).toEqual([['OTHER', '2001:db8::8a2e:370:7334']])
    expect(found('record 123e4567-e89b-42d3-a456-426614174000')).toEqual([['OTHER', '123e4567-e89b-42d3-a456-426614174000']])
    expect(found('nil 00000000-0000-0000-0000-000000000000')).toEqual([])
  })

  it('a UUID is no longer split into a phone number', () => {
    expect(structural('UUID 123e4567-e89b-42d3-a456-426614174000')).toEqual([
      ['OTHER', '123e4567-e89b-42d3-a456-426614174000'],
    ])
  })
})
