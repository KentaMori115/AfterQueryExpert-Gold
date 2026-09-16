import { describe, expect, it, expectTypeOf } from 'vitest'

import {
  asArcId,
  asCampaignId,
  asCharacterId,
  asFactionId,
  asLocationId,
  asSessionId,
  type CampaignId,
  type CharacterId,
} from './brand'

describe('brand constructors', () => {
  it('returns the same string back', () => {
    expect(asCampaignId('camp_123')).toBe('camp_123')
    expect(asCharacterId('char_xyz')).toBe('char_xyz')
    expect(asFactionId('fac_a1')).toBe('fac_a1')
    expect(asLocationId('loc_b2')).toBe('loc_b2')
    expect(asSessionId('ses_c3')).toBe('ses_c3')
    expect(asArcId('arc_d4')).toBe('arc_d4')
  })

  it('keeps brand types disjoint at the type level', () => {
    const camp: CampaignId = asCampaignId('camp_1')
    const char: CharacterId = asCharacterId('char_1')
    expectTypeOf(camp).not.toEqualTypeOf<CharacterId>()
    expectTypeOf(char).not.toEqualTypeOf<CampaignId>()
  })
})
