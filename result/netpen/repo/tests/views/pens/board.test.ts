import { describe, expect, it } from 'vitest';

import {
  attentionScore,
  countIsOverdue,
  COUNT_STALE_DAYS,
  needsAttention,
  sortBoard,
  summarise,
} from '@/views/pens/board';

import { emptyPen, penView, TEST_NOW } from '../../support/penView';

const DAY = 86_400_000;

describe('attentionScore', () => {
  it('leaves a healthy pen at zero', () => {
    expect(attentionScore(penView(), TEST_NOW)).toBe(0);
  });

  it('ignores an empty pen entirely', () => {
    expect(attentionScore(emptyPen(4), TEST_NOW)).toBe(0);
  });

  it('puts enforcement above a plain breach', () => {
    const over = attentionScore(penView({ liceStatus: 'over-limit' }), TEST_NOW);
    const enforcement = attentionScore(penView({ liceStatus: 'enforcement' }), TEST_NOW);
    expect(enforcement).toBeGreaterThan(over);
  });

  it('adds up, so three amber states beat one red', () => {
    const one = penView({ oxygenBand: 'critical' });
    const three = penView({
      liceStatus: 'approaching',
      densityStatus: 'watch',
      mortalityLevel: 'elevated',
      withdrawalRemaining: 90,
    });
    expect(attentionScore(three, TEST_NOW)).toBeGreaterThan(attentionScore(one, TEST_NOW));
  });

  it('counts weeks over the limit, but stops rewarding them after three', () => {
    const two = attentionScore(penView({ liceStatus: 'over-limit', weeksOver: 2 }), TEST_NOW);
    const three = attentionScore(penView({ liceStatus: 'over-limit', weeksOver: 3 }), TEST_NOW);
    const nine = attentionScore(penView({ liceStatus: 'over-limit', weeksOver: 9 }), TEST_NOW);
    expect(three).toBeGreaterThan(two);
    expect(nine).toBe(three);
  });

  it('never goes negative', () => {
    expect(attentionScore(penView({ adultFemale: 0 }), TEST_NOW)).toBeGreaterThanOrEqual(0);
  });
});

describe('countIsOverdue', () => {
  it('is quiet on a fresh count', () => {
    expect(countIsOverdue(penView(), TEST_NOW)).toBe(false);
  });

  it('fires once the count is older than the window', () => {
    const stale = penView({ countedAt: TEST_NOW - (COUNT_STALE_DAYS + 1) * DAY });
    expect(countIsOverdue(stale, TEST_NOW)).toBe(true);
  });

  it('treats never counted as overdue', () => {
    expect(countIsOverdue(penView({ adultFemale: null, countedAt: null }), TEST_NOW)).toBe(true);
  });

  it('does not chase an empty pen for a count', () => {
    expect(countIsOverdue(emptyPen(6), TEST_NOW)).toBe(false);
  });
});

describe('needsAttention', () => {
  it('is false for a pen that is merely being watched on nothing', () => {
    expect(needsAttention(penView(), TEST_NOW)).toBe(false);
  });

  it('is true once lice are approaching', () => {
    expect(needsAttention(penView({ liceStatus: 'approaching' }), TEST_NOW)).toBe(true);
  });
});

describe('sortBoard', () => {
  const pens = [
    penView({ number: 3, adultFemale: 0.41, liceStatus: 'over-limit' }),
    penView({ number: 1, adultFemale: 0.02, meanWeightG: 5200 }),
    emptyPen(2),
    penView({ number: 4, adultFemale: 0.12, oxygenBand: 'reduced' }),
  ];

  function numbers(order: Parameters<typeof sortBoard>[1]): number[] {
    return sortBoard(pens, order, TEST_NOW).map((view) => view.pen.number);
  }

  it('keeps the walking order when asked for pen number, empty pens included', () => {
    expect(numbers('pen')).toEqual([1, 2, 3, 4]);
  });

  it('leads with the worst pen on attention', () => {
    expect(numbers('attention')[0]).toBe(3);
  });

  it('sinks empty pens on every order but pen number', () => {
    for (const order of ['attention', 'lice', 'biomass'] as const) {
      expect(numbers(order).at(-1)).toBe(2);
    }
  });

  it('breaks a tie on pen number rather than leaving it to chance', () => {
    const tied = [penView({ number: 5 }), penView({ number: 2 }), penView({ number: 8 })];
    expect(sortBoard(tied, 'attention', TEST_NOW).map((view) => view.pen.number)).toEqual([
      2, 5, 8,
    ]);
  });

  it('does not mutate what it was handed', () => {
    const before = pens.map((view) => view.pen.number);
    sortBoard(pens, 'lice', TEST_NOW);
    expect(pens.map((view) => view.pen.number)).toEqual(before);
  });

  it('ranks biggest first on biomass', () => {
    expect(numbers('biomass')[0]).toBe(1);
  });
});

describe('summarise', () => {
  const pens = [
    penView({ number: 1, count: 50_000, meanWeightG: 4000, adultFemale: 0.09 }),
    penView({ number: 2, count: 40_000, meanWeightG: 3000, adultFemale: 0.44 }),
    emptyPen(3),
  ];

  it('counts pens and stocked pens separately', () => {
    const summary = summarise(pens, TEST_NOW);
    expect(summary.pens).toBe(3);
    expect(summary.stocked).toBe(2);
  });

  it('totals biomass in tonnes and fish in head', () => {
    const summary = summarise(pens, TEST_NOW);
    expect(summary.biomassT).toBeCloseTo(320, 6);
    expect(summary.fish).toBe(90_000);
  });

  it('reports the worst lice figure on the site', () => {
    expect(summarise(pens, TEST_NOW).worstLice).toBeCloseTo(0.44, 6);
  });

  it('reports no worst figure when nothing has been counted', () => {
    expect(summarise([emptyPen(1)], TEST_NOW).worstLice).toBeNull();
  });
});
