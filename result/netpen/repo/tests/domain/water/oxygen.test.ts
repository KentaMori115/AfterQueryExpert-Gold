import { describe, expect, it } from 'vitest';

import {
  concentrationForSaturation,
  consumptionMgKgH,
  FED_ACTIVITY_MULTIPLIER,
  formatConcentration,
  formatSaturation,
  O2_MOLAR_MASS,
  oxygenBand,
  OXYGEN_BAND_LABELS,
  penDemandKgH,
  requiredFlowM3S,
  routineConsumptionMgKgH,
  saturationPercent,
  seaWaterDensity,
  solubilityMgL,
  solubilityUmolKg,
} from '@/domain/water/oxygen';

describe('solubility', () => {
  it('matches the published table for full salinity sea water', () => {
    // Garcia and Gordon, S = 35. These are the numbers in every handbook.
    expect(solubilityMgL(0, 35)).toBeCloseTo(11.43, 1);
    expect(solubilityMgL(10, 35)).toBeCloseTo(8.99, 1);
    expect(solubilityMgL(20, 35)).toBeCloseTo(7.36, 1);
  });

  it('matches fresh water, which holds appreciably more', () => {
    expect(solubilityMgL(10, 0)).toBeCloseTo(11.26, 1);
    expect(solubilityMgL(10, 0)).toBeGreaterThan(solubilityMgL(10, 35));
  });

  it('falls with temperature all the way through the range', () => {
    for (let t = 0; t < 20; t += 1) {
      expect(solubilityMgL(t + 1, 33)).toBeLessThan(solubilityMgL(t, 33));
    }
  });

  it('falls with salinity', () => {
    expect(solubilityMgL(12, 34)).toBeLessThan(solubilityMgL(12, 28));
  });

  it('reports in micromoles per kilogramme too, which is what data comes in', () => {
    expect(solubilityUmolKg(10, 35)).toBeCloseTo(274.6, 0);
  });

  it('uses the right molar mass', () => {
    expect(O2_MOLAR_MASS).toBeCloseTo(31.9988, 4);
  });

  it('has sea water denser than fresh and warm water lighter than cold', () => {
    expect(seaWaterDensity(10, 35)).toBeGreaterThan(seaWaterDensity(10, 0));
    expect(seaWaterDensity(16, 33)).toBeLessThan(seaWaterDensity(6, 33));
  });
});

describe('saturation against concentration', () => {
  it('is a hundred percent at the solubility', () => {
    expect(saturationPercent(solubilityMgL(12, 33), 12, 33)).toBeCloseTo(100, 6);
  });

  it('reads the same concentration differently at two temperatures', () => {
    // 8 mg/L is comfortable in cold water and over saturated in warm.
    expect(saturationPercent(8, 6, 33)).toBeLessThan(90);
    expect(saturationPercent(8, 18, 33)).toBeGreaterThan(100);
  });

  it('inverts back to a concentration', () => {
    const target = concentrationForSaturation(70, 12, 33);
    expect(saturationPercent(target, 12, 33)).toBeCloseTo(70, 6);
  });
});

describe('what the fish use', () => {
  it('matches a routine rate for a grow-out fish', () => {
    // A 4 kg fish at twelve degrees, routine, is about 97 mg per kg per hour.
    expect(routineConsumptionMgKgH(4_000, 12)).toBeCloseTo(97.1, 0);
  });

  it('is higher per kilogramme for a smaller fish', () => {
    expect(routineConsumptionMgKgH(200, 12)).toBeGreaterThan(routineConsumptionMgKgH(4_000, 12));
  });

  it('climbs steeply with temperature', () => {
    const cold = routineConsumptionMgKgH(4_000, 6);
    const warm = routineConsumptionMgKgH(4_000, 16);
    expect(warm / cold).toBeCloseTo(Math.exp(0.061 * 10), 3);
  });

  it('nearly doubles while a meal is being digested', () => {
    expect(consumptionMgKgH(4_000, 12, true)).toBeCloseTo(
      routineConsumptionMgKgH(4_000, 12) * FED_ACTIVITY_MULTIPLIER,
      9,
    );
    expect(consumptionMgKgH(4_000, 12, false)).toBeCloseTo(routineConsumptionMgKgH(4_000, 12), 9);
  });

  it('refuses a fish of no weight', () => {
    expect(() => routineConsumptionMgKgH(0, 12)).toThrow(RangeError);
  });
});

describe('a whole pen', () => {
  it('scales the rate by standing biomass', () => {
    // 400 tonnes of 4 kg fish at twelve degrees, feeding.
    const demand = penDemandKgH(400_000, 4_000, 12, true);
    expect(demand).toBeCloseTo((400_000 * 97.1 * 1.9) / 1_000_000, 0);
  });

  it('grows more slowly than biomass, because larger fish use less per kilo', () => {
    const early = penDemandKgH(100_000, 1_000, 12, false) / 100_000;
    const late = penDemandKgH(400_000, 4_000, 12, false) / 400_000;
    expect(late).toBeLessThan(early);
  });
});

describe('the flow the pen needs', () => {
  it('rises as the permitted drawdown narrows', () => {
    const wide = requiredFlowM3S(70, 9, 6);
    const narrow = requiredFlowM3S(70, 9, 8);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('is unattainable when the inlet is already at the floor', () => {
    expect(requiredFlowM3S(70, 7, 7)).toBe(Number.POSITIVE_INFINITY);
    expect(requiredFlowM3S(70, 6, 7)).toBe(Number.POSITIVE_INFINITY);
  });

  it('works out to a sensible number of cubic metres a second', () => {
    // 70 kg/h of demand with three milligrammes a litre to play with.
    expect(requiredFlowM3S(70, 9, 6)).toBeCloseTo(6.48, 2);
  });
});

describe('the bands feeding is held on', () => {
  it('places each band where the site acts', () => {
    expect(oxygenBand(45)).toBe('critical');
    expect(oxygenBand(55)).toBe('low');
    expect(oxygenBand(65)).toBe('reduced');
    expect(oxygenBand(85)).toBe('good');
    expect(oxygenBand(120)).toBe('supersaturated');
  });

  it('treats a missing reading as the worst case', () => {
    expect(oxygenBand(Number.NaN)).toBe('critical');
  });

  it('has an instruction for every band', () => {
    expect(Object.keys(OXYGEN_BAND_LABELS)).toHaveLength(5);
    expect(OXYGEN_BAND_LABELS.low).toContain('hold feed');
  });
});

describe('formatting', () => {
  it('writes saturation whole and concentration to two places', () => {
    expect(formatSaturation(87.4)).toBe('87 %');
    expect(formatConcentration(8.994)).toBe('8.99 mg/L');
    expect(formatSaturation(null)).toBe('—');
    expect(formatConcentration(null)).toBe('—');
  });
});
