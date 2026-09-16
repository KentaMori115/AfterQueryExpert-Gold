import { describe, expect, it } from 'vitest';

import {
  accumulate,
  accumulateInRange,
  accumulationCurve,
  dayContribution,
  dayReached,
  daysToAccumulate,
  formatDegreeDays,
  impliedMeanC,
  projectDate,
  type TemperatureSample,
} from '@/domain/time/degreeDays';
import { addDays, makeRange, parseInstant, toIso } from '@/domain/time/duration';

const start = parseInstant('2025-03-03T00:00:00Z');

function series(means: readonly number[], from = start): TemperatureSample[] {
  return means.map((meanC, index) => ({ at: addDays(from, index), meanC }));
}

describe('a single day', () => {
  it('is worth its mean temperature', () => {
    expect(dayContribution(8.4)).toBe(8.4);
    expect(dayContribution(0)).toBe(0);
  });

  it('is worth nothing below zero rather than subtracting heat', () => {
    expect(dayContribution(-1.8)).toBe(0);
  });
});

describe('accumulating a series', () => {
  it('sums the daily means', () => {
    expect(accumulate(series([8, 8.5, 9, 9.5]))).toBeCloseTo(35, 9);
  });

  it('is nothing for an empty series', () => {
    expect(accumulate([])).toBe(0);
  });

  it('skips a day nobody measured rather than inventing heat for it', () => {
    const withGap = series([8, 8.5, 9]);
    withGap.push({ at: addDays(start, 3), meanC: Number.NaN });
    expect(accumulate(withGap)).toBeCloseTo(25.5, 9);
  });

  it('clips a freezing day out of the total', () => {
    expect(accumulate(series([8, -2, 9]))).toBeCloseTo(17, 9);
  });

  it('narrows to a range, closed at the start and open at the end', () => {
    const range = makeRange(addDays(start, 1), addDays(start, 3));
    expect(accumulateInRange(series([8, 8.5, 9, 9.5]), range)).toBeCloseTo(17.5, 9);
  });
});

describe('the running total', () => {
  const curve = accumulationCurve(series([8, 8.5, 9, 9.5]));

  it('carries a point per measured day', () => {
    expect(curve).toHaveLength(4);
    expect(curve[0]?.degreeDays).toBeCloseTo(8, 9);
    expect(curve[3]?.degreeDays).toBeCloseTo(35, 9);
  });

  it('finds the day a threshold was crossed', () => {
    expect(toIso(dayReached(curve, 25)!)).toBe(toIso(addDays(start, 2)));
    expect(toIso(dayReached(curve, 8)!)).toBe(toIso(start));
  });

  it('returns nothing for a threshold the series never reaches', () => {
    expect(dayReached(curve, 500)).toBeNull();
    expect(dayReached([], 10)).toBeNull();
  });
});

describe('projecting forward', () => {
  it('divides the remainder by the daily rate', () => {
    expect(daysToAccumulate(500, 10)).toBeCloseTo(50, 9);
    expect(daysToAccumulate(0, 10)).toBe(0);
    expect(daysToAccumulate(-20, 10)).toBe(0);
  });

  it('never arrives at or below zero degrees', () => {
    expect(daysToAccumulate(500, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(daysToAccumulate(500, -1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('walks a forecast and holds the last value once it runs out', () => {
    // Five days of forecast then a steady 10 degrees carries the rest.
    const at = projectDate(start, 100, [6, 7, 8, 9, 10]);
    expect(at).not.toBeNull();
    expect(toIso(at!)).toBe(toIso(addDays(start, 11)));
  });

  it('arrives immediately when there is nothing left to accumulate', () => {
    expect(projectDate(start, 0, [10])).toBe(start);
  });

  it('gives up rather than projecting through a frozen forecast', () => {
    expect(projectDate(start, 500, [0, 0, 0])).toBeNull();
    expect(projectDate(start, 500, [])).toBeNull();
  });
});

describe('reading a total backwards', () => {
  it('recovers the mean the period ran at', () => {
    const range = makeRange(start, addDays(start, 50));
    expect(impliedMeanC(500, range)).toBeCloseTo(10, 9);
  });

  it('has no mean over no time', () => {
    expect(impliedMeanC(500, makeRange(start, start))).toBeNull();
  });
});

describe('formatting', () => {
  it('switches to kilo degree-days once the numbers get long', () => {
    expect(formatDegreeDays(486)).toBe('486 °d');
    expect(formatDegreeDays(4_860)).toBe('4.86 k°d');
    expect(formatDegreeDays(null)).toBe('—');
    expect(formatDegreeDays(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
