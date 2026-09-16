import { describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids/brand'
import { asTimestamp } from '../time/timestamps'

import {
  HOLIDAY_KINDS,
  type Holiday,
  compareByDate,
  holidayDraftSchema,
  holidayKindLabel,
  holidayKindTone,
  nextUpcoming,
} from './holiday'

function build(over: Partial<Holiday> = {}): Holiday {
  return {
    id: 'hol_X',
    campaignId: asCampaignId('camp_X'),
    name: 'Frost Eve',
    month: 12,
    day: 31,
    kind: 'feast',
    observance: 'candles in every window',
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    ...over,
  }
}

describe('constants', () => {
  it('lists every kind with a label and tone', () => {
    expect(HOLIDAY_KINDS).toContain('feast')
    for (const k of HOLIDAY_KINDS) {
      expect(holidayKindLabel(k).length).toBeGreaterThan(0)
      expect(typeof holidayKindTone(k)).toBe('string')
    }
  })
})

describe('compareByDate', () => {
  it('sorts by month then day then name', () => {
    const a = build({ name: 'Spring', month: 3, day: 1 })
    const b = build({ name: 'Summer', month: 6, day: 1 })
    const c = build({ name: 'Summer Eve', month: 6, day: 1 })
    const sorted = [c, a, b].sort(compareByDate)
    expect(sorted.map((h) => h.name)).toEqual(['Spring', 'Summer', 'Summer Eve'])
  })
})

describe('nextUpcoming', () => {
  const shape = { monthsPerYear: 12, daysPerMonth: 30 }
  const holidays = [
    build({ name: 'Frost Eve', month: 12, day: 30 }),
    build({ name: 'Sun High', month: 6, day: 21 }),
    build({ name: 'Bone Eve', month: 9, day: 30 }),
    build({ name: 'Awakening', month: 3, day: 15 }),
  ]

  it('returns the next few starting from the cursor', () => {
    const result = nextUpcoming(holidays, shape, { month: 6, day: 1 }, 2)
    expect(result.map((h) => h.name)).toEqual(['Sun High', 'Bone Eve'])
  })

  it('wraps around the year when there are not enough upcoming', () => {
    const result = nextUpcoming(holidays, shape, { month: 11, day: 1 }, 3)
    expect(result.map((h) => h.name)).toEqual(['Frost Eve', 'Awakening', 'Sun High'])
  })
})

describe('holidayDraftSchema', () => {
  it('accepts a clean draft', () => {
    expect(
      holidayDraftSchema.safeParse({
        campaignId: 'camp_X',
        name: 'Festival',
        month: 4,
        day: 15,
      }).success,
    ).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(
      holidayDraftSchema.safeParse({ campaignId: 'camp_X', name: '   ', month: 1, day: 1 }).success,
    ).toBe(false)
  })

  it('rejects out of range months and days', () => {
    expect(
      holidayDraftSchema.safeParse({
        campaignId: 'camp_X',
        name: 'X',
        month: 99,
        day: 1,
      }).success,
    ).toBe(false)
    expect(
      holidayDraftSchema.safeParse({ campaignId: 'camp_X', name: 'X', month: 1, day: 99 }).success,
    ).toBe(false)
  })
})
