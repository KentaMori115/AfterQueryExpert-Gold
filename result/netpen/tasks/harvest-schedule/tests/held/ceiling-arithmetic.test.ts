import { describe, expect, it } from 'vitest';

import { harvestRequiredT, licencePosition, weekOfBreach } from '@/domain/biomass/standing';
import { degreeDaysBetweenWeights, fitTgc, weightAfter } from '@/domain/growth/tgc';
import {
  blockingTreatment,
  isMedicinal,
  profileFor,
  withdrawalStatus,
} from '@/domain/health/treatment';
import { carryWeightForward, positionAt, validate } from '@/domain/stock/ledger';
import { accumulate, dayContribution } from '@/domain/time/degreeDays';
import { biomassGrams, fromGrams } from '@/domain/units/mass';

/*
 * The arithmetic a harvest plan rests on, checked on its own so a wrong plan
 * can be told apart from a wrong foundation underneath it.
 */

const licence = { siteId: 'S1', maxBiomassT: 2_500 };

describe('the ceiling', () => {
  it('is crossed in the first week that goes past it', () => {
    expect(weekOfBreach([2_400, 2_480, 2_530, 2_600], licence)).toBe(2);
  });

  it('is not crossed by a week that lands on it', () => {
    expect(weekOfBreach([2_400, 2_500, 2_500], licence)).toBeNull();
  });

  it('says how much has to come off, week by week', () => {
    expect(harvestRequiredT([2_400, 2_530, 2_600], licence)).toEqual([0, 30, 100]);
  });

  it('reads a site position off the pens standing in it', () => {
    const position = licencePosition(
      [
        {
          penId: 'P1',
          count: 100_000,
          meanWeightG: 5_000,
          geometry: { circumferenceM: 120, depthM: 15 },
        },
        {
          penId: 'P2',
          count: 100_000,
          meanWeightG: 4_000,
          geometry: { circumferenceM: 120, depthM: 15 },
        },
      ],
      licence,
    );
    expect(position.standingT).toBeCloseTo(900, 6);
    expect(position.headroomT).toBeCloseTo(1_600, 6);
    expect(position.overLimit).toBe(false);
  });
});

describe('heat', () => {
  it('is worth what the day was, above zero', () => {
    expect(dayContribution(11.4)).toBeCloseTo(11.4, 9);
  });

  it('is worth nothing at all below it', () => {
    expect(dayContribution(-2)).toBe(0);
  });

  it('adds up over a run of daily means', () => {
    const samples = [10, 10, 10, -4, 12].map((meanC, day) => ({ at: day * 86_400_000, meanC }));
    expect(accumulate(samples)).toBeCloseTo(42, 9);
  });
});

describe('growth on accumulated heat', () => {
  it('walks a weight up the cube root line', () => {
    const root = Math.cbrt(3_000) + (3 * 210) / 1_000;
    expect(weightAfter(3_000, 210, 3)).toBeCloseTo(root ** 3, 6);
  });

  it('leaves a weight alone where no heat has gone by', () => {
    expect(weightAfter(3_000, 0, 3)).toBeCloseTo(3_000, 6);
  });

  it('reads a coefficient back out of what a pen actually did', () => {
    const grown = weightAfter(3_000, 500, 2.85);
    expect(fitTgc(3_000, grown, 500)).toBeCloseTo(2.85, 9);
  });

  it('says how much heat a target still needs', () => {
    expect(degreeDaysBetweenWeights(3_000, 4_000, 3)).toBeCloseTo(
      (1_000 * (Math.cbrt(4_000) - Math.cbrt(3_000))) / 3,
      9,
    );
  });
});

describe('a medicine clearing', () => {
  const event = {
    id: 'T1',
    method: 'emamectin-benzoate' as const,
    completedAt: 0,
    penId: 'P1',
    beforeCount: 1.2,
    afterCount: 0.3,
    note: '',
  };

  it('runs the profile the treatment carries', () => {
    expect(profileFor('emamectin-benzoate').withdrawalDegreeDays).toBe(175);
  });

  it('is still running while the heat is short', () => {
    const samples = [10, 10, 10].map((meanC, day) => ({ at: day * 86_400_000, meanC }));
    const status = withdrawalStatus(event, samples);
    expect(status.remaining).toBeCloseTo(145, 9);
    expect(status.cleared).toBe(false);
  });

  it('is done once the heat covers it', () => {
    const samples = Array.from({ length: 18 }, (_, day) => ({ at: day * 86_400_000, meanC: 10 }));
    expect(withdrawalStatus(event, samples).cleared).toBe(true);
  });
});

