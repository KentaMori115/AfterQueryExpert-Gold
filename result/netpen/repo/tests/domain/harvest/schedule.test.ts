import { describe, expect, it } from 'vitest';

import {
  bookingFor,
  breachWeeks,
  committedTonnes,
  formatPlan,
  lastHarvestWeek,
  peakUtilisation,
  planHarvest,
  plannedTonnes,
} from '@/domain/harvest/schedule';
import { groupId, penId } from '@/domain/ids';

const DAY = 86_400_000;
const AT = Date.parse('2025-03-03T00:00:00Z');
const temperatures = Array.from({ length: 200 }, (_, index) => ({
  at: AT - 60 * DAY + index * DAY,
  meanC: 9.5,
}));

const pen = (
  id: string,
  number: number,
  count: number,
  weightG: number,
  tgc: number,
  conditionFactor = 1.2,
) => ({
  penId: penId(id),
  number,
  tgc,
  conditionFactor,
  treatments: [],
  events: [
    {
      id: `${id}-a`,
      groupId: groupId(id),
      at: AT - 400 * DAY,
      kind: 'stocked' as const,
      countDelta: count,
      meanWeightG: 120,
      note: '',
    },
    {
      id: `${id}-b`,
      groupId: groupId(id),
      at: AT - 7 * DAY,
      kind: 'weighed' as const,
      countDelta: 0,
      meanWeightG: weightG,
      note: '',
    },
  ],
});

const request = {
  at: AT,
  maxBiomassT: 1_320,
  weeklyCapacityT: [700, 700, 700, 700, 700, 700],
  minHarvestWeightG: 3_500,
  temperatures,
  pens: [pen('P1', 1, 150_000, 4_100, 2.9), pen('P2', 2, 150_000, 3_800, 3.0)],
};

describe('a site growing into its licence', () => {
  const plan = planHarvest(request);

  it('books the heavier pen out before the week that breaks', () => {
    expect(plan.bookings).toHaveLength(1);
    expect(plan.bookings[0]!.penId).toBe(penId('P1'));
    expect(plan.bookings[0]!.week).toBeLessThan(2);
  });

  it('keeps the site inside the licence afterwards', () => {
    expect(breachWeeks(plan, 1_320)).toEqual([]);
    expect(plan.shortfall).toBeNull();
    expect(plan.skipped).toEqual([]);
  });

  it('reads back what it promised the processor', () => {
    expect(plannedTonnes(plan)).toBeCloseTo(plan.bookings[0]!.tonnes, 9);
    expect(committedTonnes(request.weeklyCapacityT, plan)).toBeCloseTo(plannedTonnes(plan), 9);
    expect(lastHarvestWeek(plan)).toBe(plan.bookings[0]!.week);
    expect(peakUtilisation(plan, 1_320)).toBeLessThanOrEqual(1);
    expect(formatPlan(plan)).toContain('1 pens');
  });

  it('finds the booking one pen holds and nothing for the other', () => {
    expect(bookingFor(plan, penId('P1'))).not.toBeNull();
    expect(bookingFor(plan, penId('P2'))).toBeNull();
  });
});

describe('a site nothing threatens', () => {
  const plan = planHarvest({ ...request, maxBiomassT: 9_000 });

  it('books nothing and says so', () => {
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toBeNull();
    expect(formatPlan(plan)).toContain('Nothing');
  });
});

describe('a site already over', () => {
  const plan = planHarvest({ ...request, maxBiomassT: 900 });

  it('reports the week and the tonnes instead of a plan', () => {
    expect(plan.shortfall!.week).toBe(0);
    expect(plan.shortfall!.excessT).toBeGreaterThan(0);
    expect(formatPlan(plan)).toContain('No plan');
  });
});

describe('a pen the ledger will not stand behind', () => {
  const broken = {
    ...pen('P3', 3, 100_000, 4_000, 3),
    events: [
      {
        id: 'x',
        groupId: groupId('P3'),
        at: AT - 400 * DAY,
        kind: 'stocked' as const,
        countDelta: 100_000,
        meanWeightG: 120,
        note: '',
      },
      {
        id: 'y',
        groupId: groupId('P3'),
        at: AT - 30 * DAY,
        kind: 'mortality' as const,
        countDelta: 500,
        meanWeightG: 3_000,
        note: '',
      },
    ],
  };
  const plan = planHarvest({ ...request, pens: [...request.pens, broken] });

  it('leaves it out and names it', () => {
    expect(plan.skipped).toEqual([penId('P3')]);
    expect(plan.bookings.map((booking) => booking.penId)).not.toContain(penId('P3'));
  });

  it('keeps its biomass out of the licence too', () => {
    const without = planHarvest(request);
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(without.weeklyBiomassT[0]!, 9);
  });
});
