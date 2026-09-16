import { describe, expect, it } from 'vitest'

import { asCampaignId, asFactionId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  FACTION_ALIGNMENTS,
  FACTION_SCOPES,
  type Faction,
  alignmentLabel,
  alignmentTone,
  factionDraftSchema,
  influenceTier,
  influenceTierLabel,
  scopeLabel,
} from './faction'

function build(over: Partial<Faction> = {}): Faction {
  return {
    id: asFactionId('fac_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    name: 'Crimson Order',
    motto: 'In silence, we hunt',
    description: '',
    alignment: 'neutral',
    scope: 'regional',
    influence: 40,
    leaderId: null,
    seatId: null,
    active: true,
    createdAt: asTimestamp('2025-04-01T00:00:00Z'),
    updatedAt: asTimestamp('2025-04-01T00:00:00Z'),
    ...over,
  }
}

describe('constants', () => {
  it('contains the five alignments', () => {
    expect(FACTION_ALIGNMENTS).toHaveLength(5)
  })

  it('contains the scopes', () => {
    expect(FACTION_SCOPES).toContain('national')
  })
})

describe('alignmentLabel / alignmentTone', () => {
  it.each([
    ['good', 'Good'],
    ['neutral', 'Neutral'],
    ['evil', 'Evil'],
    ['mixed', 'Mixed'],
    ['unknown', 'Unknown'],
  ] as const)('labels %s -> %s', (a, expected) => {
    expect(alignmentLabel(a)).toBe(expected)
  })

  it.each([
    ['good', 'success'],
    ['mixed', 'warning'],
    ['evil', 'danger'],
    ['neutral', 'info'],
    ['unknown', 'neutral'],
  ] as const)('tones %s -> %s', (a, expected) => {
    expect(alignmentTone(a)).toBe(expected)
  })
})

describe('scopeLabel', () => {
  it.each([
    ['town', 'Town'],
    ['regional', 'Regional'],
    ['national', 'National'],
    ['global', 'Global'],
    ['hidden', 'Hidden'],
  ] as const)('labels scope %s -> %s', (s, expected) => {
    expect(scopeLabel(s)).toBe(expected)
  })
})

describe('influenceTier / influenceTierLabel', () => {
  it.each([
    [0, 'fringe'],
    [10, 'fringe'],
    [19, 'fringe'],
    [20, 'rising'],
    [40, 'rising'],
    [49, 'rising'],
    [50, 'major'],
    [70, 'major'],
    [79, 'major'],
    [80, 'dominant'],
    [99, 'dominant'],
    [100, 'dominant'],
  ] as const)('tier for %d', (n, tier) => {
    expect(influenceTier(n)).toBe(tier)
  })

  it('labels each tier with a phrase', () => {
    expect(influenceTierLabel(5)).toContain('fringe')
    expect(influenceTierLabel(30)).toContain('rise')
    expect(influenceTierLabel(60)).toContain('major')
    expect(influenceTierLabel(90)).toBe('Dominant')
  })
})

describe('factionDraftSchema', () => {
  it('accepts a minimal valid draft', () => {
    expect(factionDraftSchema.safeParse({ campaignId: 'camp_1', name: 'Order' }).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(factionDraftSchema.safeParse({ campaignId: 'camp_1', name: '   ' }).success).toBe(false)
  })

  it('rejects influence out of range', () => {
    expect(factionDraftSchema.safeParse({ campaignId: 'camp_1', name: 'x', influence: -1 }).success).toBe(false)
    expect(factionDraftSchema.safeParse({ campaignId: 'camp_1', name: 'x', influence: 200 }).success).toBe(false)
  })

  it('rejects unknown alignment', () => {
    expect(factionDraftSchema.safeParse({ campaignId: 'camp_1', name: 'x', alignment: 'lawful' }).success).toBe(false)
  })

  it('passes a populated faction through', () => {
    const data = build()
    const r = factionDraftSchema.safeParse({
      campaignId: data.campaignId,
      name: data.name,
      motto: data.motto,
      alignment: data.alignment,
      scope: data.scope,
      influence: data.influence,
    })
    expect(r.success).toBe(true)
  })
})
