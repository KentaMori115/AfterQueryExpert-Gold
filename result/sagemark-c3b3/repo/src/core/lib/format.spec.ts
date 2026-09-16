import { describe, expect, it } from 'vitest'

import { initials, joinWithAnd, pluralize, slugify, titleCase, truncate } from './format'

describe('titleCase', () => {
  it.each([
    ['arcane archive', 'Arcane Archive'],
    ['THE FROZEN GATE', 'The Frozen Gate'],
    ['mixed CASE words', 'Mixed Case Words'],
    ['', ''],
  ])('formats %s -> %s', (input, expected) => {
    expect(titleCase(input)).toBe(expected)
  })
})

describe('pluralize', () => {
  it('keeps the singular for 1', () => {
    expect(pluralize(1, 'session')).toBe('1 session')
  })

  it('appends an s by default', () => {
    expect(pluralize(3, 'session')).toBe('3 sessions')
  })

  it('uses the supplied plural', () => {
    expect(pluralize(2, 'octopus', 'octopi')).toBe('2 octopi')
  })

  it('handles 0', () => {
    expect(pluralize(0, 'thing')).toBe('0 things')
  })
})

describe('truncate', () => {
  it('returns the original when short enough', () => {
    expect(truncate('short', 10)).toBe('short')
  })

  it('cuts and appends suffix', () => {
    expect(truncate('the quick brown fox', 10)).toBe('the qui...')
  })

  it('respects a custom suffix', () => {
    expect(truncate('hello world hello world', 12, '~')).toBe('hello world~')
  })
})

describe('joinWithAnd', () => {
  it('returns empty for empty input', () => {
    expect(joinWithAnd([])).toBe('')
  })

  it('returns the single item', () => {
    expect(joinWithAnd(['Iris'])).toBe('Iris')
  })

  it('uses a plain and for two', () => {
    expect(joinWithAnd(['Iris', 'Kael'])).toBe('Iris and Kael')
  })

  it('uses oxford comma for three or more', () => {
    expect(joinWithAnd(['Iris', 'Kael', 'Brann'])).toBe('Iris, Kael, and Brann')
  })

  it('skips blank entries', () => {
    expect(joinWithAnd(['Iris', '', '  ', 'Kael'])).toBe('Iris and Kael')
  })
})

describe('slugify', () => {
  it.each([
    ['Frozen Gate', 'frozen-gate'],
    ['  spaces  galore ', 'spaces-galore'],
    ['punct! & symbols?', 'punct-symbols'],
    ['Crónica del Sol', 'cronica-del-sol'],
  ])('slugifies %s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps at 64 chars', () => {
    expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(64)
  })
})

describe('initials', () => {
  it.each([
    ['Iris Thorne', 'IT'],
    ['Cael', 'CA'],
    ['Vyn', 'VY'],
    ['Iris  Thorne  Vale', 'IV'],
    ['', '?'],
  ])('extracts initials from %s -> %s', (input, expected) => {
    expect(initials(input)).toBe(expected)
  })
})
