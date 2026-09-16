import { describe, expect, it } from 'vitest'

import { asCampaignId, asTimelineEventId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  TIMELINE_ERAS,
  TIMELINE_SIGNIFICANCES,
  type TimelineEvent,
  compareDates,
  eraLabel,
  formatInWorldDate,
  groupByEra,
  significanceLabel,
  significanceWeight,
  sortChronologically,
  timelineDraftSchema,
} from './timeline'

function build(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: asTimelineEventId('tle_X'),
    campaignId: asCampaignId('camp_X'),
    title: 'The Pact of Thorns',
    description: '',
    date: { year: 1234, month: 6, day: 15 },
    era: 'middle',
    significance: 'major',
    revealed: false,
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('constants and labels', () => {
  it('lists eras', () => {
    expect(TIMELINE_ERAS).toContain('antiquity')
    expect(TIMELINE_SIGNIFICANCES).toContain('world-shifting')
  })

  it.each([
    ['before-recorded', 'Before Recorded'],
    ['middle', 'Middle Ages'],
    ['present', 'Present'],
  ] as const)('eraLabel %s -> %s', (e, expected) => {
    expect(eraLabel(e)).toBe(expected)
  })

  it.each([
    ['minor', 1],
    ['notable', 2],
    ['major', 3],
    ['world-shifting', 4],
  ] as const)('significanceWeight %s -> %d', (s, expected) => {
    expect(significanceWeight(s)).toBe(expected)
  })

  it('labels all significances', () => {
    for (const s of TIMELINE_SIGNIFICANCES) {
      expect(significanceLabel(s).length).toBeGreaterThan(0)
    }
  })
})

describe('compareDates', () => {
  it('compares by year first', () => {
    expect(compareDates({ year: 1000 }, { year: 1100 })).toBeLessThan(0)
  })

  it('compares by month when year ties', () => {
    expect(compareDates({ year: 1000, month: 1 }, { year: 1000, month: 6 })).toBeLessThan(0)
  })

  it('compares by day when year + month tie', () => {
    expect(compareDates({ year: 1000, month: 3, day: 5 }, { year: 1000, month: 3, day: 28 })).toBeLessThan(0)
  })

  it('treats missing parts as 0', () => {
    expect(compareDates({ year: 1000 }, { year: 1000, month: 1 })).toBeLessThan(0)
  })
})

describe('formatInWorldDate', () => {
  it.each([
    [{ year: 1234, month: 6, day: 15 }, '', '06/15/1234'],
    [{ year: 1234, month: 6 }, '', 'm6, 1234'],
    [{ year: 1234 }, '', '1234'],
    [{ year: 1234 }, ' DR', '1234 DR'],
  ] as const)('formats %j -> %s', (d, suffix, expected) => {
    expect(formatInWorldDate(d, { yearSuffix: suffix })).toBe(expected)
  })
})

describe('sortChronologically + groupByEra', () => {
  it('sorts ascending by date', () => {
    const a = build({ date: { year: 1500 } })
    const b = build({ date: { year: 1000 } })
    const c = build({ date: { year: 1200 } })
    expect(sortChronologically([a, b, c]).map((e) => e.date.year)).toEqual([1000, 1200, 1500])
  })

  it('groups by era and contains every era key', () => {
    const a = build({ era: 'antiquity', date: { year: -200 } })
    const b = build({ era: 'middle', date: { year: 1100 } })
    const grouped = groupByEra([a, b])
    expect(Object.keys(grouped).sort()).toEqual(
      ['antiquity', 'before-recorded', 'classical', 'future', 'middle', 'present'].sort(),
    )
    expect(grouped.antiquity).toHaveLength(1)
    expect(grouped.future).toEqual([])
  })
})

describe('timelineDraftSchema', () => {
  it('accepts valid', () => {
    expect(timelineDraftSchema.safeParse({
      campaignId: 'c',
      title: 'X',
      date: { year: 1234 },
    }).success).toBe(true)
  })

  it('rejects empty title', () => {
    expect(timelineDraftSchema.safeParse({
      campaignId: 'c',
      title: '   ',
      date: { year: 1 },
    }).success).toBe(false)
  })

  it('rejects bad month', () => {
    expect(timelineDraftSchema.safeParse({
      campaignId: 'c',
      title: 'X',
      date: { year: 1, month: 15 },
    }).success).toBe(false)
  })
})
