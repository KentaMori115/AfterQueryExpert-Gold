import { describe, expect, it } from 'vitest';

import {
  bandDistribution,
  BASELINE_GRADE,
  estimateHarvest,
  formatShare,
  fractionAtOrAbove,
  GRADE_LABELS,
  gradeSplit,
  modalBand,
  STANDARD_BANDS,
} from '@/domain/harvest/grading';

const clean = { wounded: 0, maturing: 0, deformed: 0 };

describe('the bands', () => {
  it('runs contiguously from a kilo with an open top', () => {
    expect(STANDARD_BANDS[0]?.fromKg).toBe(1);
    expect(STANDARD_BANDS.at(-1)?.toKg).toBeNull();
    for (let index = 1; index < STANDARD_BANDS.length; index += 1) {
      expect(STANDARD_BANDS[index]!.fromKg).toBe(STANDARD_BANDS[index - 1]!.toKg);
    }
  });
});

describe('splitting a pen across the bands', () => {
  // A 5.4 kg live pen at 12 percent spread and a good condition factor.
  const shares = bandDistribution(5_400, 12, 1.2);

  it('accounts for essentially the whole pen', () => {
    const total = shares.reduce((sum, share) => sum + share.fraction, 0);
    expect(total).toBeCloseTo(1, 3);
  });

  it('centres on the band holding the gutted mean', () => {
    // 5 400 g live at 86 percent yield is about 4.6 kg gutted.
    expect(modalBand(shares)?.label).toBe('4-5 kg');
  });

  it('spreads either side rather than piling into one band', () => {
    expect(shares.filter((share) => share.fraction > 0.01).length).toBeGreaterThan(2);
  });

  it('lands lower than the live mean suggests, because of the yield', () => {
    expect(fractionAtOrAbove(shares, 5)).toBeLessThan(0.5);
  });

  it('widens the spread when the pen is uneven', () => {
    const tight = bandDistribution(5_400, 6, 1.2);
    const loose = bandDistribution(5_400, 20, 1.2);
    const tightModal = Math.max(...tight.map((share) => share.fraction));
    const looseModal = Math.max(...loose.map((share) => share.fraction));
    expect(looseModal).toBeLessThan(tightModal);
  });

  it('drops a poorly conditioned pen down the bands', () => {
    const good = fractionAtOrAbove(bandDistribution(5_400, 12, 1.1), 5);
    const deep = fractionAtOrAbove(bandDistribution(5_400, 12, 1.45), 5);
    expect(deep).toBeLessThan(good);
  });

  it('reports a count per thousand fish for the harvest sheet', () => {
    const total = shares.reduce((sum, share) => sum + share.countPerThousand, 0);
    expect(total).toBeGreaterThan(980);
    expect(total).toBeLessThanOrEqual(1_005);
  });

  it('has no modal band for an empty split', () => {
    expect(modalBand([])).toBeNull();
  });
});

describe('quality grades', () => {
  it('grades a clean pen at the baseline', () => {
    expect(gradeSplit(clean)).toEqual(BASELINE_GRADE);
  });

  it('always sums to one', () => {
    const cases = [
      clean,
      { wounded: 0.1, maturing: 0.05, deformed: 0.02 },
      { wounded: 0.5, maturing: 0.4, deformed: 0.3 },
      { wounded: 1, maturing: 1, deformed: 1 },
    ];
    for (const pressures of cases) {
      const split = gradeSplit(pressures);
      expect(split.superior + split.ordinary + split.production).toBeCloseTo(1, 9);
    }
  });

  it('takes wounded and maturing fish out of superior', () => {
    const split = gradeSplit({ wounded: 0.12, maturing: 0.06, deformed: 0 });
    expect(split.superior).toBeCloseTo(0.94 - 0.18, 6);
    expect(split.ordinary).toBeCloseTo(0.05 + 0.18, 6);
  });

  it('sends deformity all the way to production', () => {
    const split = gradeSplit({ wounded: 0, maturing: 0, deformed: 0.08 });
    expect(split.production).toBeCloseTo(0.09, 6);
  });

  it('never goes negative on a pen where everything went wrong', () => {
    const split = gradeSplit({ wounded: 0.8, maturing: 0.5, deformed: 0.2 });
    expect(split.superior).toBeGreaterThanOrEqual(0);
    expect(split.ordinary).toBeGreaterThanOrEqual(0);
  });

  it('names every grade', () => {
    expect(Object.keys(GRADE_LABELS)).toHaveLength(3);
  });
});

describe('the whole estimate', () => {
  const estimate = estimateHarvest(180_000, 5_400, 12, 1.2, clean);

  it('gives the live tonnage', () => {
    expect(estimate.liveTonnes).toBeCloseTo(972, 6);
  });

  it('gives the gutted tonnage the processor pays on', () => {
    expect(estimate.guttedTonnes).toBeCloseTo(972 * 0.86, 3);
    expect(estimate.guttedTonnes).toBeLessThan(estimate.liveTonnes);
  });

  it('carries the bands and grades through', () => {
    expect(estimate.bands).toHaveLength(STANDARD_BANDS.length);
    expect(estimate.grades.superior).toBeCloseTo(0.94, 9);
    expect(estimate.modal?.label).toBe('4-5 kg');
  });

  it('is nothing for an empty pen', () => {
    expect(estimateHarvest(0, 5_400, 12, 1.2, clean).liveTonnes).toBe(0);
  });
});

describe('formatting', () => {
  it('writes a share to a tenth of a percent', () => {
    expect(formatShare(0.9412)).toBe('94.1 %');
    expect(formatShare(null)).toBe('—');
  });
});
