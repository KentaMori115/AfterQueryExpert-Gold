import { describe, expect, it } from 'vitest'

import { buildSeededRng } from '../dice/roll'

import {
  RUMOR_TEMPLATES,
  STREET_NAMES,
  TAVERN_ADJECTIVES,
  TAVERN_NOUNS,
  generateRumor,
  generateStreetName,
  generateTavernName,
} from './place-tables'

describe('tavern and street tables', () => {
  it('list a healthy number of options', () => {
    expect(TAVERN_ADJECTIVES.length).toBeGreaterThanOrEqual(10)
    expect(TAVERN_NOUNS.length).toBeGreaterThanOrEqual(12)
    expect(STREET_NAMES.length).toBeGreaterThanOrEqual(10)
    expect(RUMOR_TEMPLATES.length).toBeGreaterThanOrEqual(5)
  })
})

describe('generateTavernName', () => {
  it('always starts with "The "', () => {
    for (let i = 1; i <= 20; i++) {
      const t = generateTavernName(buildSeededRng(i))
      expect(t.name.startsWith('The ')).toBe(true)
      expect(t.name.split(' ')).toHaveLength(3)
    }
  })

  it('is deterministic for a given seed', () => {
    const a = generateTavernName(buildSeededRng(42))
    const b = generateTavernName(buildSeededRng(42))
    expect(a).toEqual(b)
  })

  it('changes when the seed changes', () => {
    const a = generateTavernName(buildSeededRng(1))
    const b = generateTavernName(buildSeededRng(2))
    expect(a.name).not.toBe(b.name)
  })
})

describe('generateStreetName', () => {
  it('combines a base and a suffix', () => {
    const street = generateStreetName(buildSeededRng(3))
    const last = street.name.split(' ').slice(-1)[0]!
    expect(['Way', 'Street', 'Row', 'Lane', 'Walk']).toContain(last)
  })
})

describe('generateRumor', () => {
  it('substitutes the place token', () => {
    const r = generateRumor(buildSeededRng(5), ['the Bone Quay'])
    expect(r.text).toContain('the Bone Quay')
    expect(r.place).toBe('the Bone Quay')
    expect(r.text).not.toContain('{place}')
  })

  it('falls back to a default when no places are provided', () => {
    const r = generateRumor(buildSeededRng(5), [])
    expect(r.text).toContain('the Old Quarter')
  })
})
