import { describe, expect, it } from 'vitest';

import {
  BRACKISH_THRESHOLD_PSU,
  convertTemperature,
  convertTemperatureDelta,
  type DepthReading,
  formatDepth,
  formatSalinity,
  formatTemperature,
  isBrackish,
  isPlausibleSalinity,
  isPlausibleSeaTemperature,
  LOGGED_DEPTHS_M,
  readingAtDepth,
  REFERENCE_DEPTH_M,
  stratificationK,
} from '@/domain/units/water';

const profile: DepthReading[] = [
  { depthM: 1, temperatureC: 13.8, salinityPsu: 28.4 },
  { depthM: 3, temperatureC: 12.9, salinityPsu: 31.2 },
  { depthM: 5, temperatureC: 12.1, salinityPsu: 33.0 },
  { depthM: 10, temperatureC: 10.4, salinityPsu: 34.1 },
  { depthM: 15, temperatureC: 9.6, salinityPsu: 34.4 },
];

describe('temperature', () => {
  it('converts absolute values', () => {
    expect(convertTemperature(0, 'C', 'F')).toBe(32);
    expect(convertTemperature(12.1, 'C', 'F')).toBeCloseTo(53.78, 6);
    expect(convertTemperature(53.78, 'F', 'C')).toBeCloseTo(12.1, 6);
  });

  it('is a no-op between the same unit', () => {
    expect(convertTemperature(12.1, 'C', 'C')).toBe(12.1);
  });

  it('converts an interval without the offset', () => {
    expect(convertTemperatureDelta(2, 'C', 'F')).toBeCloseTo(3.6, 9);
    expect(convertTemperatureDelta(3.6, 'F', 'C')).toBeCloseTo(2, 9);
  });

  it('keeps intervals and absolutes apart, which is the whole point', () => {
    expect(convertTemperature(2, 'C', 'F')).toBeCloseTo(35.6, 9);
    expect(convertTemperatureDelta(2, 'C', 'F')).toBeCloseTo(3.6, 9);
  });

  it('accepts a North Atlantic range and rejects a probe out of the water', () => {
    expect(isPlausibleSeaTemperature(-1.8)).toBe(true);
    expect(isPlausibleSeaTemperature(18.4)).toBe(true);
    expect(isPlausibleSeaTemperature(-6)).toBe(false);
    expect(isPlausibleSeaTemperature(31)).toBe(false);
    expect(isPlausibleSeaTemperature(Number.NaN)).toBe(false);
  });
});

describe('salinity', () => {
  it('accepts fresh through full ocean', () => {
    expect(isPlausibleSalinity(0)).toBe(true);
    expect(isPlausibleSalinity(35)).toBe(true);
    expect(isPlausibleSalinity(-1)).toBe(false);
    expect(isPlausibleSalinity(45)).toBe(false);
  });

  it('flags brackish water below the treatment threshold', () => {
    expect(isBrackish(BRACKISH_THRESHOLD_PSU - 0.1)).toBe(true);
    expect(isBrackish(BRACKISH_THRESHOLD_PSU)).toBe(false);
    expect(isBrackish(33)).toBe(false);
  });
});

describe('logged depths', () => {
  it('lists the depths a site records at', () => {
    expect(LOGGED_DEPTHS_M).toEqual([1, 3, 5, 10, 15]);
    expect(LOGGED_DEPTHS_M).toContain(REFERENCE_DEPTH_M);
  });
});

describe('reading at a depth', () => {
  it('returns the exact reading when the depth was logged', () => {
    expect(readingAtDepth(profile, 5)?.temperatureC).toBe(12.1);
  });

  it('falls back to the nearest logged depth', () => {
    expect(readingAtDepth(profile, 6)?.depthM).toBe(5);
    expect(readingAtDepth(profile, 12)?.depthM).toBe(10);
    expect(readingAtDepth(profile, 1.4)?.depthM).toBe(1);
  });

  it('prefers the deeper reading when two are equally near', () => {
    // 4 m sits exactly between 3 and 5. The deeper reading is the colder and
    // the more oxygen-poor of the two, so it is the one to decide on.
    expect(readingAtDepth(profile, 4)?.depthM).toBe(5);
    expect(readingAtDepth(profile, 12.5)?.depthM).toBe(15);
  });

  it('clamps to the ends rather than extrapolating', () => {
    expect(readingAtDepth(profile, 0)?.depthM).toBe(1);
    expect(readingAtDepth(profile, 40)?.depthM).toBe(15);
  });

  it('has nothing to return from an empty profile', () => {
    expect(readingAtDepth([], 5)).toBeNull();
  });
});

describe('stratification', () => {
  it('measures the spread across the profile', () => {
    expect(stratificationK(profile)).toBeCloseTo(4.2, 9);
  });

  it('needs at least two depths', () => {
    expect(stratificationK([profile[0]!])).toBeNull();
    expect(stratificationK([])).toBeNull();
  });
});

describe('formatting', () => {
  it('writes each measurement the way the log sheet does', () => {
    expect(formatTemperature(12.14)).toBe('12.1 °C');
    expect(formatTemperature(12.1, 'F')).toBe('53.8 °F');
    expect(formatSalinity(33.04)).toBe('33.0 PSU');
    expect(formatDepth(5)).toBe('5 m');
  });

  it('shows a dash for anything missing', () => {
    expect(formatTemperature(null)).toBe('—');
    expect(formatSalinity(null)).toBe('—');
    expect(formatDepth(Number.NaN)).toBe('—');
  });
});
