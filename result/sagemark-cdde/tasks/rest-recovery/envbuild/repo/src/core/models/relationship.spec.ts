import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asFactionId, asRelationshipId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  RELATIONSHIP_KINDS,
  type Relationship,
  endpointsMatch,
  intensityWidth,
  involvesNode,
  kindLabel,
  kindTone,
  relationshipDraftSchema,
} from './relationship'

function build(over: Partial<Relationship> = {}): Relationship {
  return {
    id: asRelationshipId('rel_X'),
    campaignId: asCampaignId('camp_X'),
    from: { kind: 'character', id: asCharacterId('char_A') },
    to: { kind: 'character', id: asCharacterId('char_B') },
    kind: 'ally',
    intensity: 3,
    note: '',
    reciprocal: true,
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('constants and labels', () => {
  it('lists all the kinds', () => {
    expect(RELATIONSHIP_KINDS).toContain('ally')
    expect(RELATIONSHIP_KINDS).toContain('enemy')
  })

  it.each([
    ['ally', 'success'],
    ['family', 'success'],
    ['mentor', 'info'],
    ['rival', 'warning'],
    ['enemy', 'danger'],
    ['unknown', 'neutral'],
  ] as const)('kindTone %s -> %s', (k, expected) => {
    expect(kindTone(k)).toBe(expected)
  })

  it('labels each kind', () => {
    for (const k of RELATIONSHIP_KINDS) {
      expect(kindLabel(k).length).toBeGreaterThan(0)
    }
  })
})

describe('endpointsMatch / involvesNode', () => {
  it('matches identical endpoints', () => {
    expect(
      endpointsMatch(
        { kind: 'character', id: asCharacterId('a') },
        { kind: 'character', id: asCharacterId('a') },
      ),
    ).toBe(true)
  })

  it('does not match across kinds', () => {
    expect(
      endpointsMatch(
        { kind: 'character', id: asCharacterId('x') },
        { kind: 'faction', id: asFactionId('x') },
      ),
    ).toBe(false)
  })

  it('involvesNode finds either endpoint', () => {
    const r = build()
    expect(involvesNode(r, { kind: 'character', id: asCharacterId('char_A') })).toBe(true)
    expect(involvesNode(r, { kind: 'character', id: asCharacterId('char_B') })).toBe(true)
    expect(involvesNode(r, { kind: 'character', id: asCharacterId('char_C') })).toBe(false)
  })
})

describe('intensityWidth', () => {
  it.each([
    [1, 20],
    [2, 40],
    [3, 60],
    [4, 80],
    [5, 100],
    [0, 20],
    [99, 100],
  ] as const)('intensity %d -> %d%%', (i, expected) => {
    expect(intensityWidth(i)).toBe(expected)
  })
})

describe('relationshipDraftSchema', () => {
  it('accepts a valid draft', () => {
    const r = relationshipDraftSchema.safeParse({
      campaignId: 'c',
      from: { kind: 'character', id: 'a' },
      to: { kind: 'character', id: 'b' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects self-link', () => {
    const r = relationshipDraftSchema.safeParse({
      campaignId: 'c',
      from: { kind: 'character', id: 'a' },
      to: { kind: 'character', id: 'a' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects bad intensity', () => {
    const r = relationshipDraftSchema.safeParse({
      campaignId: 'c',
      from: { kind: 'character', id: 'a' },
      to: { kind: 'character', id: 'b' },
      intensity: 9,
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown kind', () => {
    const r = relationshipDraftSchema.safeParse({
      campaignId: 'c',
      from: { kind: 'character', id: 'a' },
      to: { kind: 'character', id: 'b' },
      kind: 'married',
    })
    expect(r.success).toBe(false)
  })
})
