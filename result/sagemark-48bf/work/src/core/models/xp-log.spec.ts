import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  XP_ENTRY_KINDS,
  type XpEntry,
  applySignedAmount,
  kindLabel,
  summariseEntry,
  totalXpFromLog,
  xpEntryDraftSchema,
} from './xp-log'

function build(over: Partial<XpEntry> = {}): XpEntry {
  return {
    id: 'xp_A',
    campaignId: asCampaignId('camp_X'),
    characterId: asCharacterId('char_X'),
    kind: 'award',
    amount: 100,
    reason: '',
    recordedAt: asTimestamp('2026-02-01T10:00:00Z'),
    ...over,
  }
}

describe('constants and labels', () => {
  it('lists kinds', () => {
    expect(XP_ENTRY_KINDS).toEqual(['award', 'deduct', 'milestone'])
  })

  it.each([
    ['award', 'Award'],
    ['deduct', 'Deduct'],
    ['milestone', 'Milestone'],
  ] as const)('labels %s', (k, expected) => {
    expect(kindLabel(k)).toBe(expected)
  })
})

describe('applySignedAmount', () => {
  it('treats award as positive', () => {
    expect(applySignedAmount(build({ kind: 'award', amount: 50 }))).toBe(50)
  })

  it('treats deduct as negative', () => {
    expect(applySignedAmount(build({ kind: 'deduct', amount: 50 }))).toBe(-50)
  })

  it('treats milestone as positive', () => {
    expect(applySignedAmount(build({ kind: 'milestone', amount: 500 }))).toBe(500)
  })
})

describe('totalXpFromLog', () => {
  it('sums entries respecting kind', () => {
    const total = totalXpFromLog([
      build({ kind: 'award', amount: 200 }),
      build({ kind: 'deduct', amount: 50 }),
      build({ kind: 'milestone', amount: 100 }),
    ])
    expect(total).toBe(250)
  })

  it('floors at zero when the log goes negative', () => {
    const total = totalXpFromLog([
      build({ kind: 'award', amount: 100 }),
      build({ kind: 'deduct', amount: 500 }),
    ])
    expect(total).toBe(0)
  })

  it('returns zero for empty log', () => {
    expect(totalXpFromLog([])).toBe(0)
  })
})

describe('summariseEntry', () => {
  it('formats award entries', () => {
    expect(summariseEntry(build({ amount: 100, reason: 'finished arc' }))).toContain('Award +100')
    expect(summariseEntry(build({ amount: 100, reason: 'finished arc' }))).toContain('finished arc')
  })

  it('formats deduct entries with minus sign', () => {
    expect(summariseEntry(build({ kind: 'deduct', amount: 50 }))).toBe('Deduct -50')
  })
})

describe('xpEntryDraftSchema', () => {
  it('accepts a valid draft', () => {
    const r = xpEntryDraftSchema.safeParse({
      campaignId: 'camp_X',
      characterId: 'char_X',
      amount: 100,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a negative amount', () => {
    const r = xpEntryDraftSchema.safeParse({
      campaignId: 'camp_X',
      characterId: 'char_X',
      amount: -1,
    })
    expect(r.success).toBe(false)
  })

  it('rejects a non integer amount', () => {
    const r = xpEntryDraftSchema.safeParse({
      campaignId: 'camp_X',
      characterId: 'char_X',
      amount: 1.5,
    })
    expect(r.success).toBe(false)
  })
})
