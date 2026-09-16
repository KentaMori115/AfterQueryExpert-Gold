import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids/brand'
import { asTimestamp } from '../time/timestamps'

import {
  DOWNTIME_KINDS,
  DOWNTIME_OUTCOMES,
  type DowntimeActivity,
  compareForListing,
  downtimeDraftSchema,
  downtimeKindLabel,
  downtimeKindTone,
  downtimeOutcomeTone,
  totalWeeksFor,
} from './downtime'

const camp = asCampaignId('camp_X')
const charA = asCharacterId('char_A')
const charB = asCharacterId('char_B')

function build(over: Partial<DowntimeActivity> = {}): DowntimeActivity {
  return {
    id: 'dt_X',
    campaignId: camp,
    characterId: charA,
    kind: 'crafting',
    outcome: 'planned',
    weeks: 1,
    description: '',
    reward: '',
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    ...over,
  }
}

describe('constants', () => {
  it('lists all the kinds and outcomes', () => {
    expect(DOWNTIME_KINDS).toContain('crafting')
    expect(DOWNTIME_KINDS).toContain('investigation')
    expect(DOWNTIME_OUTCOMES).toEqual(['planned', 'underway', 'paid off', 'failed'])
  })

  it('every kind has a label and a tone', () => {
    for (const k of DOWNTIME_KINDS) {
      expect(downtimeKindLabel(k).length).toBeGreaterThan(0)
      expect(typeof downtimeKindTone(k)).toBe('string')
    }
  })

  it('every outcome has a tone', () => {
    for (const o of DOWNTIME_OUTCOMES) {
      expect(typeof downtimeOutcomeTone(o)).toBe('string')
    }
  })
})

describe('totalWeeksFor', () => {
  it('sums weeks for the requested character only', () => {
    const list = [
      build({ characterId: charA, weeks: 2 }),
      build({ characterId: charA, weeks: 3 }),
      build({ characterId: charB, weeks: 5 }),
    ]
    expect(totalWeeksFor(list, charA)).toBe(5)
    expect(totalWeeksFor(list, charB)).toBe(5)
  })

  it('clamps negative weeks to zero', () => {
    const list = [build({ characterId: charA, weeks: -3 }), build({ characterId: charA, weeks: 2 })]
    expect(totalWeeksFor(list, charA)).toBe(2)
  })
})

describe('compareForListing', () => {
  it('puts underway first then planned then resolved', () => {
    const planned = build({ outcome: 'planned' })
    const underway = build({ outcome: 'underway' })
    const paid = build({ outcome: 'paid off' })
    const ordered = [paid, planned, underway].sort(compareForListing)
    expect(ordered.map((a) => a.outcome)).toEqual(['underway', 'planned', 'paid off'])
  })

  it('breaks ties by most recently updated', () => {
    const older = build({
      outcome: 'planned',
      updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    })
    const newer = build({
      outcome: 'planned',
      updatedAt: asTimestamp('2026-04-02T10:00:00Z'),
    })
    const ordered = [older, newer].sort(compareForListing)
    expect(ordered[0]).toBe(newer)
  })
})

describe('downtimeDraftSchema', () => {
  it('accepts a clean draft', () => {
    const r = downtimeDraftSchema.safeParse({
      campaignId: camp,
      characterId: charA,
      kind: 'crafting',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown kind', () => {
    const r = downtimeDraftSchema.safeParse({
      campaignId: camp,
      characterId: charA,
      kind: 'haggling',
    })
    expect(r.success).toBe(false)
  })

  it('rejects unreasonable durations', () => {
    const r = downtimeDraftSchema.safeParse({
      campaignId: camp,
      characterId: charA,
      kind: 'crafting',
      weeks: 9999,
    })
    expect(r.success).toBe(false)
  })

  it('rejects long descriptions', () => {
    const r = downtimeDraftSchema.safeParse({
      campaignId: camp,
      characterId: charA,
      kind: 'crafting',
      description: 'x'.repeat(400),
    })
    expect(r.success).toBe(false)
  })
})
