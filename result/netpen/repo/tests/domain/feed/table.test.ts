import { describe, expect, it } from 'vitest';

import {
  bracket,
  dailyFeedKg,
  FEED_RATE_TABLE,
  feedRatePercent,
  formatFeedRate,
  pelletChangeDue,
  pelletSizeFor,
  TABLE_TEMPERATURES_C,
  TABLE_WEIGHTS_G,
} from '@/domain/feed/table';

describe('the table itself', () => {
  it('is the shape the two axes describe', () => {
    expect(FEED_RATE_TABLE).toHaveLength(TABLE_WEIGHTS_G.length);
    for (const row of FEED_RATE_TABLE) {
      expect(row).toHaveLength(TABLE_TEMPERATURES_C.length);
    }
  });

  it('falls as the fish grows, at every temperature', () => {
    for (let column = 0; column < TABLE_TEMPERATURES_C.length; column += 1) {
      for (let row = 1; row < TABLE_WEIGHTS_G.length; row += 1) {
        expect(FEED_RATE_TABLE[row]![column]!).toBeLessThan(FEED_RATE_TABLE[row - 1]![column]!);
      }
    }
  });

  it('peaks at fourteen degrees and comes back down above it', () => {
    const peak = TABLE_TEMPERATURES_C.indexOf(14);
    const warmest = TABLE_TEMPERATURES_C.length - 1;
    for (const row of FEED_RATE_TABLE) {
      expect(row[peak]!).toBe(Math.max(...row));
      expect(row[warmest]!).toBeLessThan(row[peak]!);
    }
  });
});

describe('bracketing an axis', () => {
  const axis = [4, 6, 8, 10];

  it('lands on a tabulated point as the far end of the bracket below it', () => {
    // Either normalisation interpolates to the same value; this one keeps the
    // walk simple and never needs an equality test on a float.
    expect(bracket(axis, 6)).toEqual({ low: 0, high: 1, fraction: 1 });
    expect(feedRatePercent(250, 6)).toBeCloseTo(0.7, 9);
  });

  it('splits the gap between two points', () => {
    expect(bracket(axis, 7)).toEqual({ low: 1, high: 2, fraction: 0.5 });
  });

  it('clamps below the first and above the last', () => {
    expect(bracket(axis, 1)).toEqual({ low: 0, high: 0, fraction: 0 });
    expect(bracket(axis, 30)).toEqual({ low: 3, high: 3, fraction: 0 });
  });
});

describe('reading a rate off the table', () => {
  it('returns the tabulated value on a grid point', () => {
    expect(feedRatePercent(1_000, 10)).toBeCloseTo(0.89, 9);
    expect(feedRatePercent(100, 14)).toBeCloseTo(2.0, 9);
  });

  it('interpolates along the temperature axis', () => {
    // Halfway between 0.89 at ten degrees and 1.07 at twelve.
    expect(feedRatePercent(1_000, 11)).toBeCloseTo(0.98, 9);
  });

  it('interpolates along the weight axis', () => {
    // Halfway between 1 000 g and 2 000 g at ten degrees.
    expect(feedRatePercent(1_500, 10)).toBeCloseTo((0.89 + 0.72) / 2, 9);
  });

  it('interpolates in both directions at once', () => {
    const rate = feedRatePercent(1_500, 11);
    expect(rate).toBeGreaterThan(feedRatePercent(1_500, 10));
    expect(rate).toBeLessThan(feedRatePercent(1_500, 12));
  });

  it('clamps outside the table rather than extrapolating', () => {
    expect(feedRatePercent(50, 10)).toBeCloseTo(feedRatePercent(100, 10), 9);
    expect(feedRatePercent(9_000, 10)).toBeCloseTo(feedRatePercent(6_000, 10), 9);
    expect(feedRatePercent(1_000, 1)).toBeCloseTo(feedRatePercent(1_000, 4), 9);
    expect(feedRatePercent(1_000, 22)).toBeCloseTo(feedRatePercent(1_000, 16), 9);
  });
});

describe('the daily ration', () => {
  it('is the rate applied to standing biomass', () => {
    // 400 tonnes of 4 kg fish at twelve degrees.
    expect(dailyFeedKg(400_000, 4_000, 12)).toBeCloseTo(2_800, 6);
  });

  it('climbs through a cycle even as the percentage falls', () => {
    const early = dailyFeedKg(20_000, 250, 12);
    const late = dailyFeedKg(400_000, 4_000, 12);
    expect(feedRatePercent(4_000, 12)).toBeLessThan(feedRatePercent(250, 12));
    expect(late).toBeGreaterThan(early);
  });

  it('is nothing for an empty pen', () => {
    expect(dailyFeedKg(0, 4_000, 12)).toBe(0);
  });

  it('refuses a negative biomass', () => {
    expect(() => dailyFeedKg(-1, 4_000, 12)).toThrow(RangeError);
  });
});

describe('pellet size', () => {
  it('steps up through the cycle', () => {
    expect(pelletSizeFor(120)).toBe(3);
    expect(pelletSizeFor(400)).toBe(4.5);
    expect(pelletSizeFor(900)).toBe(6);
    expect(pelletSizeFor(2_500)).toBe(9);
    expect(pelletSizeFor(5_000)).toBe(12);
  });

  it('changes at the band edge, not inside it', () => {
    expect(pelletSizeFor(149)).toBe(3);
    expect(pelletSizeFor(150)).toBe(4.5);
  });

  it('flags a change so a silo swap can be booked', () => {
    expect(pelletChangeDue(6, 900)).toBe(false);
    expect(pelletChangeDue(6, 1_600)).toBe(true);
  });
});

describe('formatting', () => {
  it('writes a rate per day', () => {
    expect(formatFeedRate(0.894)).toBe('0.89 %/d');
    expect(formatFeedRate(null)).toBe('—');
  });
});