const DAY = 86_400_000;
const daily = (count, meanC) =>
  Array.from({ length: count }, (_, day) => ({ at: day * DAY, meanC }));

const entry = (id, day, kind, countDelta, meanWeightG) => ({
  id,
  groupId: 'G1',
  at: day * DAY,
  kind,
  countDelta,
  meanWeightG,
  note: '',
});

describe('reading a pen off its own record', () => {
  const events = [
    entry('a', 0, 'stocked', 100_000, 500),
    entry('b', 10, 'mortality', -2_000, 900),
    entry('c', 20, 'weighed', 0, 1_400),
  ];
  const options = { tgc: 3, temperatures: daily(60, 10) };

  it('counts only what has happened by the instant asked about', () => {
    expect(positionAt(events, 5 * DAY, options).count).toBe(100_000);
    expect(positionAt(events, 15 * DAY, options).count).toBe(98_000);
  });

  it('takes an event dated exactly on the instant', () => {
    expect(positionAt(events, 10 * DAY, options).count).toBe(98_000);
  });

  it('carries the last weighed figure forward over the heat since', () => {
    const grown = weightAfter(1_400, 10 * 10, 3);
    expect(positionAt(events, 30 * DAY, options).meanWeightG).toBeCloseTo(grown, 6);
  });

  it('counts the heat from the weighing up to the instant, and no further', () => {
    expect(carryWeightForward(1_400, 20 * DAY, 30 * DAY, options)).toBeCloseTo(
      weightAfter(1_400, 100, 3),
      6,
    );
  });

  it('leaves a figure alone where no heat has gone by', () => {
    expect(carryWeightForward(1_400, 20 * DAY, 20 * DAY, options)).toBe(1_400);
  });

  it('reads biomass in kilogrammes off the two of them', () => {
    const position = positionAt(events, 20 * DAY, options);
    expect(position.biomassKg).toBeCloseTo((98_000 * 1_400) / 1_000, 6);
  });
});

describe('a log that will not stand up', () => {
  it('passes a log that moves fish the way its entries say', () => {
    expect(validate([entry('a', 0, 'stocked', 100_000, 500)])).toEqual([]);
  });

  it('catches a mortality entered as a gain', () => {
    const issues = validate([
      entry('a', 0, 'stocked', 100_000, 500),
      entry('b', 5, 'mortality', 900, 400),
    ]);
    expect(issues.map((issue) => issue.kind)).toContain('inconsistent-sign');
  });

  it('catches a pen nothing was ever put into', () => {
    const issues = validate([entry('b', 5, 'mortality', -10, 400)]);
    expect(issues.map((issue) => issue.kind)).toContain('no-stocking');
  });
});

describe('which treatments hold a pen', () => {
  const bath = {
    id: 'T2',
    method: 'thermal',
    completedAt: 0,
    penId: 'P1',
    beforeCount: 1.1,
    afterCount: 0.2,
    note: '',
  };

  it('counts a feed medicine and a bath medicine, and nothing else', () => {
    expect(isMedicinal('emamectin-benzoate')).toBe(true);
    expect(isMedicinal('azamethiphos')).toBe(true);
    expect(isMedicinal('thermal')).toBe(false);
    expect(isMedicinal('cleaner-fish')).toBe(false);
  });

  it('never holds a pen for a non-medicinal method', () => {
    expect(blockingTreatment([bath], daily(1, 10))).toBeNull();
  });

  it('holds it for a medicinal one until the heat covers the withdrawal', () => {
    const dosed = { ...bath, method: 'emamectin-benzoate' };
    expect(blockingTreatment([dosed], daily(10, 10))).not.toBeNull();
    expect(blockingTreatment([dosed], daily(20, 10))).toBeNull();
  });
});

describe('the unit a pen is written in', () => {
  it('turns a count and a mean weight into grams', () => {
    expect(biomassGrams(150_000, 4_200)).toBe(630_000_000);
  });

  it('and grams into the tonnes a licence uses', () => {
    expect(fromGrams(630_000_000, 't')).toBeCloseTo(630, 9);
  });

  it('refuses a pen that holds less than nothing', () => {
    expect(() => biomassGrams(-1, 4_200)).toThrow(RangeError);
  });
});
