import { describe, expect, it } from 'vitest';

import {
  extentOf,
  finerStep,
  MINIMUM_TICKS,
  formatWeekTick,
  niceExtent,
  niceStep,
  scaleLinear,
  SERIES_COLOURS,
  SERIES_DASH,
  ticksFor,
  weekTickStep,
} from '@/ui/charts/theme';

describe('the palette', () => {
  it('gives the two temperature traces different colours', () => {
    expect(SERIES_COLOURS.temperature).not.toBe(SERIES_COLOURS.temperatureDeep);
  });

  it('dashes the secondary series so grey scale still reads', () => {
    expect(SERIES_DASH.temperature).toBeUndefined();
    expect(SERIES_DASH.temperatureDeep).toBeTruthy();
    expect(SERIES_DASH.budget).toBeTruthy();
    expect(SERIES_DASH.licence).toBeTruthy();
  });

  it('reserves the alarm colour for the things that alarm', () => {
    expect(SERIES_COLOURS.adultFemale).toBe(SERIES_COLOURS.oxygenLow);
  });
});

describe('extents', () => {
  it('finds the range of a series', () => {
    expect(extentOf([3, 9, 1, 7])).toEqual({ min: 1, max: 9 });
  });

  it('ignores anything that is not a number', () => {
    expect(extentOf([3, Number.NaN, 9, Number.POSITIVE_INFINITY])).toEqual({ min: 3, max: 9 });
  });

  it('has no extent for an empty series, rather than infinities', () => {
    expect(extentOf([])).toBeNull();
    expect(extentOf([Number.NaN])).toBeNull();
  });
});

describe('rounding an extent out', () => {
  it('falls back where there is nothing to round', () => {
    expect(niceExtent(null, { min: 0, max: 10 })).toEqual({ min: 0, max: 10 });
  });

  it('widens to round numbers', () => {
    const nice = niceExtent({ min: 3.2, max: 14.7 }, { min: 0, max: 1 });
    expect(nice.min).toBeLessThanOrEqual(3.2);
    expect(nice.max).toBeGreaterThanOrEqual(14.7);
    expect(nice.min % 1).toBeCloseTo(0, 9);
  });

  it('gives a flat series a visible band rather than a line', () => {
    const nice = niceExtent({ min: 12, max: 12 }, { min: 0, max: 1 });
    expect(nice.max).toBeGreaterThan(nice.min);
    expect(nice.min).toBeLessThan(12);
    expect(nice.max).toBeGreaterThan(12);
  });

  it('handles a flat series at zero', () => {
    const nice = niceExtent({ min: 0, max: 0 }, { min: 0, max: 1 });
    expect(nice.max - nice.min).toBeGreaterThan(0);
  });
});

describe('step selection', () => {
  it('picks one, two or five times a power of ten', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(4.2)).toBe(5);
    expect(niceStep(8)).toBe(10);
    expect(niceStep(230)).toBe(500);
    expect(niceStep(0.03)).toBe(0.05);
  });

  it('never returns nothing to step by', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-4)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe('ticks', () => {
  it('lands on round values inside the extent', () => {
    const ticks = ticksFor({ min: 0, max: 20 }, 4);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(20);
    expect(ticks.every((tick) => tick % 5 === 0)).toBe(true);
  });

  it('produces roughly the number asked for', () => {
    for (const [min, max] of [
      [0, 1],
      [3.2, 14.7],
      [0, 3_000],
    ]) {
      const ticks = ticksFor({ min: min!, max: max! }, 5);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(9);
    }
  });

  it('comes down the ladder rather than leaving an axis under labelled', () => {
    // A step of 5 puts only two ticks inside 3.2 to 14.7, so it drops to 2.
    const ticks = ticksFor({ min: 3.2, max: 14.7 }, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(MINIMUM_TICKS);
    expect(ticks[0]).toBe(4);
  });

  it('steps down the one two five ladder', () => {
    expect(finerStep(10)).toBe(5);
    expect(finerStep(5)).toBe(2);
    expect(finerStep(2)).toBe(1);
    expect(finerStep(1)).toBeCloseTo(0.5, 9);
    expect(finerStep(0.5)).toBeCloseTo(0.2, 9);
  });

  it('does not stray outside the extent', () => {
    for (const tick of ticksFor({ min: 3.2, max: 14.7 })) {
      expect(tick).toBeGreaterThanOrEqual(3.2);
      expect(tick).toBeLessThanOrEqual(14.7);
    }
  });
});

describe('the linear scale', () => {
  const scale = scaleLinear({ min: 0, max: 10 }, 0, 100);

  it('maps the ends onto the ends', () => {
    expect(scale(0)).toBe(0);
    expect(scale(10)).toBe(100);
  });

  it('maps the middle onto the middle', () => {
    expect(scale(5)).toBe(50);
  });

  it('inverts for a y axis, where pixels grow downwards', () => {
    const inverted = scaleLinear({ min: 0, max: 10 }, 200, 0);
    expect(inverted(0)).toBe(200);
    expect(inverted(10)).toBe(0);
  });

  it('puts a flat extent in the middle rather than dividing by zero', () => {
    expect(scaleLinear({ min: 5, max: 5 }, 0, 100)(5)).toBe(50);
  });
});

describe('week ticks', () => {
  it('widens the spacing as the cycle gets longer', () => {
    expect(weekTickStep(8)).toBe(2);
    expect(weekTickStep(24)).toBe(4);
    expect(weekTickStep(56)).toBe(8);
    expect(weekTickStep(80)).toBe(13);
  });

  it('labels a week the way a production plan does', () => {
    expect(formatWeekTick(24)).toBe('w24');
    expect(formatWeekTick(24.4)).toBe('w24');
  });
});
