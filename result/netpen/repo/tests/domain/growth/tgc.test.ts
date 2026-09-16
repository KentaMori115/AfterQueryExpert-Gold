import { describe, expect, it } from 'vitest';

import {
  degreeDaysBetweenWeights,
  fitTgc,
  formatTgc,
  HANDLING_RECOVERY_DAYS,
  HANDLING_TGC_PENALTY,
  isPlausibleTgc,
  projectWeights,
  TGC_MAX,
  TGC_MIN,
  tgcAfterHandling,
  weightAfter,
} from '@/domain/growth/tgc';

describe('growing a fish forward', () => {
  it('matches the model at a worked point', () => {
    // A 100 g smolt through 1 000 degree-days at TGC 3.0 comes out at 446 g.
    expect(weightAfter(100, 1_000, 3)).toBeCloseTo(446.22, 1);
  });

  it('carries a smolt to harvest size over a full cycle', () => {
    // 90 g in, 4 200 degree-days over about eighteen months, TGC 3.2.
    expect(weightAfter(90, 4_200, 3.2)).toBeCloseTo(5_756, 0);
  });

  it('does not move without heat', () => {
    expect(weightAfter(100, 0, 3)).toBeCloseTo(100, 9);
  });

  it('is superlinear, because the cube root is what grows linearly', () => {
    const first = weightAfter(100, 1_000, 3) - 100;
    const second = weightAfter(100, 2_000, 3) - weightAfter(100, 1_000, 3);
    expect(second).toBeGreaterThan(first);
  });

  it('clamps at zero rather than going imaginary on a negative coefficient', () => {
    expect(weightAfter(100, 5_000, -3)).toBe(0);
  });

  it('refuses a negative start weight', () => {
    expect(() => weightAfter(-1, 1_000, 3)).toThrow(RangeError);
  });
});

describe('inverting the model', () => {
  it('gives the heat needed between two weights', () => {
    expect(degreeDaysBetweenWeights(100, 2_000, 3)).toBeCloseTo(2_652.5, 1);
  });

  it('round trips against the forward model', () => {
    const needed = degreeDaysBetweenWeights(120, 4_500, 3.1);
    expect(weightAfter(120, needed, 3.1)).toBeCloseTo(4_500, 6);
  });

  it('reads backwards for a target below the start', () => {
    expect(degreeDaysBetweenWeights(2_000, 100, 3)).toBeCloseTo(-2_652.5, 1);
  });

  it('never arrives at a coefficient of zero', () => {
    expect(degreeDaysBetweenWeights(100, 2_000, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('fitting to what the pen actually did', () => {
  it('recovers the coefficient it was grown at', () => {
    const grown = weightAfter(100, 1_800, 2.85);
    expect(fitTgc(100, grown, 1_800)).toBeCloseTo(2.85, 9);
  });

  it('reports a lower coefficient when the pen fell behind', () => {
    const budgeted = weightAfter(100, 1_800, 3.2);
    const actual = budgeted * 0.85;
    expect(fitTgc(100, actual, 1_800)).toBeLessThan(3.2);
  });

  it('refuses to fit over no accumulated heat', () => {
    expect(() => fitTgc(100, 400, 0)).toThrow(RangeError);
    expect(() => fitTgc(100, 400, -50)).toThrow(RangeError);
  });
});

describe('plausibility', () => {
  it('accepts the band a grow-out sits in', () => {
    expect(isPlausibleTgc(TGC_MIN)).toBe(true);
    expect(isPlausibleTgc(3.1)).toBe(true);
    expect(isPlausibleTgc(TGC_MAX)).toBe(true);
  });

  it('rejects a figure that has lost its scaling', () => {
    expect(isPlausibleTgc(0.003)).toBe(false);
    expect(isPlausibleTgc(3_000)).toBe(false);
    expect(isPlausibleTgc(Number.NaN)).toBe(false);
  });
});

describe('projecting over a temperature series', () => {
  const daily = Array.from({ length: 30 }, () => 10);

  it('starts at the weight it was given', () => {
    const steps = projectWeights(400, daily, 3);
    expect(steps[0]).toEqual({ degreeDays: 0, weightG: 400 });
  });

  it('produces a step per day plus the start', () => {
    expect(projectWeights(400, daily, 3)).toHaveLength(31);
  });

  it('accumulates the heat as it goes', () => {
    const steps = projectWeights(400, daily, 3);
    expect(steps.at(-1)?.degreeDays).toBeCloseTo(300, 9);
    expect(steps.at(-1)?.weightG).toBeCloseTo(weightAfter(400, 300, 3), 9);
  });

  it('takes nothing from a freezing day', () => {
    const steps = projectWeights(400, [10, -3, 10], 3);
    expect(steps.at(-1)?.degreeDays).toBeCloseTo(20, 9);
  });

  it('handles an empty forecast', () => {
    expect(projectWeights(400, [], 3)).toHaveLength(1);
  });
});

describe('the cost of handling', () => {
  it('takes the full penalty on the day of the event', () => {
    expect(tgcAfterHandling(3, 0)).toBeCloseTo(3 * (1 - HANDLING_TGC_PENALTY), 9);
  });

  it('eases back linearly over the recovery period', () => {
    const half = tgcAfterHandling(3, HANDLING_RECOVERY_DAYS / 2);
    expect(half).toBeGreaterThan(tgcAfterHandling(3, 0));
    expect(half).toBeLessThan(3);
  });

  it('is fully recovered at the end of the period', () => {
    expect(tgcAfterHandling(3, HANDLING_RECOVERY_DAYS)).toBeCloseTo(3, 9);
    expect(tgcAfterHandling(3, 40)).toBeCloseTo(3, 9);
  });

  it('leaves a pen that has not been handled alone', () => {
    expect(tgcAfterHandling(3, -1)).toBe(3);
  });
});

describe('formatting', () => {
  it('writes a coefficient to two places', () => {
    expect(formatTgc(3.147)).toBe('3.15');
    expect(formatTgc(null)).toBe('—');
    expect(formatTgc(Number.NaN)).toBe('—');
  });
});
