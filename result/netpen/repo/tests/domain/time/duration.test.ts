import { describe, expect, it } from 'vitest';

import {
  addDays,
  addWeeks,
  compareIsoWeeks,
  daysBetween,
  formatCycleAge,
  formatIsoWeek,
  isoWeekOf,
  makeRange,
  monthsAtSea,
  MS_PER_DAY,
  parseInstant,
  rangeContains,
  rangeDays,
  startOfDay,
  startOfIsoWeek,
  toIso,
  weeksAtSea,
  weeksInIsoYear,
  wholeDaysBetween,
} from '@/domain/time/duration';

const stocked = parseInstant('2024-04-15T14:00:00Z');

describe('parsing', () => {
  it('reads ISO 8601 in UTC', () => {
    expect(parseInstant('1970-01-01T00:00:00Z')).toBe(0);
    expect(toIso(stocked)).toBe('2024-04-15T14:00:00.000Z');
  });

  it('throws rather than yielding NaN', () => {
    expect(() => parseInstant('last spring')).toThrow(TypeError);
    expect(() => parseInstant('')).toThrow(TypeError);
  });
});

describe('day arithmetic', () => {
  it('adds and measures days', () => {
    expect(daysBetween(stocked, addDays(stocked, 14))).toBeCloseTo(14, 12);
    expect(addWeeks(stocked, 2)).toBe(addDays(stocked, 14));
  });

  it('floors part days, so a cycle length never overstates growth', () => {
    expect(wholeDaysBetween(stocked, addDays(stocked, 1.9))).toBe(1);
    expect(wholeDaysBetween(stocked, addDays(stocked, 2))).toBe(2);
  });

  it('truncates to midnight UTC', () => {
    expect(startOfDay(stocked)).toBe(parseInstant('2024-04-15T00:00:00Z'));
    expect(startOfDay(parseInstant('2024-04-15T00:00:00Z')) % MS_PER_DAY).toBe(0);
  });
});

describe('iso weeks', () => {
  it('numbers a mid year week', () => {
    expect(isoWeekOf(parseInstant('2025-06-11T09:00:00Z'))).toEqual({ year: 2025, week: 24 });
  });

  it('puts the first days of January in the previous year where they belong', () => {
    // 1 January 2025 is a Wednesday, in week 1 of 2025.
    expect(isoWeekOf(parseInstant('2025-01-01T00:00:00Z'))).toEqual({ year: 2025, week: 1 });
    // 1 January 2023 is a Sunday, still in week 52 of 2022.
    expect(isoWeekOf(parseInstant('2023-01-01T12:00:00Z'))).toEqual({ year: 2022, week: 52 });
  });

  it('puts the last days of December in the next year where they belong', () => {
    // 31 December 2024 is a Tuesday, in week 1 of 2025.
    expect(isoWeekOf(parseInstant('2024-12-31T12:00:00Z'))).toEqual({ year: 2025, week: 1 });
  });

  it('knows the long years', () => {
    expect(weeksInIsoYear(2020)).toBe(53);
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2025)).toBe(52);
    expect(weeksInIsoYear(2024)).toBe(52);
  });

  it('starts a week on Monday', () => {
    const monday = startOfIsoWeek(parseInstant('2025-06-11T09:00:00Z'));
    expect(toIso(monday)).toBe('2025-06-09T00:00:00.000Z');
    expect(startOfIsoWeek(monday)).toBe(monday);
  });

  it('formats and orders weeks', () => {
    expect(formatIsoWeek({ year: 2025, week: 7 })).toBe('2025-W07');
    expect(formatIsoWeek({ year: 2025, week: 24 })).toBe('2025-W24');
    expect(compareIsoWeeks({ year: 2024, week: 52 }, { year: 2025, week: 1 })).toBeLessThan(0);
    expect(compareIsoWeeks({ year: 2025, week: 9 }, { year: 2025, week: 3 })).toBeGreaterThan(0);
    expect(compareIsoWeeks({ year: 2025, week: 9 }, { year: 2025, week: 9 })).toBe(0);
  });
});

describe('cycle age', () => {
  it('counts weeks from the week the fish went in', () => {
    expect(weeksAtSea(stocked, stocked)).toBe(0);
    expect(weeksAtSea(stocked, addDays(stocked, 3))).toBe(0);
    expect(weeksAtSea(stocked, addWeeks(stocked, 1))).toBe(1);
    expect(weeksAtSea(stocked, addWeeks(stocked, 61))).toBe(61);
  });

  it('counts months on the mean length of one', () => {
    expect(monthsAtSea(stocked, addDays(stocked, 365))).toBeCloseTo(11.99, 2);
  });

  it('writes the age the way it is spoken', () => {
    expect(formatCycleAge(stocked, addWeeks(stocked, 61))).toBe('14 mo, week 61');
  });

  it('refuses to age a pen before it was stocked', () => {
    expect(formatCycleAge(stocked, addDays(stocked, -1))).toBe('—');
  });
});

describe('date ranges', () => {
  const range = makeRange(stocked, addWeeks(stocked, 4));

  it('will not be built backwards', () => {
    expect(() => makeRange(addDays(stocked, 1), stocked)).toThrow(RangeError);
  });

  it('is closed at the start and open at the end', () => {
    expect(rangeContains(range, stocked)).toBe(true);
    expect(rangeContains(range, addWeeks(stocked, 4))).toBe(false);
    expect(rangeContains(range, addWeeks(stocked, 2))).toBe(true);
  });

  it('reports its own length', () => {
    expect(rangeDays(range)).toBeCloseTo(28, 9);
  });
});
