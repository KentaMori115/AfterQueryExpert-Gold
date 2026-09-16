import { describe, expect, it } from 'vitest'

import { buildSeededRng } from '../dice/roll'

import {
  DISPOSITIONS,
  GIVEN_NAMES,
  MOTIVATIONS,
  QUIRKS,
  SURNAMES,
  VOCATIONS,
  formatNpcSeed,
  generateNpcSeed,
  pickFromTable,
} from './npc-tables'

describe('tables', () => {
  it('exposes the expected handfuls of options', () => {
    expect(GIVEN_NAMES.length).toBeGreaterThanOrEqual(20)
    expect(SURNAMES.length).toBeGreaterThanOrEqual(20)
    expect(VOCATIONS.length).toBeGreaterThanOrEqual(15)
    expect(QUIRKS.length).toBeGreaterThanOrEqual(10)
    expect(MOTIVATIONS.length).toBeGreaterThanOrEqual(8)
    expect(DISPOSITIONS.length).toBeGreaterThanOrEqual(6)
  })

  it('every name is non empty and trimmed', () => {
    for (const n of GIVEN_NAMES) expect(n).toMatch(/^[A-Z]/)
    for (const n of SURNAMES) expect(n).toMatch(/^[A-Z]/)
  })
})

describe('pickFromTable', () => {
  it('returns one of the entries', () => {
    const rng = buildSeededRng(42)
    const picked = pickFromTable(['a', 'b', 'c'], rng)
    expect(['a', 'b', 'c']).toContain(picked)
  })

  it('throws on empty tables', () => {
    expect(() => pickFromTable([], () => 0)).toThrow(/empty/)
  })

  it('handles edge of range rng outputs', () => {
    expect(pickFromTable(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(pickFromTable(['a', 'b', 'c'], () => 0.999)).toBe('c')
  })
})

describe('generateNpcSeed', () => {
  it('produces a fully filled NPC seed', () => {
    const seed = generateNpcSeed(buildSeededRng(1))
    expect(seed.name.split(' ')).toHaveLength(2)
    expect(VOCATIONS).toContain(seed.vocation)
    expect(QUIRKS).toContain(seed.quirk)
    expect(MOTIVATIONS).toContain(seed.motivation)
    expect(DISPOSITIONS).toContain(seed.disposition)
  })

  it('is deterministic when the seed is the same', () => {
    const a = generateNpcSeed(buildSeededRng(7))
    const b = generateNpcSeed(buildSeededRng(7))
    expect(a).toEqual(b)
  })

  it('does not produce the same NPC for every seed', () => {
    const seen = new Set<string>()
    for (let i = 1; i <= 50; i++) {
      seen.add(generateNpcSeed(buildSeededRng(i)).name)
    }
    expect(seen.size).toBeGreaterThan(20)
  })
})

describe('formatNpcSeed', () => {
  it('lays out four lines in a stable order', () => {
    const seed = generateNpcSeed(buildSeededRng(3))
    const out = formatNpcSeed(seed)
    const lines = out.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe(seed.name)
    expect(lines[1]).toContain(seed.vocation)
    expect(lines[2]).toContain('Quirk:')
    expect(lines[3]).toContain('Wants:')
  })
})
