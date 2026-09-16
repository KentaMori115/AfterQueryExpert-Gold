import { describe, expect, it } from 'vitest'

import { asCampaignId, asItemId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  ITEM_KINDS,
  ITEM_RARITIES,
  type Item,
  formatGold,
  isUnowned,
  itemDraftSchema,
  kindLabel,
  rarityLabel,
  rarityTone,
} from './item'

function build(over: Partial<Item> = {}): Item {
  return {
    id: asItemId('itm_X'),
    campaignId: asCampaignId('camp_X'),
    name: 'Frostbrand',
    kind: 'weapon',
    rarity: 'rare',
    magical: true,
    attuned: false,
    ownerId: null,
    description: '',
    valueGp: 200,
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('constants and labels', () => {
  it('lists kinds and rarities', () => {
    expect(ITEM_KINDS).toContain('weapon')
    expect(ITEM_RARITIES).toContain('legendary')
  })

  it('labels all kinds', () => {
    for (const k of ITEM_KINDS) expect(kindLabel(k).length).toBeGreaterThan(0)
  })

  it.each([
    ['common', 'neutral'],
    ['uncommon', 'info'],
    ['rare', 'success'],
    ['very-rare', 'warning'],
    ['legendary', 'danger'],
    ['artifact', 'danger'],
  ] as const)('rarityTone %s -> %s', (r, expected) => {
    expect(rarityTone(r)).toBe(expected)
  })

  it.each([
    ['common', 'Common'],
    ['very-rare', 'Very rare'],
  ] as const)('rarityLabel %s -> %s', (r, expected) => {
    expect(rarityLabel(r)).toBe(expected)
  })
})

describe('formatGold', () => {
  it.each([
    [0, 'no listed value'],
    [-5, 'no listed value'],
    [0.5, '50 cp'],
    [42, '42 gp'],
    [1500, '1.5k gp'],
  ] as const)('formats %d -> %s', (gp, expected) => {
    expect(formatGold(gp)).toBe(expected)
  })
})

describe('isUnowned', () => {
  it('true when ownerId is null', () => {
    expect(isUnowned(build({ ownerId: null }))).toBe(true)
  })
  it('false when owner is set', () => {
    expect(isUnowned(build({ ownerId: 'char_x' as never }))).toBe(false)
  })
})

describe('itemDraftSchema', () => {
  it('accepts valid', () => {
    expect(itemDraftSchema.safeParse({ campaignId: 'c', name: 'X' }).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(itemDraftSchema.safeParse({ campaignId: 'c', name: '  ' }).success).toBe(false)
  })

  it('rejects negative value', () => {
    expect(itemDraftSchema.safeParse({ campaignId: 'c', name: 'X', valueGp: -1 }).success).toBe(false)
  })

  it('rejects attuned non-magical', () => {
    expect(
      itemDraftSchema.safeParse({
        campaignId: 'c',
        name: 'X',
        magical: false,
        attuned: true,
      }).success,
    ).toBe(false)
  })

  it('accepts attuned + magical', () => {
    expect(
      itemDraftSchema.safeParse({
        campaignId: 'c',
        name: 'X',
        magical: true,
        attuned: true,
      }).success,
    ).toBe(true)
  })
})
