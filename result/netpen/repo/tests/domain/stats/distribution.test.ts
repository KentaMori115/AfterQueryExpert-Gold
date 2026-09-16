import { describe, expect, it } from 'vitest';

import {
  coefficientOfVariation,
  fractionBelow,
  fractionBetween,
  lognormalFrom,
  mean,
  normalCdf,
  quantile,
  standardDeviation,
} from '@/domain/stats/distribution';

describe('sample statistics', () => {
  const weights = [4_120, 4_480, 3_960, 4_710, 4_330];

  it('averages a sample', () => {
    expect(mean(weights)).toBeCloseTo(4_320, 6);
    expect(() => mean([])).toThrow(RangeError);
  });

  it('uses the n minus one form', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1381, 4);
    expect(() => standardDeviation([4_120])).toThrow(RangeError);
  });

  it('quotes spread as a percentage of the mean', () => {
    expect(coefficientOfVariation(weights)).toBeCloseTo(6.82, 2);
    expect(() => coefficientOfVariation([-2, 2])).toThrow(RangeError);
  });
});

describe('the normal distribution', () => {
  it('is a half at the mean', () => {
    // The series approximation is good to about 1.5e-7, so it is exercised to
    // that and no further; anything tighter is testing the polynomial.
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
  });

  it('matches the familiar points', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 4);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 4);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('is symmetric', () => {
    for (const z of [0.3, 1.1, 2.4]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 6);
    }
  });

  it('saturates in the tails', () => {
    expect(normalCdf(6)).toBeCloseTo(1, 6);
    expect(normalCdf(-6)).toBeCloseTo(0, 6);
  });
});

describe('fitting a pen', () => {
  // A pen at 4.5 kg mean with a 12 percent spread, which is typical.
  const shape = lognormalFrom(4_500, 12);

  it('recovers a shape whose mean is the mean it was given', () => {
    const impliedMean = Math.exp(shape.mu + (shape.sigma * shape.sigma) / 2);
    expect(impliedMean).toBeCloseTo(4_500, 3);
  });

  it('recovers the spread it was given', () => {
    const variance =
      (Math.exp(shape.sigma * shape.sigma) - 1) * Math.exp(2 * shape.mu + shape.sigma ** 2);
    expect((Math.sqrt(variance) / 4_500) * 100).toBeCloseTo(12, 6);
  });

  it('refuses a fit that cannot exist', () => {
    expect(() => lognormalFrom(0, 12)).toThrow(RangeError);
    expect(() => lognormalFrom(4_500, 0)).toThrow(RangeError);
  });
});

describe('reading off size bands', () => {
  const shape = lognormalFrom(4_500, 12);

  it('splits about half either side of the median', () => {
    const median = Math.exp(shape.mu);
    expect(fractionBelow(shape, median)).toBeCloseTo(0.5, 4);
  });

  it('is skewed, so the mean sits above the median', () => {
    expect(fractionBelow(shape, 4_500)).toBeGreaterThan(0.5);
  });

  it('has nothing below zero', () => {
    expect(fractionBelow(shape, 0)).toBe(0);
    expect(fractionBelow(shape, -100)).toBe(0);
  });

  it('sums to one across contiguous bands', () => {
    const bands =
      fractionBetween(shape, 0, 3_000) +
      fractionBetween(shape, 3_000, 4_000) +
      fractionBetween(shape, 4_000, 5_000) +
      fractionBetween(shape, 5_000, 6_000) +
      fractionBetween(shape, 6_000, null);
    expect(bands).toBeCloseTo(1, 6);
  });

  it('returns nothing for a band the wrong way round', () => {
    expect(fractionBetween(shape, 5_000, 4_000)).toBe(0);
  });

  it('puts most of a 12 percent pen inside a kilo of the mean', () => {
    expect(fractionBetween(shape, 4_000, 5_000)).toBeGreaterThan(0.6);
  });
});

describe('quantiles', () => {
  const shape = lognormalFrom(4_500, 12);

  it('inverts the cumulative distribution', () => {
    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(fractionBelow(shape, quantile(shape, fraction))).toBeCloseTo(fraction, 5);
    }
  });

  it('puts the median at exp of the underlying mean', () => {
    expect(quantile(shape, 0.5)).toBeCloseTo(Math.exp(shape.mu), 2);
  });

  it('handles the degenerate ends', () => {
    expect(quantile(shape, 0)).toBe(0);
    expect(quantile(shape, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});
