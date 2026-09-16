import { describe, expect, it } from 'vitest';

import {
  APPETITE_FRACTION,
  CONSTRAINT_LABELS,
  type FeedPlanInput,
  formatKg,
  oxygenFraction,
  planFeed,
  STARVE_DAYS,
  starveFraction,
  temperatureFraction,
  weeklyFeedKg,
} from '@/domain/feed/plan';

const base: FeedPlanInput = {
  biomassKg: 400_000,
  meanWeightG: 4_000,
  temperatureC: 12,
  saturationPercent: 92,
  appetite: 'normal',
  daysToHandling: null,
  operatorCapKg: null,
};

describe('feeding to table', () => {
  const plan = planFeed(base);

  it('takes the table figure when nothing is in the way', () => {
    expect(plan.binding).toBe('table');
    expect(plan.fraction).toBeCloseTo(1, 9);
    expect(plan.recommendedKg).toBeCloseTo(2_800, 6);
  });

  it('carries the rate through so the crew can check it', () => {
    expect(plan.ratePercent).toBeCloseTo(0.7, 9);
  });

  it('lists every constraint and what each would allow', () => {
    expect(plan.constraints).toHaveLength(6);
    for (const entry of plan.constraints) {
      expect(entry.allowsKg).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the starve before handling', () => {
  it('feeds normally while the crowd is far off', () => {
    expect(starveFraction(null)).toBe(1);
    expect(starveFraction(STARVE_DAYS + 1)).toBe(1);
  });

  it('steps down over the three days before', () => {
    expect(starveFraction(3)).toBe(0.5);
    expect(starveFraction(2)).toBe(0.25);
    expect(starveFraction(1)).toBe(0);
    expect(starveFraction(0)).toBe(0);
  });

  it('binds even on a pen that is behind budget', () => {
    const plan = planFeed({ ...base, daysToHandling: 1, appetite: 'keen' });
    expect(plan.binding).toBe('pre-handling-starve');
    expect(plan.recommendedKg).toBe(0);
  });
});

describe('the oxygen hold', () => {
  it('feeds fully in comfortable water', () => {
    expect(oxygenFraction(92)).toBe(1);
    expect(oxygenFraction(75)).toBe(1);
  });

  it('steps down through the bands', () => {
    expect(oxygenFraction(65)).toBe(0.6);
    expect(oxygenFraction(55)).toBe(0.25);
    expect(oxygenFraction(44)).toBe(0);
  });

  it('binds when the water is short', () => {
    const plan = planFeed({ ...base, saturationPercent: 64 });
    expect(plan.binding).toBe('oxygen');
    expect(plan.recommendedKg).toBeCloseTo(2_800 * 0.6, 6);
  });

  it('stops feeding entirely when oxygen is critical', () => {
    expect(planFeed({ ...base, saturationPercent: 40 }).recommendedKg).toBe(0);
  });
});

describe('temperature', () => {
  it('is no hold through the working range', () => {
    expect(temperatureFraction(12)).toBe(1);
    expect(temperatureFraction(6)).toBe(1);
  });

  it('holds back at both ends', () => {
    expect(temperatureFraction(3)).toBe(0.4);
    expect(temperatureFraction(1)).toBe(0);
    expect(temperatureFraction(18)).toBe(0.8);
    expect(temperatureFraction(20)).toBe(0.5);
  });

  it('binds in a cold snap', () => {
    const plan = planFeed({ ...base, temperatureC: 3 });
    expect(plan.binding).toBe('temperature');
  });
});

describe('observed appetite', () => {
  it('does not reduce a pen feeding normally or keenly', () => {
    expect(APPETITE_FRACTION.keen).toBe(1);
    expect(APPETITE_FRACTION.normal).toBe(1);
  });

  it('binds when the fish go off', () => {
    const plan = planFeed({ ...base, appetite: 'off' });
    expect(plan.binding).toBe('appetite');
    expect(plan.fraction).toBeCloseTo(0.2, 9);
  });
});

describe('the operator cap', () => {
  it('is ignored when there is none', () => {
    expect(planFeed(base).binding).toBe('table');
  });

  it('binds when it is below everything else', () => {
    const plan = planFeed({ ...base, operatorCapKg: 1_500 });
    expect(plan.binding).toBe('operator-cap');
    expect(plan.recommendedKg).toBe(1_500);
  });

  it('does nothing when it sits above the table', () => {
    expect(planFeed({ ...base, operatorCapKg: 9_000 }).binding).toBe('table');
  });
});

describe('several constraints at once', () => {
  it('takes the smallest and names it', () => {
    const plan = planFeed({
      ...base,
      saturationPercent: 64,
      appetite: 'slow',
      daysToHandling: 2,
    });
    // Starve at a quarter is below oxygen at 0.6 and appetite at 0.7.
    expect(plan.binding).toBe('pre-handling-starve');
    expect(plan.fraction).toBeCloseTo(0.25, 9);
  });

  it('never recommends a negative amount', () => {
    const plan = planFeed({ ...base, operatorCapKg: -500 });
    expect(plan.recommendedKg).toBe(0);
  });

  it('handles an empty pen without dividing by zero', () => {
    const plan = planFeed({ ...base, biomassKg: 0 });
    expect(plan.recommendedKg).toBe(0);
    expect(plan.fraction).toBe(0);
  });

  it('names every constraint it can report', () => {
    expect(Object.keys(CONSTRAINT_LABELS)).toHaveLength(6);
    expect(CONSTRAINT_LABELS.oxygen).toContain('oxygen');
  });
});

describe('the weekly order', () => {
  it('adds the daily plans up', () => {
    const week = Array.from({ length: 7 }, () => planFeed(base));
    expect(weeklyFeedKg(week)).toBeCloseTo(2_800 * 7, 3);
  });

  it('is nothing for a week with no plans', () => {
    expect(weeklyFeedKg([])).toBe(0);
  });
});

describe('formatting', () => {
  it('switches to tonnes once the order is large', () => {
    expect(formatKg(840)).toBe('840 kg');
    expect(formatKg(2_800)).toBe('2.80 t');
    expect(formatKg(null)).toBe('—');
  });
});
