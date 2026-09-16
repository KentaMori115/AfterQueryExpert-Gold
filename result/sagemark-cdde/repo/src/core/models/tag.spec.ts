import { describe, expect, it } from 'vitest'

import { asCampaignId, asTagId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  TAG_TARGET_KINDS,
  TAG_TONES,
  type Tag,
  attachedKinds,
  compareTagsForListing,
  isDuplicateSlug,
  isTargetTagged,
  slugifyTagName,
  tagDraftSchema,
  targetCountForKind,
  toneClass,
  toneLabel,
} from './tag'

function build(over: Partial<Tag> = {}): Tag {
  return {
    id: asTagId('tag_X'),
    campaignId: asCampaignId('camp_X'),
    name: 'Iron Banner',
    slug: 'iron-banner',
    tone: 'crimson',
    description: 'soldiers of the second oath',
    appliedTo: [],
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    ...over,
  }
}

describe('constants', () => {
  it('exposes the kinds the editor offers', () => {
    expect(TAG_TARGET_KINDS).toContain('character')
    expect(TAG_TARGET_KINDS).toContain('quest')
    expect(TAG_TARGET_KINDS).not.toContain('campaign')
  })

  it('lists known tones', () => {
    expect(TAG_TONES).toContain('moss')
    expect(TAG_TONES).toContain('ember')
  })

  it('labels and styles every tone', () => {
    for (const tone of TAG_TONES) {
      expect(toneLabel(tone).length).toBeGreaterThan(0)
      expect(toneClass(tone)).toMatch(/bg-/)
    }
  })
})

describe('slugifyTagName', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugifyTagName('Iron Banner')).toBe('iron-banner')
  })

  it('collapses punctuation runs into single dashes', () => {
    expect(slugifyTagName("Iris's Crown!")).toBe('iris-s-crown')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugifyTagName('  --frost--  ')).toBe('frost')
  })

  it('falls back to tag when the name is purely punctuation', () => {
    expect(slugifyTagName('!!!')).toBe('tag')
  })
})

describe('isDuplicateSlug', () => {
  it('matches case sensitively after slugifying', () => {
    const tags = [build({ slug: 'iron-banner' })]
    expect(isDuplicateSlug('iron-banner', tags)).toBe(true)
    expect(isDuplicateSlug('iron-circle', tags)).toBe(false)
  })
})

describe('attachedKinds and targetCountForKind', () => {
  it('lists unique kinds in alphabetical order', () => {
    const tag = build({
      appliedTo: [
        { kind: 'character', id: 'c1' },
        { kind: 'faction', id: 'f1' },
        { kind: 'character', id: 'c2' },
      ],
    })
    expect(attachedKinds(tag)).toEqual(['character', 'faction'])
  })

  it('counts how many of a kind are tagged', () => {
    const tag = build({
      appliedTo: [
        { kind: 'character', id: 'c1' },
        { kind: 'character', id: 'c2' },
        { kind: 'faction', id: 'f1' },
      ],
    })
    expect(targetCountForKind(tag, 'character')).toBe(2)
    expect(targetCountForKind(tag, 'faction')).toBe(1)
    expect(targetCountForKind(tag, 'item')).toBe(0)
  })
})

describe('isTargetTagged', () => {
  it('returns true when the kind and id match', () => {
    const tag = build({ appliedTo: [{ kind: 'character', id: 'c1' }] })
    expect(isTargetTagged(tag, 'character', 'c1')).toBe(true)
    expect(isTargetTagged(tag, 'character', 'c2')).toBe(false)
    expect(isTargetTagged(tag, 'faction', 'c1')).toBe(false)
  })
})

describe('compareTagsForListing', () => {
  it('sorts by usage count then name', () => {
    const sparse = build({ name: 'Bound', slug: 'bound', appliedTo: [] })
    const middle = build({
      name: 'Loose',
      slug: 'loose',
      appliedTo: [{ kind: 'character', id: 'c1' }],
    })
    const heavy = build({
      name: 'Heavy',
      slug: 'heavy',
      appliedTo: [
        { kind: 'character', id: 'c1' },
        { kind: 'character', id: 'c2' },
      ],
    })
    const ordered = [sparse, middle, heavy].sort(compareTagsForListing)
    expect(ordered.map((t) => t.name)).toEqual(['Heavy', 'Loose', 'Bound'])
  })

  it('falls back to alphabetical when usage matches', () => {
    const a = build({ name: 'Alpha', slug: 'alpha' })
    const b = build({ name: 'Bravo', slug: 'bravo' })
    expect(compareTagsForListing(a, b)).toBeLessThan(0)
  })
})

describe('tagDraftSchema', () => {
  it('accepts a clean draft', () => {
    const r = tagDraftSchema.safeParse({ campaignId: 'camp_X', name: 'Iron Banner' })
    expect(r.success).toBe(true)
  })

  it('rejects blank names', () => {
    const r = tagDraftSchema.safeParse({ campaignId: 'camp_X', name: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects names that are too long', () => {
    const r = tagDraftSchema.safeParse({
      campaignId: 'camp_X',
      name: 'x'.repeat(80),
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown tones', () => {
    const r = tagDraftSchema.safeParse({
      campaignId: 'camp_X',
      name: 'Banner',
      tone: 'gold',
    })
    expect(r.success).toBe(false)
  })

  it('rejects descriptions that exceed 280 chars', () => {
    const r = tagDraftSchema.safeParse({
      campaignId: 'camp_X',
      name: 'Banner',
      description: 'x'.repeat(400),
    })
    expect(r.success).toBe(false)
  })
})
