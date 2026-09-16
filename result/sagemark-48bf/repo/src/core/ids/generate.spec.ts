import { describe, expect, it } from 'vitest'

import { generateId, isLikelyId, shortId } from './generate'

describe('generateId', () => {
  it('prefixes the result', () => {
    expect(generateId('camp').startsWith('camp_')).toBe(true)
  })

  it('produces unique values across many calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 500; i++) ids.add(generateId('x'))
    expect(ids.size).toBe(500)
  })

  it('keeps the id within a sensible length', () => {
    const id = generateId('char')
    expect(id.length).toBeGreaterThanOrEqual(10)
    expect(id.length).toBeLessThanOrEqual(24)
  })
})

describe('isLikelyId', () => {
  it('accepts an id we just generated', () => {
    const id = generateId('fac')
    expect(isLikelyId(id)).toBe(true)
    expect(isLikelyId(id, 'fac')).toBe(true)
  })

  it('rejects ids with the wrong prefix', () => {
    expect(isLikelyId(generateId('fac'), 'camp')).toBe(false)
  })

  it('rejects short or junk strings', () => {
    expect(isLikelyId('')).toBe(false)
    expect(isLikelyId('abc')).toBe(false)
    expect(isLikelyId('no-prefix-here')).toBe(false)
    expect(isLikelyId('camp_AB')).toBe(false)
  })

  it('rejects ids with characters outside the alphabet', () => {
    expect(isLikelyId('camp_abcdefghij')).toBe(false)
    expect(isLikelyId('camp_AAAAAAAAAI')).toBe(false)
  })
})

describe('shortId', () => {
  it('returns the body slice after the underscore', () => {
    const id = 'camp_ABCDEFGHIJ'
    expect(shortId(id)).toBe('ABCDEF')
  })

  it('falls back to a leading slice when there is no prefix', () => {
    expect(shortId('plainvalue')).toBe('plainv')
  })
})
