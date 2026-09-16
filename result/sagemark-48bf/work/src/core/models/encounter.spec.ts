import { describe, expect, it } from 'vitest'

import { asCampaignId, asEncounterId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  ENCOUNTER_DIFFICULTIES,
  ENCOUNTER_KINDS,
  type Encounter,
  type InitiativeEntry,
  difficultyLabel,
  difficultyTone,
  downedCount,
  encounterDraftSchema,
  kindLabel,
  rolledInitiativeOrder,
} from './encounter'

function entry(over: Partial<InitiativeEntry>): InitiativeEntry {
  return {
    characterId: null,
    name: 'X',
    initiative: 10,
    hp: 10,
    notes: '',
    ...over,
  }
}

function build(over: Partial<Encounter> = {}): Encounter {
  return {
    id: asEncounterId('enc_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    sessionId: null,
    locationId: null,
    title: 'Goblin Ambush',
    kind: 'combat',
    difficulty: 'medium',
    summary: '',
    initiative: [],
    resolved: false,
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('constants', () => {
  it('exposes kinds and difficulties', () => {
    expect(ENCOUNTER_KINDS).toContain('combat')
    expect(ENCOUNTER_DIFFICULTIES).toContain('deadly')
  })
})

describe('labels and tones', () => {
  it.each([
    ['combat', 'Combat'],
    ['social', 'Social'],
    ['puzzle', 'Puzzle'],
    ['chase', 'Chase'],
    ['mixed', 'Mixed'],
  ] as const)('labels kind %s', (k, expected) => {
    expect(kindLabel(k)).toBe(expected)
  })

  it.each([
    ['trivial', 'success'],
    ['easy', 'success'],
    ['medium', 'info'],
    ['hard', 'warning'],
    ['deadly', 'danger'],
  ] as const)('difficultyTone %s -> %s', (d, expected) => {
    expect(difficultyTone(d)).toBe(expected)
  })

  it.each([
    ['trivial', 'Trivial'],
    ['deadly', 'Deadly'],
  ] as const)('difficultyLabel %s', (d, expected) => {
    expect(difficultyLabel(d)).toBe(expected)
  })
})

describe('rolledInitiativeOrder', () => {
  it('sorts descending by initiative', () => {
    const a = entry({ name: 'A', initiative: 5 })
    const b = entry({ name: 'B', initiative: 20 })
    const c = entry({ name: 'C', initiative: 10 })
    const order = rolledInitiativeOrder([a, b, c]).map((e) => e.name)
    expect(order).toEqual(['B', 'C', 'A'])
  })

  it('tiebreaks on name', () => {
    const a = entry({ name: 'Zelda', initiative: 10 })
    const b = entry({ name: 'Alva', initiative: 10 })
    const order = rolledInitiativeOrder([a, b]).map((e) => e.name)
    expect(order).toEqual(['Alva', 'Zelda'])
  })
})

describe('downedCount', () => {
  it('counts entries at hp <= 0', () => {
    expect(
      downedCount([
        entry({ hp: 10 }),
        entry({ hp: 0 }),
        entry({ hp: -3 }),
      ]),
    ).toBe(2)
  })
})

describe('encounterDraftSchema', () => {
  it('accepts a valid draft', () => {
    expect(encounterDraftSchema.safeParse({ campaignId: 'c', title: 'X' }).success).toBe(true)
  })

  it('rejects empty title', () => {
    expect(encounterDraftSchema.safeParse({ campaignId: 'c', title: '  ' }).success).toBe(false)
  })

  it('rejects bad initiative entry', () => {
    const r = encounterDraftSchema.safeParse({
      campaignId: 'c',
      title: 'X',
      initiative: [{ characterId: null, name: '', initiative: 10, hp: 10, notes: '' }],
    })
    expect(r.success).toBe(false)
  })

  it('rejects more than 20 entries', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      characterId: null,
      name: `g${i}`,
      initiative: 5,
      hp: 5,
      notes: '',
    }))
    expect(encounterDraftSchema.safeParse({ campaignId: 'c', title: 'X', initiative: many }).success).toBe(false)
  })
})

describe('Encounter build helper', () => {
  it('builds a default encounter', () => {
    const e = build()
    expect(e.kind).toBe('combat')
    expect(e.difficulty).toBe('medium')
  })
})
