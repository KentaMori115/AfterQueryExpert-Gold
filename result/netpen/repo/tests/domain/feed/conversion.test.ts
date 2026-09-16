import { describe, expect, it } from 'vitest';

import {
  biologicalFcr,
  biologicalGainKg,
  type ConversionInputs,
  economicFcr,
  economicGainKg,
  FCR_ACCEPTABLE_MAX,
  FCR_BAND_LABELS,
  FCR_GOOD_MAX,
  fcrBand,
  feedBudget,
  feedLostToMortalityKg,
  formatFcr,
} from '@/domain/feed/conversion';

/** A quarter on one pen: 300 t to 420 t, 8 t of mortality, 132 t of feed. */
const quarter: ConversionInputs = {
  feedKg: 132_000,
  openingBiomassKg: 300_000,
  closingBiomassKg: 420_000,
  harvestedKg: 0,
  mortalityKg: 8_000,
  stockedKg: 0,
};

describe('production', () => {
  it('counts the mortality as biological production', () => {
    expect(biologicalGainKg(quarter)).toBe(128_000);
  });

  it('leaves the mortality out of economic production', () => {
    expect(economicGainKg(quarter)).toBe(120_000);
  });

  it('nets off fish that were put in', () => {
    const stocked = { ...quarter, stockedKg: 20_000 };
    expect(economicGainKg(stocked)).toBe(100_000);
  });

  it('counts fish taken off alive', () => {
    const harvested = { ...quarter, closingBiomassKg: 320_000, harvestedKg: 100_000 };
    expect(economicGainKg(harvested)).toBe(120_000);
  });
});

describe('the two ratios', () => {
  it('gives the biological figure against the fish that converted', () => {
    expect(biologicalFcr(quarter)).toBeCloseTo(1.031, 3);
  });

  it('gives the economic figure against what left alive', () => {
    expect(economicFcr(quarter)).toBeCloseTo(1.1, 3);
  });

  it('always has the economic figure the worse of the two', () => {
    expect(economicFcr(quarter)!).toBeGreaterThan(biologicalFcr(quarter)!);
  });

  it('closes the gap when nothing died', () => {
    const clean = { ...quarter, mortalityKg: 0 };
    expect(biologicalFcr(clean)).toBeCloseTo(economicFcr(clean)!, 9);
  });

  it('has no ratio for a period that lost biomass', () => {
    const treatmentWeek = { ...quarter, closingBiomassKg: 290_000, mortalityKg: 0 };
    expect(biologicalFcr(treatmentWeek)).toBeNull();
    expect(economicFcr(treatmentWeek)).toBeNull();
  });
});

describe('what the mortality cost', () => {
  it('prices the dead biomass at the biological ratio', () => {
    expect(feedLostToMortalityKg(quarter)).toBeCloseTo(8_000 * 1.03125, 3);
  });

  it('is nothing when nothing died', () => {
    expect(feedLostToMortalityKg({ ...quarter, mortalityKg: 0 })).toBe(0);
  });

  it('is nothing when there is no ratio to price it at', () => {
    expect(feedLostToMortalityKg({ ...quarter, closingBiomassKg: 100_000, harvestedKg: 0 })).toBe(
      0,
    );
  });
});

describe('banding a ratio', () => {
  it('places each band where the budget does', () => {
    expect(fcrBand(1.08)).toBe('good');
    expect(fcrBand(FCR_GOOD_MAX)).toBe('good');
    expect(fcrBand(1.25)).toBe('acceptable');
    expect(fcrBand(FCR_ACCEPTABLE_MAX)).toBe('acceptable');
    expect(fcrBand(1.6)).toBe('poor');
  });

  it('says so rather than guessing when there is nothing to measure', () => {
    expect(fcrBand(null)).toBe('unknown');
    expect(fcrBand(0)).toBe('unknown');
    expect(fcrBand(Number.NaN)).toBe('unknown');
  });

  it('has a sentence for every band', () => {
    expect(Object.keys(FCR_BAND_LABELS)).toHaveLength(4);
    expect(FCR_BAND_LABELS.poor).toContain('wasted');
  });
});

describe('the feed budget', () => {
  const series = [100_000, 120_000, 145_000, 175_000];

  it('produces a step per interval', () => {
    expect(feedBudget(series, 1.15)).toHaveLength(3);
  });

  it('prices the gain in each week at the ratio', () => {
    const steps = feedBudget(series, 1.15);
    expect(steps[0]?.gainKg).toBe(20_000);
    expect(steps[0]?.feedKg).toBeCloseTo(23_000, 6);
  });

  it('runs a cumulative total', () => {
    const steps = feedBudget(series, 1.15);
    expect(steps.at(-1)?.cumulativeFeedKg).toBeCloseTo(75_000 * 1.15, 6);
  });

  it('orders no feed for a week the pen went backwards', () => {
    const steps = feedBudget([100_000, 90_000, 110_000], 1.15);
    expect(steps[0]?.feedKg).toBe(0);
    expect(steps[1]?.feedKg).toBeCloseTo(20_000 * 1.15, 6);
  });

  it('has nothing to budget from a single point', () => {
    expect(feedBudget([100_000], 1.15)).toEqual([]);
  });

  it('refuses a ratio that cannot exist', () => {
    expect(() => feedBudget(series, 0)).toThrow(RangeError);
    expect(() => feedBudget(series, -1)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('writes a ratio to two places', () => {
    expect(formatFcr(1.0312)).toBe('1.03');
    expect(formatFcr(null)).toBe('—');
  });
});
