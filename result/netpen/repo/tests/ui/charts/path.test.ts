import { describe, expect, it } from 'vitest';

import { areaPath, linePath, runsIn, thin, type Point, type Projection } from '@/ui/charts/path';

/** Identity projection, so the assertions read in data coordinates. */
const projection: Projection = { toX: (value) => value, toY: (value) => value };

const series: Point[] = [
  { x: 0, y: 10 },
  { x: 1, y: 12 },
  { x: 2, y: 14 },
];

describe('the line', () => {
  it('moves to the first point and draws to the rest', () => {
    expect(linePath(series, projection)).toBe('M0 10 L1 12 L2 14');
  });

  it('is empty for an empty series', () => {
    expect(linePath([], projection)).toBe('');
  });

  it('breaks where the series has no value', () => {
    const withGap: Point[] = [
      { x: 0, y: 10 },
      { x: 1, y: null },
      { x: 2, y: 14 },
    ];
    expect(linePath(withGap, projection)).toBe('M0 10 M2 14');
  });

  it('breaks on a value that is not a number', () => {
    const dirty: Point[] = [
      { x: 0, y: 10 },
      { x: 1, y: Number.NaN },
      { x: 2, y: 14 },
    ];
    expect(linePath(dirty, projection)).toBe('M0 10 M2 14');
  });

  it('rounds to two places so the markup stays readable', () => {
    expect(linePath([{ x: 0.123456, y: 9.87654 }], projection)).toBe('M0.12 9.88');
  });

  it('applies the projection it was given', () => {
    const scaled: Projection = { toX: (value) => value * 10, toY: (value) => 100 - value };
    expect(linePath(series, scaled)).toBe('M0 90 L10 88 L20 86');
  });
});

describe('the filled area', () => {
  it('closes back to the baseline', () => {
    expect(areaPath(series, projection, 0)).toBe('M0 0 L0 10 L1 12 L2 14 L2 0 Z');
  });

  it('is empty for an empty series', () => {
    expect(areaPath([], projection, 0)).toBe('');
  });

  it('leaves a hole rather than a wedge across a gap', () => {
    const withGap: Point[] = [
      { x: 0, y: 10 },
      { x: 1, y: 12 },
      { x: 2, y: null },
      { x: 3, y: 14 },
    ];
    const path = areaPath(withGap, projection, 0);
    expect(path.match(/Z/g)).toHaveLength(2);
    expect(path).toContain('M0 0');
    expect(path).toContain('M3 0');
  });
});

describe('runs', () => {
  it('is one run for an unbroken series', () => {
    expect(runsIn(series)).toHaveLength(1);
  });

  it('splits at every gap', () => {
    const broken: Point[] = [
      { x: 0, y: 1 },
      { x: 1, y: null },
      { x: 2, y: 3 },
      { x: 3, y: null },
      { x: 4, y: 5 },
    ];
    expect(runsIn(broken)).toHaveLength(3);
  });

  it('has no runs where nothing was ever recorded', () => {
    expect(runsIn([{ x: 0, y: null }])).toEqual([]);
    expect(runsIn([])).toEqual([]);
  });
});

describe('thinning', () => {
  const long: Point[] = Array.from({ length: 500 }, (_unused, index) => ({ x: index, y: index }));

  it('leaves a short series alone', () => {
    expect(thin(series, 180)).toEqual(series);
  });

  it('reduces a long series toward the target', () => {
    const kept = thin(long, 120);
    expect(kept.length).toBeLessThanOrEqual(120);
    expect(kept.length).toBeGreaterThan(100);
  });

  it('always keeps the first and last point', () => {
    const kept = thin(long, 50);
    expect(kept[0]).toEqual(long[0]);
    expect(kept.at(-1)).toEqual(long.at(-1));
  });

  it('keeps them in order and never repeats one', () => {
    const kept = thin(long, 37);
    const xs = kept.map((point) => point.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('copies rather than aliasing the input', () => {
    expect(thin(series, 180)).not.toBe(series);
  });
});
