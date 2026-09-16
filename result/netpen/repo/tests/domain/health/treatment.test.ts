import { describe, expect, it } from 'vitest';

import {
  achievedEfficacy,
  blockingTreatment,
  formatEfficacy,
  isMedicinal,
  profileFor,
  projectedAfter,
  projectedMortality,
  TREATMENTS,
  type TreatmentEvent,
  withdrawalStatus,
} from '@/domain/health/treatment';
import type { TemperatureSample } from '@/domain/time/degreeDays';
import { addDays, parseInstant } from '@/domain/time/duration';

const dosed = parseInstant('2025-02-10T00:00:00Z');

function samples(meanC: number, days: number, from = dosed): TemperatureSample[] {
  return Array.from({ length: days }, (_unused, index) => ({
    at: addDays(from, index),
    meanC,
  }));
}

function event(overrides: Partial<TreatmentEvent> = {}): TreatmentEvent {
  return {
    id: 'trt-1',
    method: 'emamectin-benzoate',
    completedAt: dosed,
    penId: 'pen-3',
    beforeCount: null,
    afterCount: null,
    note: '',
    ...overrides,
  };
}

describe('the catalogue', () => {
  it('carries every method with a complete profile', () => {
    expect(TREATMENTS.length).toBeGreaterThanOrEqual(9);
    for (const profile of TREATMENTS) {
      expect(profile.label).toBeTruthy();
      expect(profile.typicalEfficacy).toBeGreaterThan(0);
      expect(profile.typicalEfficacy).toBeLessThanOrEqual(1);
      expect(profile.withdrawalDegreeDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('puts a withdrawal only on the in-feed medicines', () => {
    for (const profile of TREATMENTS) {
      if (profile.withdrawalDegreeDays > 0) expect(profile.kind).toBe('in-feed');
    }
  });

  it('knows which methods are medicines', () => {
    expect(isMedicinal('emamectin-benzoate')).toBe(true);
    expect(isMedicinal('azamethiphos')).toBe(true);
    expect(isMedicinal('thermal')).toBe(false);
    expect(isMedicinal('cleaner-fish')).toBe(false);
  });

  it('has the mechanical methods working better and costing more fish', () => {
    const thermal = profileFor('thermal');
    const bath = profileFor('azamethiphos');
    expect(thermal.typicalEfficacy).toBeGreaterThan(bath.typicalEfficacy);
    expect(thermal.typicalMortality).toBeGreaterThan(bath.typicalMortality);
    expect(thermal.handles).toBe(true);
  });

  it('refuses a method it does not carry', () => {
    // @ts-expect-error deliberately outside the union
    expect(() => profileFor('ivermectin')).toThrow(RangeError);
  });
});

describe('what a treatment achieved', () => {
  it('is the reduction between the two counts', () => {
    expect(achievedEfficacy(event({ beforeCount: 2.0, afterCount: 0.4 }))).toBeCloseTo(0.8, 9);
  });

  it('is nothing rather than negative when the count went up', () => {
    expect(achievedEfficacy(event({ beforeCount: 0.4, afterCount: 0.9 }))).toBe(0);
  });

  it('cannot be worked out without both counts', () => {
    expect(achievedEfficacy(event({ beforeCount: 2.0 }))).toBeNull();
    expect(achievedEfficacy(event({ afterCount: 0.4 }))).toBeNull();
    expect(achievedEfficacy(event({ beforeCount: 0, afterCount: 0 }))).toBeNull();
  });
});

describe('the withdrawal period', () => {
  it('counts in degree-days, not days', () => {
    // 175 degree-days at 5 degrees is thirty five days.
    const cold = withdrawalStatus(event(), samples(5, 30));
    expect(cold.required).toBe(175);
    expect(cold.accumulated).toBeCloseTo(150, 9);
    expect(cold.cleared).toBe(false);
    expect(cold.remaining).toBeCloseTo(25, 9);
  });

  it('clears far sooner in warm water', () => {
    const warm = withdrawalStatus(event(), samples(14, 30));
    expect(warm.cleared).toBe(true);
    expect(warm.remaining).toBe(0);
  });

  it('takes the same treatment much longer in February than August', () => {
    const february = withdrawalStatus(event(), samples(5, 25));
    const august = withdrawalStatus(event(), samples(15, 25));
    expect(february.cleared).toBe(false);
    expect(august.cleared).toBe(true);
  });

  it('ignores heat from before the dose finished', () => {
    const before = samples(14, 20, addDays(dosed, -30));
    expect(withdrawalStatus(event(), before).accumulated).toBe(0);
  });

  it('clears a non-medicinal method at once', () => {
    const thermal = withdrawalStatus(event({ method: 'thermal' }), []);
    expect(thermal.required).toBe(0);
    expect(thermal.cleared).toBe(true);
  });
});

describe('what is holding a pen back', () => {
  const cold = samples(5, 20);

  it('is the most recent medicine that has not cleared', () => {
    const events = [
      event({ id: 'old', completedAt: addDays(dosed, -120) }),
      event({ id: 'recent', method: 'teflubenzuron', completedAt: dosed }),
    ];
    expect(blockingTreatment(events, cold)?.id).toBe('recent');
  });

  it('is nothing once the withdrawal has run', () => {
    expect(blockingTreatment([event()], samples(14, 30))).toBeNull();
  });

  it('is never a mechanical treatment', () => {
    const events = [event({ id: 'thermal', method: 'thermal', completedAt: dosed })];
    expect(blockingTreatment(events, cold)).toBeNull();
  });

  it('is nothing on a pen that has never been treated', () => {
    expect(blockingTreatment([], cold)).toBeNull();
  });
});

describe('projecting a treatment before choosing one', () => {
  it('leaves the lice the method does not take', () => {
    expect(projectedAfter(2.0, 'thermal')).toBeCloseTo(2.0 * 0.12, 9);
    expect(projectedAfter(2.0, 'cleaner-fish')).toBeCloseTo(2.0 * 0.65, 9);
  });

  it('prices the fish a treatment will cost', () => {
    expect(projectedMortality(200_000, 'thermal')).toBe(2_400);
    expect(projectedMortality(200_000, 'emamectin-benzoate')).toBe(200);
    expect(projectedMortality(200_000, 'cleaner-fish')).toBe(0);
  });
});

describe('formatting', () => {
  it('writes efficacy as a whole percentage', () => {
    expect(formatEfficacy(0.804)).toBe('80 %');
    expect(formatEfficacy(null)).toBe('—');
  });
});
