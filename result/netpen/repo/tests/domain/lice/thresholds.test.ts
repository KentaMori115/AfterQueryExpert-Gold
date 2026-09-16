import { describe, expect, it } from 'vitest';

import {
  APPROACHING_FRACTION,
  consecutiveWeeksOver,
  DAYS_TO_ACT,
  daysToAct,
  isSpringWindow,
  licePressure,
  limitFor,
  NORWAY_SPRING_LIMIT,
  NORWAY_STANDARD_LIMIT,
  SCOTLAND_ENFORCEMENT_LEVEL,
  SPRING_WINDOW_FIRST_WEEK,
  SPRING_WINDOW_LAST_WEEK,
  STATUS_LABELS,
  statusFor,
  treatmentObligation,
  type WeeklyCount,
} from '@/domain/lice/thresholds';

const week = (number: number) => ({ year: 2025, week: number });

describe('the spring window', () => {
  it('runs over the weeks the wild smolt are out', () => {
    expect(isSpringWindow(week(SPRING_WINDOW_FIRST_WEEK))).toBe(true);
    expect(isSpringWindow(week(SPRING_WINDOW_LAST_WEEK))).toBe(true);
    expect(isSpringWindow(week(18))).toBe(true);
  });

  it('closes either side of it', () => {
    expect(isSpringWindow(week(SPRING_WINDOW_FIRST_WEEK - 1))).toBe(false);
    expect(isSpringWindow(week(SPRING_WINDOW_LAST_WEEK + 1))).toBe(false);
  });
});

describe('the limit in force', () => {
  it('tightens in spring under the Norwegian rule', () => {
    expect(limitFor('norway', week(15))).toBe(NORWAY_STANDARD_LIMIT);
    expect(limitFor('norway', week(16))).toBe(NORWAY_SPRING_LIMIT);
    expect(limitFor('norway', week(22))).toBe(NORWAY_STANDARD_LIMIT);
  });

  it('does not move under the Scottish rule', () => {
    expect(limitFor('scotland', week(15))).toBe(0.5);
    expect(limitFor('scotland', week(18))).toBe(0.5);
  });
});

describe('status against the limit', () => {
  it('is clear well below', () => {
    expect(statusFor('norway', week(10), 0.2)).toBe('clear');
  });

  it('warns once inside the approaching fraction', () => {
    const approaching = NORWAY_STANDARD_LIMIT * APPROACHING_FRACTION;
    expect(statusFor('norway', week(10), approaching)).toBe('approaching');
    expect(statusFor('norway', week(10), 0.49)).toBe('approaching');
  });

  it('goes over strictly above the limit, not at it', () => {
    expect(statusFor('norway', week(10), 0.5)).toBe('approaching');
    expect(statusFor('norway', week(10), 0.51)).toBe('over-limit');
  });

  it('catches a site out when the spring window opens', () => {
    // The same count, one week apart, on either side of week 16.
    expect(statusFor('norway', week(15), 0.3)).toBe('clear');
    expect(statusFor('norway', week(16), 0.3)).toBe('over-limit');
  });

  it('has an enforcement level under the Scottish rule only', () => {
    expect(statusFor('scotland', week(10), SCOTLAND_ENFORCEMENT_LEVEL)).toBe('enforcement');
    expect(statusFor('norway', week(10), 1.2)).toBe('over-limit');
  });

  it('treats a missing count as clear rather than inventing a breach', () => {
    expect(statusFor('norway', week(10), Number.NaN)).toBe('clear');
  });

  it('has a sentence for every status', () => {
    expect(Object.keys(STATUS_LABELS)).toHaveLength(4);
    expect(STATUS_LABELS['over-limit']).toContain('treatment');
  });
});

describe('time to act', () => {
  it('gives a fortnight on the first week over', () => {
    expect(daysToAct(1)).toBe(DAYS_TO_ACT);
  });

  it('gives no grace to a site that was already over', () => {
    expect(daysToAct(2)).toBe(0);
    expect(daysToAct(5)).toBe(0);
  });
});

describe('the run of weeks over', () => {
  const counts: WeeklyCount[] = [
    { week: week(8), adultFemale: 0.2 },
    { week: week(9), adultFemale: 0.7 },
    { week: week(10), adultFemale: 0.3 },
    { week: week(11), adultFemale: 0.6 },
    { week: week(12), adultFemale: 0.8 },
  ];

  it('counts back from the most recent week', () => {
    expect(consecutiveWeeksOver(counts, 'norway')).toBe(2);
  });

  it('stops at the first week inside the limit', () => {
    expect(consecutiveWeeksOver([...counts, { week: week(13), adultFemale: 0.1 }], 'norway')).toBe(
      0,
    );
  });

  it('uses the limit in force in each week, not the latest one', () => {
    const spring: WeeklyCount[] = [
      { week: week(15), adultFemale: 0.3 },
      { week: week(16), adultFemale: 0.3 },
    ];
    // 0.3 is inside the limit in week 15 and over it in week 16.
    expect(consecutiveWeeksOver(spring, 'norway')).toBe(1);
  });

  it('has no run on an empty record', () => {
    expect(consecutiveWeeksOver([], 'norway')).toBe(0);
  });
});

describe('lice pressure', () => {
  it('integrates the count over the weeks', () => {
    expect(
      licePressure([
        { week: week(8), adultFemale: 0.2 },
        { week: week(9), adultFemale: 0.4 },
        { week: week(10), adultFemale: 0.3 },
      ]),
    ).toBeCloseTo(0.9, 9);
  });

  it('penalises a site that sits just under the limit all year', () => {
    const steady = Array.from({ length: 20 }, (_unused, index) => ({
      week: week(index + 1),
      adultFemale: 0.49,
    }));
    const spiky = Array.from({ length: 20 }, (_unused, index) => ({
      week: week(index + 1),
      adultFemale: index === 10 ? 1.4 : 0.05,
    }));
    expect(licePressure(steady)).toBeGreaterThan(licePressure(spiky));
  });

  it('skips a week nobody counted', () => {
    expect(
      licePressure([
        { week: week(8), adultFemale: 0.2 },
        { week: week(9), adultFemale: Number.NaN },
      ]),
    ).toBeCloseTo(0.2, 9);
  });
});

describe('the obligation to treat', () => {
  it('is nothing on a site inside the limit', () => {
    const obligation = treatmentObligation([{ week: week(10), adultFemale: 0.2 }], 'norway');
    expect(obligation.required).toBe(false);
    expect(obligation.daysRemaining).toBeNull();
  });

  it('gives a fortnight on the first week over', () => {
    const obligation = treatmentObligation([{ week: week(10), adultFemale: 0.7 }], 'norway');
    expect(obligation.required).toBe(true);
    expect(obligation.daysRemaining).toBe(DAYS_TO_ACT);
    expect(obligation.reason).toContain('this week');
  });

  it('gives none on the second', () => {
    const obligation = treatmentObligation(
      [
        { week: week(10), adultFemale: 0.7 },
        { week: week(11), adultFemale: 0.8 },
      ],
      'norway',
    );
    expect(obligation.daysRemaining).toBe(0);
    expect(obligation.reason).toContain('2 consecutive weeks');
  });

  it('has nothing to say about a site with no counts', () => {
    expect(treatmentObligation([], 'norway').required).toBe(false);
  });
});
