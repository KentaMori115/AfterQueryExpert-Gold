import { describe, expect, it } from 'vitest';

import {
  biomassGrams,
  convertMass,
  formatMass,
  fromGrams,
  HARVEST_MAX_GRAMS,
  isPlausibleFishWeight,
  meanWeightGrams,
  naturalUnit,
  SMOLT_MIN_GRAMS,
  toGrams,
} from '@/domain/units/mass';

describe('conversion', () => {
  it('scales by a thousand at each step', () => {
    expect(toGrams(1, 'kg')).toBe(1_000);
    expect(toGrams(1, 't')).toBe(1_000_000);
    expect(fromGrams(1_000_000, 't')).toBe(1);
  });

  it('short circuits identical units', () => {
    expect(convertMass(2_340, 'g', 'g')).toBe(2_340);
  });

  it('converts a real pen figure', () => {
    // 180 000 fish at 2 340 g is 421.2 tonnes.
    const grams = biomassGrams(180_000, 2_340);
    expect(convertMass(grams, 'g', 't')).toBeCloseTo(421.2, 6);
  });

  it('round trips through an intermediate unit', () => {
    const kg = convertMass(421.2, 't', 'kg');
    expect(convertMass(kg, 'kg', 't')).toBeCloseTo(421.2, 9);
  });
});

describe('choosing a unit by magnitude', () => {
  it('writes a single fish in grams', () => {
    expect(naturalUnit(2_340 * 0)).toBe('g');
    expect(naturalUnit(940)).toBe('g');
  });

  it('writes a mort box in kilogrammes', () => {
    expect(naturalUnit(1_000)).toBe('kg');
    expect(naturalUnit(48_000)).toBe('kg');
  });

  it('writes a pen in tonnes', () => {
    expect(naturalUnit(500_000)).toBe('t');
    expect(naturalUnit(421_200_000)).toBe('t');
  });

  it('is not confused by a negative, which happens on an adjustment', () => {
    expect(naturalUnit(-620_000)).toBe('t');
  });
});

describe('formatting', () => {
  it('uses the conventional digits for each unit', () => {
    expect(formatMass(940)).toBe('940 g');
    expect(formatMass(48_600)).toBe('48.6 kg');
    expect(formatMass(421_200_000)).toBe('421.2 t');
  });

  it('crosses into kilogrammes at a thousand grams', () => {
    // A grow-out fish is quoted in kilogrammes, a fry in grams.
    expect(formatMass(2_340)).toBe('2.3 kg');
  });

  it('honours an explicit unit', () => {
    expect(formatMass(2_340, 'g')).toBe('2340 g');
  });

  it('shows a dash rather than a zero for a missing mass', () => {
    expect(formatMass(null)).toBe('—');
    expect(formatMass(undefined)).toBe('—');
    expect(formatMass(Number.NaN)).toBe('—');
  });

  it('keeps a genuine zero', () => {
    expect(formatMass(0)).toBe('0 g');
  });
});

describe('biomass and mean weight', () => {
  it('multiplies a count by a mean weight', () => {
    expect(biomassGrams(180_000, 2_340)).toBe(421_200_000);
    expect(biomassGrams(0, 2_340)).toBe(0);
  });

  it('refuses impossible inputs rather than producing a negative biomass', () => {
    expect(() => biomassGrams(-1, 2_340)).toThrow(RangeError);
    expect(() => biomassGrams(180_000, -5)).toThrow(RangeError);
  });

  it('inverts back to the mean weight', () => {
    expect(meanWeightGrams(421_200_000, 180_000)).toBeCloseTo(2_340, 9);
  });

  it('has no mean weight for an empty pen', () => {
    expect(meanWeightGrams(0, 0)).toBeNull();
    expect(meanWeightGrams(1_000, -3)).toBeNull();
  });
});

describe('plausibility', () => {
  it('accepts a smolt and a harvest fish', () => {
    expect(isPlausibleFishWeight(SMOLT_MIN_GRAMS)).toBe(true);
    expect(isPlausibleFishWeight(5_400)).toBe(true);
    expect(isPlausibleFishWeight(HARVEST_MAX_GRAMS)).toBe(true);
  });

  it('rejects a figure that is a thousand out either way', () => {
    expect(isPlausibleFishWeight(2.34)).toBe(false);
    expect(isPlausibleFishWeight(2_340_000)).toBe(false);
    expect(isPlausibleFishWeight(Number.NaN)).toBe(false);
  });
});
