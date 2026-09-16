import { describe, expect, it } from 'vitest'

import { asCampaignId, asLoreId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  LORE_CATEGORIES,
  type LoreEntry,
  categoryLabel,
  freeTextMatches,
  loreDraftSchema,
  matchesTag,
  normaliseTags,
} from './lore'

function build(over: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: asLoreId('lor_X'),
    campaignId: asCampaignId('camp_X'),
    title: 'The Frostbite Compact',
    body: 'An old treaty between three towns to share grain in winter',
    category: 'history',
    tags: ['frost', 'treaty'],
    revealed: false,
    pinned: false,
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('constants', () => {
  it('lists categories', () => {
    expect(LORE_CATEGORIES).toContain('history')
    expect(LORE_CATEGORIES).toContain('rumor')
  })

  it('labels every category', () => {
    for (const c of LORE_CATEGORIES) {
      expect(categoryLabel(c).length).toBeGreaterThan(0)
    }
  })
})

describe('normaliseTags', () => {
  it('lowercases, trims, and dedupes', () => {
    expect(normaliseTags(['Frost', '  frost ', 'TREATY', 'frost'])).toEqual(['frost', 'treaty'])
  })

  it('drops empty entries', () => {
    expect(normaliseTags(['ok', '  ', ''])).toEqual(['ok'])
  })
})

describe('matchesTag', () => {
  it('is case insensitive', () => {
    expect(matchesTag(build(), 'TREATY')).toBe(true)
  })

  it('rejects non-matching tag', () => {
    expect(matchesTag(build(), 'gnomes')).toBe(false)
  })

  it('rejects empty needle', () => {
    expect(matchesTag(build(), '   ')).toBe(false)
  })
})

describe('freeTextMatches', () => {
  it('matches in the title', () => {
    expect(freeTextMatches(build(), 'frostbite')).toBe(true)
  })

  it('matches in the body', () => {
    expect(freeTextMatches(build(), 'treaty between')).toBe(true)
  })

  it('matches in tags', () => {
    expect(freeTextMatches(build(), 'frost')).toBe(true)
  })

  it('returns true for empty query (no filter)', () => {
    expect(freeTextMatches(build(), '')).toBe(true)
  })

  it('returns false for unrelated query', () => {
    expect(freeTextMatches(build(), 'dragon')).toBe(false)
  })
})

describe('loreDraftSchema', () => {
  it('accepts valid', () => {
    expect(loreDraftSchema.safeParse({ campaignId: 'c', title: 'X' }).success).toBe(true)
  })

  it('rejects empty title', () => {
    expect(loreDraftSchema.safeParse({ campaignId: 'c', title: '  ' }).success).toBe(false)
  })

  it('rejects oversized tag list', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`)
    expect(loreDraftSchema.safeParse({ campaignId: 'c', title: 'X', tags }).success).toBe(false)
  })

  it('rejects unknown category', () => {
    expect(loreDraftSchema.safeParse({ campaignId: 'c', title: 'X', category: 'food' }).success).toBe(false)
  })
})
