import { describe, expect, it } from 'vitest'
import { expandRecurrence, weekdayUtc } from './rrule'

const MON = Date.UTC(2024, 0, 1)
const DAY = 86_400_000

describe('expandRecurrence', () => {
  it('emits weekly dates on selected weekdays and skips exceptions', () => {
    expect(weekdayUtc(MON, 0)).toBe(1)
    const dates = expandRecurrence(MON, {
      frequency: 'weekly',
      interval: 1,
      byWeekday: [1],
      count: 4,
      exdates: [MON + 14 * DAY],
    }, MON + 40 * DAY)
    expect(dates).toEqual([MON, MON + 7 * DAY, MON + 21 * DAY, MON + 28 * DAY])
  })

  it('respects a timezone offset when picking month days', () => {
    const start = Date.UTC(2024, 0, 31, 22, 0, 0)
    const dates = expandRecurrence(start, {
      frequency: 'monthly',
      interval: 1,
      byMonthDay: 1,
      count: 2,
      tzOffsetMinutes: 180,
    }, Date.UTC(2024, 3, 1))
    expect(dates).toHaveLength(2)
    expect(new Date(dates[0] + 180 * 60_000).getUTCDate()).toBe(1)
  })

  it('stops at until even when more count remains', () => {
    const dates = expandRecurrence(MON, {
      frequency: 'daily',
      interval: 1,
      count: 10,
      until: MON + 2 * DAY,
    }, MON + 20 * DAY)
    expect(dates).toEqual([MON, MON + DAY, MON + 2 * DAY])
  })
})
