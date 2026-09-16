import { describe, expect, it } from 'vitest'

import { buildSeededRng } from '../dice/roll'

import {
  REGIONAL_TRINKETS,
  TRINKETS,
  generateBatch,
  generateTrinket,
  knownRegions,
} from './trinket-tables'

describe('tables', () => {
  it('exposes a healthy palette of generic trinkets', () => {
    expect(TRINKETS.length).toBeGreaterThanOrEqual(15)
    for (const t of TRINKETS) expect(t.length).toBeGreaterThan(10)
  })

  it('knownRegions returns the keys of the regional table', () => {
    expect(knownRegions()).toEqual(Object.keys(REGIONAL_TRINKETS))
  })
})

describe('generateTrinket', () => {
  it('is deterministic for the same seed', () => {
    const a = generateTrinket(buildSeededRng(1))
    const b = generateTrinket(buildSeededRng(1))
    expect(a).toEqual(b)
  })

  it('uses a regional entry sometimes when a region is provided', () => {
    let regionalHits = 0
    for (let s = 1; s <= 50; s++) {
      const t = generateTrinket(buildSeededRng(s), 'forest')
      if (t.region === 'forest') regionalHits += 1
    }
    expect(regionalHits).toBeGreaterThan(0)
  })

  it('falls back to generic when region is unknown', () => {
    const t = generateTrinket(buildSeededRng(1), 'sky')
    expect(t.region).toBeNull()
  })
})

describe('generateBatch', () => {
  it('returns the requested count', () => {
    const batch = generateBatch(buildSeededRng(1), 5)
    expect(batch).toHaveLength(5)
  })

  it('avoids duplicate descriptions within a batch', () => {
    const batch = generateBatch(buildSeededRng(1), 5)
    const set = new Set(batch.map((t) => t.description))
    expect(set.size).toBe(batch.length)
  })

  it('clamps the count to 1 minimum and 20 maximum', () => {
    expect(generateBatch(buildSeededRng(1), 0)).toHaveLength(1)
    expect(generateBatch(buildSeededRng(1), 99)).toHaveLength(20)
  })
})
