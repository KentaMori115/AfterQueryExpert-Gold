import { describe, expect, it } from 'vitest';

import {
  DENSITY_LABELS,
  DENSITY_LIMIT_KG_M3,
  DENSITY_WATCH_KG_M3,
  densityStatus,
  formatDensity,
  formatTonnes,
  harvestRequiredT,
  headroomFish,
  licencePosition,
  penBiomassKg,
  penDensityKgM3,
  penRadiusM,
  penSurfaceM2,
  penVolumeM3,
  type PenStock,
  STANDARD_CIRCUMFERENCES_M,
  weekOfBreach,
} from '@/domain/biomass/standing';

const geometry = { circumferenceM: 157, depthM: 25 };

function pen(overrides: Partial<PenStock> = {}): PenStock {
  return { penId: 'pen-3', count: 180_000, meanWeightG: 3_400, geometry, ...overrides };
}

describe('pen geometry', () => {
  it('recovers the radius from the collar', () => {
    expect(penRadiusM(geometry)).toBeCloseTo(24.99, 2);
  });

  it('gives the surface a 157 metre pen encloses', () => {
    expect(penSurfaceM2(geometry)).toBeCloseTo(1_961.6, 0);
  });

  it('gives the nominal cylinder the licence is measured against', () => {
    expect(penVolumeM3(geometry)).toBeCloseTo(49_040, -2);
  });

  it('refuses a pen that cannot exist', () => {
    expect(() => penVolumeM3({ circumferenceM: 0, depthM: 25 })).toThrow(RangeError);
    expect(() => penVolumeM3({ circumferenceM: 157, depthM: 0 })).toThrow(RangeError);
  });

  it('lists the collars a site carries', () => {
    expect(STANDARD_CIRCUMFERENCES_M).toContain(157);
    expect(STANDARD_CIRCUMFERENCES_M).toHaveLength(4);
  });
});

describe('standing biomass and density', () => {
  it('multiplies the count by the mean weight', () => {
    expect(penBiomassKg(pen())).toBeCloseTo(612_000, 6);
  });

  it('divides that by the nominal volume', () => {
    expect(penDensityKgM3(pen())).toBeCloseTo(612_000 / penVolumeM3(geometry), 9);
    expect(penDensityKgM3(pen())).toBeCloseTo(12.48, 2);
  });

  it('is nothing for an empty pen', () => {
    expect(penBiomassKg(pen({ count: 0 }))).toBe(0);
    expect(penDensityKgM3(pen({ count: 0 }))).toBe(0);
  });
});

describe('the density limit', () => {
  it('places each status where the site acts', () => {
    expect(densityStatus(12)).toBe('comfortable');
    expect(densityStatus(DENSITY_WATCH_KG_M3)).toBe('watch');
    expect(densityStatus(DENSITY_LIMIT_KG_M3)).toBe('watch');
    expect(densityStatus(DENSITY_LIMIT_KG_M3 + 0.1)).toBe('over-limit');
  });

  it('has a sentence for every status', () => {
    expect(Object.keys(DENSITY_LABELS)).toHaveLength(3);
  });

  it('says how many more fish the pen could hold', () => {
    const spare = headroomFish(pen());
    expect(spare).toBeGreaterThan(0);
    const filled = pen({ count: pen().count + spare });
    expect(penDensityKgM3(filled)).toBeLessThanOrEqual(DENSITY_LIMIT_KG_M3);
  });

  it('has no headroom in a pen already over the limit', () => {
    expect(headroomFish(pen({ count: 400_000 }))).toBe(0);
  });

  it('bites per pen even when the site is inside its licence', () => {
    // The same fish consolidated into one pen after a mortality event.
    const spread = [pen({ penId: 'a' }), pen({ penId: 'b' }), pen({ penId: 'c' })];
    const consolidated = pen({ count: 540_000 });
    expect(spread.every((entry) => densityStatus(penDensityKgM3(entry)) === 'comfortable')).toBe(
      true,
    );
    expect(densityStatus(penDensityKgM3(consolidated))).toBe('over-limit');
  });
});

describe('the site licence', () => {
  const licence = { siteId: 'site-1', maxBiomassT: 3_120 };
  const pens = [pen({ penId: 'a' }), pen({ penId: 'b' }), pen({ penId: 'c' })];

  it('totals the pens against the ceiling', () => {
    const position = licencePosition(pens, licence);
    expect(position.standingT).toBeCloseTo(1_836, 3);
    expect(position.headroomT).toBeCloseTo(1_284, 3);
    expect(position.overLimit).toBe(false);
  });

  it('reports how much of the licence is used', () => {
    expect(licencePosition(pens, licence).utilisation).toBeCloseTo(1_836 / 3_120, 6);
  });

  it('goes over strictly above the ceiling', () => {
    const heavy = pens.map((entry) => pen({ ...entry, meanWeightG: 6_000 }));
    expect(licencePosition(heavy, licence).overLimit).toBe(true);
  });

  it('reads zero on a fallow site', () => {
    const position = licencePosition([], licence);
    expect(position.standingT).toBe(0);
    expect(position.utilisation).toBe(0);
  });
});

describe('when the ceiling arrives', () => {
  const licence = { siteId: 'site-1', maxBiomassT: 3_120 };
  const projection = [2_400, 2_650, 2_900, 3_150, 3_400];

  it('finds the first week over', () => {
    expect(weekOfBreach(projection, licence)).toBe(3);
  });

  it('finds nothing when the projection stays inside', () => {
    expect(weekOfBreach([2_400, 2_650, 2_900], licence)).toBeNull();
    expect(weekOfBreach([], licence)).toBeNull();
  });

  it('says how much must come off in each week', () => {
    const required = harvestRequiredT(projection, licence);
    expect(required).toEqual([0, 0, 0, 30, 280]);
  });
});

describe('formatting', () => {
  it('writes tonnes and density the way the log sheet does', () => {
    expect(formatTonnes(1_836.04)).toBe('1836.0 t');
    expect(formatDensity(12.479)).toBe('12.5 kg/m³');
    expect(formatTonnes(null)).toBe('—');
    expect(formatDensity(Number.NaN)).toBe('—');
  });
});
