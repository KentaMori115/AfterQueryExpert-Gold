import { describe, expect, it } from 'vitest';

import { createRandom, seedFromString, shuffle } from '@/lib/random';

function sampleOf(draw: () => number, count: number): number[] {
  return Array.from({ length: count }, draw);
}

function meanOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function varianceOf(values: readonly number[]): number {
  const mean = meanOf(values);
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
}

describe('determinism', () => {
  it('produces the same sequence from the same seed', () => {
    const a = createRandom('grp-s24-p3');
    const b = createRandom('grp-s24-p3');
    expect(sampleOf(() => a.next(), 50)).toEqual(sampleOf(() => b.next(), 50));
  });

  it('diverges on a different seed', () => {
    expect(createRandom('one').next()).not.toBe(createRandom('two').next());
  });

  it('hashes a string to a stable unsigned integer', () => {
    expect(seedFromString('pen-3')).toBe(seedFromString('pen-3'));
    expect(seedFromString('pen-3')).not.toBe(seedFromString('pen-4'));
    expect(seedFromString('')).toBeGreaterThanOrEqual(0);
  });
});

describe('the uniform draw', () => {
  const random = createRandom('uniform');

  it('stays inside the unit interval', () => {
    for (const value of sampleOf(() => random.next(), 5_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads evenly across it', () => {
    const buckets = new Array<number>(10).fill(0);
    for (let index = 0; index < 40_000; index += 1) {
      const bucket = Math.floor(random.next() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(3_500);
      expect(count).toBeLessThan(4_500);
    }
  });

  it('respects a range and includes both ends of an integer one', () => {
    const seen = new Set<number>();
    for (let index = 0; index < 500; index += 1) {
      const value = random.between(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(20);
      seen.add(random.int(1, 3));
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('refuses a backwards integer range', () => {
    expect(() => random.int(5, 1)).toThrow(RangeError);
  });

  it('honours a probability', () => {
    let hits = 0;
    for (let index = 0; index < 20_000; index += 1) {
      if (random.chance(0.25)) hits += 1;
    }
    expect(hits / 20_000).toBeGreaterThan(0.235);
    expect(hits / 20_000).toBeLessThan(0.265);
  });
});

describe('the normal draw', () => {
  const random = createRandom('normal');

  it('centres on its mean', () => {
    expect(meanOf(sampleOf(() => random.normal(20, 3), 20_000))).toBeCloseTo(20, 0);
  });

  it('has the spread it was asked for', () => {
    const values = sampleOf(() => random.normal(20, 3), 20_000);
    expect(Math.sqrt(varianceOf(values))).toBeCloseTo(3, 0);
  });
});

describe('the gamma draw', () => {
  const random = createRandom('gamma');

  it('has a mean of shape times scale', () => {
    expect(meanOf(sampleOf(() => random.gamma(2, 3), 20_000))).toBeCloseTo(6, 0);
  });

  it('works below a shape of one, where the algorithm has to boost', () => {
    const values = sampleOf(() => random.gamma(0.3, 4), 20_000);
    expect(meanOf(values)).toBeCloseTo(1.2, 0);
    expect(values.every((value) => value >= 0)).toBe(true);
  });

  it('refuses a shape or scale that cannot exist', () => {
    expect(() => random.gamma(0, 3)).toThrow(RangeError);
    expect(() => random.gamma(2, 0)).toThrow(RangeError);
  });
});

describe('the poisson draw', () => {
  const random = createRandom('poisson');

  it('is always a non negative whole number', () => {
    for (const value of sampleOf(() => random.poisson(2.4), 2_000)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('has a mean and variance both equal to its parameter', () => {
    const values = sampleOf(() => random.poisson(4), 20_000);
    expect(meanOf(values)).toBeCloseTo(4, 0);
    expect(varianceOf(values)).toBeCloseTo(4, 0);
  });

  it('handles a large mean through the approximation', () => {
    expect(meanOf(sampleOf(() => random.poisson(200), 5_000))).toBeCloseTo(200, -1);
  });

  it('is always zero at a mean of zero', () => {
    expect(sampleOf(() => random.poisson(0), 100).every((value) => value === 0)).toBe(true);
    expect(() => random.poisson(-1)).toThrow(RangeError);
  });
});

describe('the negative binomial draw', () => {
  const random = createRandom('lice');

  it('keeps the mean it was asked for', () => {
    expect(meanOf(sampleOf(() => random.negativeBinomial(0.5, 0.3), 40_000))).toBeCloseTo(0.5, 1);
  });

  it('is far more clustered than a poisson of the same mean', () => {
    const clustered = sampleOf(() => random.negativeBinomial(2, 0.3), 20_000);
    const even = sampleOf(() => random.poisson(2), 20_000);
    expect(varianceOf(clustered) / meanOf(clustered)).toBeGreaterThan(3);
    expect(varianceOf(even) / meanOf(even)).toBeLessThan(1.3);
  });

  it('produces the many clean fish and few heavy ones a real count has', () => {
    const values = sampleOf(() => random.negativeBinomial(0.5, 0.3), 20_000);
    const clean = values.filter((value) => value === 0).length / values.length;
    expect(clean).toBeGreaterThan(0.6);
    expect(Math.max(...values)).toBeGreaterThan(4);
  });

  it('is nothing at a mean of zero and refuses a dispersion of zero', () => {
    expect(random.negativeBinomial(0, 0.3)).toBe(0);
    expect(() => random.negativeBinomial(1, 0)).toThrow(RangeError);
  });
});

describe('picking and shuffling', () => {
  const items = ['pen-1', 'pen-2', 'pen-3', 'pen-4'] as const;

  it('picks only from the list', () => {
    const random = createRandom('pick');
    for (let index = 0; index < 200; index += 1) {
      expect(items).toContain(random.pick(items));
    }
    expect(() => random.pick([])).toThrow(RangeError);
  });

  it('shuffles without losing or duplicating anything', () => {
    const shuffled = shuffle(items, createRandom('shuffle'));
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it('leaves the source alone and shuffles the same way from the same seed', () => {
    const source = [...items];
    shuffle(source, createRandom('s'));
    expect(source).toEqual([...items]);
    expect(shuffle(items, createRandom('s'))).toEqual(shuffle(items, createRandom('s')));
  });
});
