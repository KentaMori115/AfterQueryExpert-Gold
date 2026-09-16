import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  CHARACTER_DISPOSITIONS,
  CHARACTER_KINDS,
  type Character,
  characterDraftSchema,
  characterFullName,
  dispositionLabel,
  dispositionTone,
  isAliveAndRelevant,
  isPlayerCharacter,
  kindLabel,
} from './character'

function build(over: Partial<Character> = {}): Character {
  return {
    id: asCharacterId('char_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    kind: 'npc',
    name: 'Iris Thorne',
    pronouns: 'she/her',
    ancestry: 'human',
    vocation: 'warden',
    level: 7,
    disposition: 'allied',
    factionId: null,
    homeId: null,
    blurb: '',
    alive: true,
    createdAt: asTimestamp('2025-04-01T00:00:00Z'),
    updatedAt: asTimestamp('2025-04-01T00:00:00Z'),
    ...over,
  }
}

describe('constants', () => {
  it('exposes the two kinds', () => {
    expect(CHARACTER_KINDS).toEqual(['pc', 'npc'])
  })

  it('lists dispositions', () => {
    expect(CHARACTER_DISPOSITIONS).toContain('hostile')
    expect(CHARACTER_DISPOSITIONS.length).toBeGreaterThanOrEqual(5)
  })
})

describe('label helpers', () => {
  it('labels kinds', () => {
    expect(kindLabel('pc')).toBe('PC')
    expect(kindLabel('npc')).toBe('NPC')
  })

  it.each([
    ['friendly', 'Friendly'],
    ['allied', 'Allied'],
    ['neutral', 'Neutral'],
    ['suspicious', 'Suspicious'],
    ['hostile', 'Hostile'],
    ['unknown', 'Unknown'],
  ] as const)('labels disposition %s -> %s', (d, expected) => {
    expect(dispositionLabel(d)).toBe(expected)
  })

  it.each([
    ['allied', 'success'],
    ['friendly', 'success'],
    ['suspicious', 'warning'],
    ['hostile', 'danger'],
    ['neutral', 'info'],
    ['unknown', 'neutral'],
  ] as const)('tones disposition %s -> %s', (d, expected) => {
    expect(dispositionTone(d)).toBe(expected)
  })
})

describe('characterFullName', () => {
  it('joins name + vocation when present', () => {
    expect(characterFullName(build({ name: 'Iris', vocation: 'warden' }))).toBe('Iris the warden')
  })

  it('falls back to name only when no vocation', () => {
    expect(characterFullName(build({ name: 'Iris', vocation: '' }))).toBe('Iris')
  })
})

describe('predicates', () => {
  it('isPlayerCharacter only true for pc kind', () => {
    expect(isPlayerCharacter(build({ kind: 'pc' }))).toBe(true)
    expect(isPlayerCharacter(build({ kind: 'npc' }))).toBe(false)
  })

  it('isAliveAndRelevant requires alive and known disposition', () => {
    expect(isAliveAndRelevant(build({ alive: true, disposition: 'allied' }))).toBe(true)
    expect(isAliveAndRelevant(build({ alive: false, disposition: 'allied' }))).toBe(false)
    expect(isAliveAndRelevant(build({ alive: true, disposition: 'unknown' }))).toBe(false)
  })
})

describe('characterDraftSchema', () => {
  it('accepts a minimal valid draft', () => {
    const r = characterDraftSchema.safeParse({ campaignId: 'camp_1', name: 'Kael' })
    expect(r.success).toBe(true)
  })

  it('rejects empty name', () => {
    const r = characterDraftSchema.safeParse({ campaignId: 'camp_1', name: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects level out of range', () => {
    const r = characterDraftSchema.safeParse({ campaignId: 'camp_1', name: 'x', level: -1 })
    expect(r.success).toBe(false)
    const r2 = characterDraftSchema.safeParse({ campaignId: 'camp_1', name: 'x', level: 99 })
    expect(r2.success).toBe(false)
  })

  it('rejects unknown disposition', () => {
    const r = characterDraftSchema.safeParse({ campaignId: 'camp_1', name: 'x', disposition: 'mythic' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown kind', () => {
    const r = characterDraftSchema.safeParse({ campaignId: 'camp_1', name: 'x', kind: 'monster' })
    expect(r.success).toBe(false)
  })
})
