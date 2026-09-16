import { describe, expect, it } from 'vitest';

import {
  BASE_GUTTED_YIELD,
  conditionBand,
  CONDITION_LABELS,
  conditionFactor,
  formatCondition,
  formatSgr,
  guttedWeightG,
  guttedYield,
  lengthForCondition,
  specificGrowthRate,
  weightFromSgr,
} from '@/domain/growth/condition';

describe('specific growth rate', () => {
  it('is the log ratio spread over the days', () => {
    // 1 000 g to 1 200 g in 30 days is about 0.61 percent a day.
    expect(specificGrowthRate(1_000, 1_200, 30)).toBeCloseTo(0.6077, 4);
  });

  it('is zero when the fish did not grow', () => {
    expect(specificGrowthRate(1_000, 1_000, 30)).toBeCloseTo(0, 12);
  });

  it('goes negative on a pen that lost condition', () => {
    expect(specificGrowthRate(1_200, 1_000, 30)).toBeLessThan(0);
  });

  it('falls through a cycle even at the same absolute gain', () => {
    const early = specificGrowthRate(500, 700, 30);
    const late = specificGrowthRate(4_500, 4_700, 30);
    expect(late).toBeLessThan(early);
  });

  it('refuses inputs that have no growth rate', () => {
    expect(() => specificGrowthRate(0, 1_200, 30)).toThrow(RangeError);
    expect(() => specificGrowthRate(1_000, 0, 30)).toThrow(RangeError);
    expect(() => specificGrowthRate(1_000, 1_200, 0)).toThrow(RangeError);
  });

  it('round trips against the forward form', () => {
    const rate = specificGrowthRate(1_000, 1_200, 30);
    expect(weightFromSgr(1_000, rate, 30)).toBeCloseTo(1_200, 6);
  });

  it('refuses to grow from nothing', () => {
    expect(() => weightFromSgr(0, 0.6, 30)).toThrow(RangeError);
  });
});

describe('condition factor', () => {
  it('matches Fulton at a worked point', () => {
    // A 4 500 g fish of 72 cm sits at about 1.21.
    expect(conditionFactor(4_500, 72)).toBeCloseTo(1.206, 3);
  });

  it('inverts to the length implied by a condition', () => {
    expect(lengthForCondition(4_500, conditionFactor(4_500, 72))).toBeCloseTo(72, 9);
  });

  it('refuses a length of nothing', () => {
    expect(() => conditionFactor(4_500, 0)).toThrow(RangeError);
    expect(() => lengthForCondition(4_500, 0)).toThrow(RangeError);
  });
});

describe('condition bands', () => {
  it('places each band where the grading sheet does', () => {
    expect(conditionBand(0.95)).toBe('thin');
    expect(conditionBand(1.05)).toBe('lean');
    expect(conditionBand(1.25)).toBe('good');
    expect(conditionBand(1.45)).toBe('deep');
    expect(conditionBand(1.8)).toBe('overfat');
  });

  it('puts the boundaries at the lower band', () => {
    expect(conditionBand(1.1)).toBe('good');
    expect(conditionBand(1.4)).toBe('deep');
  });

  it('has advice for every band', () => {
    expect(Object.keys(CONDITION_LABELS)).toHaveLength(5);
    expect(CONDITION_LABELS.thin).toContain('feeding');
  });
});

describe('gutted yield', () => {
  it('sits at the base yield for a fish in the middle of the range', () => {
    expect(guttedYield(1.2)).toBeCloseTo(BASE_GUTTED_YIELD, 9);
  });

  it('falls as the fish gets deeper', () => {
    expect(guttedYield(1.4)).toBeLessThan(guttedYield(1.2));
    expect(guttedYield(1.0)).toBeGreaterThan(guttedYield(1.2));
  });

  it('clamps at the ends rather than running away', () => {
    expect(guttedYield(4)).toBe(0.75);
    expect(guttedYield(0.1)).toBe(0.9);
  });

  it('converts a live weight to what the processor pays for', () => {
    expect(guttedWeightG(5_000, 1.2)).toBeCloseTo(4_300, 6);
  });
});

describe('formatting', () => {
  it('writes a growth rate per day and a condition to two places', () => {
    expect(formatSgr(0.6077)).toBe('0.61 %/d');
    expect(formatCondition(1.2063)).toBe('1.21');
  });

  it('shows a dash for anything missing', () => {
    expect(formatSgr(null)).toBe('—');
    expect(formatCondition(Number.NaN)).toBe('—');
  });
});
