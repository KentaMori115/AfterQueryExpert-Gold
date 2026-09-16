import { describe, expect, it } from 'vitest'

import {
  CalendarError,
  advanceDays,
  assertShape,
  buildMonthGrid,
  compareDays,
  daysBetween,
  formatDayShort,
  groupEventsByDay,
  ordinalDayOfYear,
  totalDaysPerYear,
} from './inworld-calendar'

const shape = { monthsPerYear: 12, daysPerMonth: 30 }

describe('assertShape', () => {
  it('accepts a reasonable shape', () => {
    expect(() => assertShape(shape)).not.toThrow()
  })

  it('rejects out of range months', () => {
    expect(() => assertShape({ monthsPerYear: 0, daysPerMonth: 30 })).toThrow(CalendarError)
    expect(() => assertShape({ monthsPerYear: 50, daysPerMonth: 30 })).toThrow(CalendarError)
  })

  it('rejects out of range days', () => {
    expect(() => assertShape({ monthsPerYear: 12, daysPerMonth: 0 })).toThrow(CalendarError)
    expect(() => assertShape({ monthsPerYear: 12, daysPerMonth: 100 })).toThrow(CalendarError)
  })
})

describe('totalDaysPerYear', () => {
  it('computes the product of months and days', () => {
    expect(totalDaysPerYear(shape)).toBe(360)
  })
})

describe('ordinalDayOfYear', () => {
  it('first day of year is 0', () => {
    expect(ordinalDayOfYear({ year: 1234, month: 1, day: 1 }, shape)).toBe(0)
  })

  it('second month starts where the first ends', () => {
    expect(ordinalDayOfYear({ year: 1234, month: 2, day: 1 }, shape)).toBe(30)
  })

  it('rejects month or day out of range', () => {
    expect(() => ordinalDayOfYear({ year: 1, month: 0, day: 1 }, shape)).toThrow(CalendarError)
    expect(() => ordinalDayOfYear({ year: 1, month: 1, day: 0 }, shape)).toThrow(CalendarError)
  })
})

describe('advanceDays', () => {
  it('advances within a month', () => {
    expect(advanceDays({ year: 1, month: 1, day: 1 }, 5, shape)).toEqual({
      year: 1,
      month: 1,
      day: 6,
    })
  })

  it('rolls into next month', () => {
    expect(advanceDays({ year: 1, month: 1, day: 28 }, 5, shape)).toEqual({
      year: 1,
      month: 2,
      day: 3,
    })
  })

  it('rolls into next year', () => {
    expect(advanceDays({ year: 1, month: 12, day: 28 }, 5, shape)).toEqual({
      year: 2,
      month: 1,
      day: 3,
    })
  })

  it('handles negative advances by walking back', () => {
    expect(advanceDays({ year: 2, month: 1, day: 1 }, -1, shape)).toEqual({
      year: 1,
      month: 12,
      day: 30,
    })
  })
})

describe('compareDays', () => {
  it('returns a positive number when a is later', () => {
    expect(compareDays({ year: 2, month: 1, day: 1 }, { year: 1, month: 12, day: 30 })).toBeGreaterThan(0)
  })

  it('returns zero for identical days', () => {
    expect(compareDays({ year: 1, month: 5, day: 5 }, { year: 1, month: 5, day: 5 })).toBe(0)
  })
})

describe('daysBetween', () => {
  it('returns 0 for the same day', () => {
    expect(daysBetween({ year: 1, month: 1, day: 1 }, { year: 1, month: 1, day: 1 }, shape)).toBe(0)
  })

  it('returns a positive count moving forward', () => {
    expect(daysBetween({ year: 1, month: 1, day: 1 }, { year: 1, month: 2, day: 1 }, shape)).toBe(30)
  })

  it('returns a negative count moving backward', () => {
    expect(daysBetween({ year: 2, month: 1, day: 1 }, { year: 1, month: 12, day: 30 }, shape)).toBe(-1)
  })
})

describe('buildMonthGrid', () => {
  it('builds a cell per day in the month', () => {
    const cells = buildMonthGrid(1, 3, shape)
    expect(cells).toHaveLength(30)
    expect(cells[0]?.isFirstOfMonth).toBe(true)
    expect(cells[29]?.day).toBe(30)
  })

  it('marks today when supplied', () => {
    const cells = buildMonthGrid(1, 3, shape, { year: 1, month: 3, day: 12 })
    const found = cells.find((c) => c.isToday)
    expect(found?.day).toBe(12)
  })
})

describe('groupEventsByDay', () => {
  it('groups events for the requested month only', () => {
    const events = [
      { date: { year: 1, month: 3, day: 5 }, payload: 'a' },
      { date: { year: 1, month: 3, day: 5 }, payload: 'b' },
      { date: { year: 1, month: 4, day: 5 }, payload: 'c' },
    ]
    const out = groupEventsByDay(events, shape, 1, 3)
    expect(out[5]).toEqual(['a', 'b'])
    expect(out).not.toHaveProperty('c')
  })
})

describe('formatDayShort', () => {
  it('pads month and day with zeros', () => {
    expect(formatDayShort({ year: 1234, month: 3, day: 5 })).toBe('03/05/1234')
  })
})
