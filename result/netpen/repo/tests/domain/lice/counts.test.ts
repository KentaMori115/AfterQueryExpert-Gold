import { describe, expect, it } from 'vitest';

import {
  averages,
  dispersionIndex,
  EMPTY_FISH,
  type FishCount,
  formatLice,
  intervalFor,
  LICE_STAGES,
  siteAverage,
  STAGE_LABELS,
  stageTotal,
  tValue,
} from '@/domain/lice/counts';

function fish(partial: Partial<FishCount>): FishCount {
  return { ...EMPTY_FISH, ...partial };
}

/** Twenty fish, clustered the way a real count comes out. */
const sample: FishCount[] = [
  fish({}),
  fish({}),
  fish({ adultFemale: 1, preAdult: 2 }),
  fish({}),
  fish({ adultFemale: 2, preAdult: 1, chalimus: 3 }),
  fish({}),
  fish({ preAdult: 1 }),
  fish({ adultFemale: 1 }),
  fish({}),
  fish({}),
  fish({ adultFemale: 3, preAdult: 4, adultMale: 2 }),
  fish({}),
  fish({ caligus: 2 }),
  fish({ adultFemale: 1, chalimus: 1 }),
  fish({}),
  fish({}),
  fish({ preAdult: 2 }),
  fish({}),
  fish({ adultFemale: 1, adultMale: 1 }),
  fish({}),
];

describe('one fish', () => {
  it('totals the regulated stages and leaves caligus out', () => {
    expect(
      stageTotal(fish({ chalimus: 3, preAdult: 1, adultMale: 2, adultFemale: 1, caligus: 9 })),
    ).toBe(7);
  });

  it('has a zero for every stage by default', () => {
    expect(stageTotal(EMPTY_FISH)).toBe(0);
  });

  it('names every stage it records', () => {
    expect(LICE_STAGES).toHaveLength(4);
    for (const stage of LICE_STAGES) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});

describe('averaging a count', () => {
  const result = averages(sample)!;

  it('is the reported adult female figure', () => {
    // Nine adult females across twenty fish.
    expect(result.adultFemale).toBeCloseTo(0.45, 9);
  });

  it('averages each stage separately', () => {
    expect(result.chalimus).toBeCloseTo(0.2, 9);
    expect(result.preAdult).toBeCloseTo(0.5, 9);
    expect(result.adultMale).toBeCloseTo(0.15, 9);
  });

  it('rolls the mobile stages together', () => {
    expect(result.mobile).toBeCloseTo(0.5 + 0.15 + 0.45, 9);
  });

  it('keeps caligus apart from the regulated count', () => {
    expect(result.caligus).toBeCloseTo(0.1, 9);
  });

  it('has nothing to average from no fish', () => {
    expect(averages([])).toBeNull();
  });
});

describe('the interval around the mean', () => {
  const interval = intervalFor(sample, 'adultFemale')!;

  it('is centred on the mean', () => {
    expect(interval.mean).toBeCloseTo(0.45, 9);
    expect(interval.sampleSize).toBe(20);
  });

  it('is wide enough that a threshold decision is not a coin toss', () => {
    // Twenty fish and clustered lice: the interval straddles the 0.5 limit.
    expect(interval.lower).toBeLessThan(0.5);
    expect(interval.upper).toBeGreaterThan(0.5);
  });

  it('never puts the lower bound below zero', () => {
    const clean = intervalFor([fish({}), fish({}), fish({ adultFemale: 1 })], 'adultFemale')!;
    expect(clean.lower).toBe(0);
  });

  it('is a point with no spread when every fish reads the same', () => {
    const uniform = Array.from({ length: 10 }, () => fish({ adultFemale: 1 }));
    const flat = intervalFor(uniform, 'adultFemale')!;
    expect(flat.standardError).toBeCloseTo(0, 12);
    expect(flat.lower).toBeCloseTo(1, 12);
    expect(flat.upper).toBeCloseTo(1, 12);
  });

  it('cannot form an interval from a single fish', () => {
    const single = intervalFor([fish({ adultFemale: 2 })], 'adultFemale')!;
    expect(single.mean).toBe(2);
    expect(Number.isNaN(single.standardError)).toBe(true);
  });

  it('has nothing to report from no fish', () => {
    expect(intervalFor([], 'adultFemale')).toBeNull();
  });
});

describe('the t value used', () => {
  it('narrows as the sample grows', () => {
    expect(tValue(5)).toBeGreaterThan(tValue(10));
    expect(tValue(10)).toBeGreaterThan(tValue(20));
    expect(tValue(20)).toBeGreaterThan(tValue(30));
  });

  it('settles on the normal past the table', () => {
    expect(tValue(60)).toBeCloseTo(1.96, 6);
  });

  it('is unusable below two fish', () => {
    expect(tValue(1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('how clustered the lice are', () => {
  it('shows overdispersion on a real count', () => {
    expect(dispersionIndex(sample, 'adultFemale')!).toBeGreaterThan(1);
  });

  it('is about one when the lice scatter evenly', () => {
    const even = Array.from({ length: 20 }, (_unused, index) =>
      fish({ adultFemale: index % 2 === 0 ? 1 : 0 }),
    );
    expect(dispersionIndex(even, 'adultFemale')!).toBeLessThan(1.2);
  });

  it('has no index on a clean pen or a single fish', () => {
    expect(
      dispersionIndex(
        Array.from({ length: 5 }, () => fish({})),
        'adultFemale',
      ),
    ).toBeNull();
    expect(dispersionIndex([fish({ adultFemale: 1 })], 'adultFemale')).toBeNull();
  });
});

describe('the site figure', () => {
  it('weights each pen by the fish it holds', () => {
    const site = siteAverage([
      { penId: 'p1', adultFemale: 0.2, fishCount: 180_000 },
      { penId: 'p2', adultFemale: 0.9, fishCount: 20_000 },
    ]);
    expect(site).toBeCloseTo((0.2 * 180_000 + 0.9 * 20_000) / 200_000, 9);
    expect(site).toBeLessThan(0.55);
  });

  it('does not let an empty pen swing the figure', () => {
    const site = siteAverage([
      { penId: 'p1', adultFemale: 0.2, fishCount: 180_000 },
      { penId: 'p2', adultFemale: 9, fishCount: 0 },
    ]);
    expect(site).toBeCloseTo(0.2, 9);
  });

  it('has no figure for a fallow site', () => {
    expect(siteAverage([])).toBeNull();
    expect(siteAverage([{ penId: 'p1', adultFemale: 0, fishCount: 0 }])).toBeNull();
  });
});

describe('formatting', () => {
  it('writes a count to two places, as the register does', () => {
    expect(formatLice(0.4499)).toBe('0.45');
    expect(formatLice(null)).toBe('—');
  });
});
