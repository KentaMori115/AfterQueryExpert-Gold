import { describe, expect, it } from 'vitest';

import {
  heatUpTo,
  isPlannable,
  positionTonnes,
  projectPen,
  projectPens,
  weekEnds,
} from '@/domain/harvest/forecast';
import { groupId, penId } from '@/domain/ids';
import { positionAt } from '@/domain/stock/ledger';

const DAY = 86_400_000;
const AT = Date.parse('2025-03-03T00:00:00Z');
const temperatures = Array.from({ length: 200 }, (_, index) => ({
  at: AT - 60 * DAY + index * DAY,
  meanC: 9,
}));

const events = [
  {
    id: 'a',
    groupId: groupId('G1'),
    at: AT - 400 * DAY,
    kind: 'stocked' as const,
    countDelta: 100_000,
    meanWeightG: 120,
    note: '',
  },
  {
    id: 'b',
    groupId: groupId('G1'),
    at: AT - 14 * DAY,
    kind: 'weighed' as const,
    countDelta: 0,
    meanWeightG: 4_000,
    note: '',
  },
];

const pen = { penId: penId('P1'), number: 1, tgc: 3, conditionFactor: 1.2, treatments: [], events };
const horizon = { at: AT, weeks: 3, temperatures };

describe('the weeks a plan covers', () => {
  it('ends each one a week further out than the last', () => {
    expect(weekEnds(horizon)).toEqual([AT + 7 * DAY, AT + 14 * DAY, AT + 21 * DAY]);
  });
});

describe('a pen carried forward', () => {
  const projection = projectPen(pen, horizon);

  it('runs one entry per week of the horizon', () => {
    expect(projection).toHaveLength(3);
    expect(projection[0]!.week).toBe(0);
  });

  it('reads every figure off the ledger rather than keeping its own', () => {
    const position = positionAt(events, AT + 14 * DAY, { tgc: 3, temperatures });
    expect(projection[1]!.meanWeightG).toBeCloseTo(position.meanWeightG, 9);
    expect(projection[1]!.count).toBe(position.count);
    expect(projection[1]!.biomassT).toBeCloseTo(position.biomassKg / 1_000, 9);
  });

  it('gains weight from one week to the next', () => {
    expect(projection[2]!.meanWeightG).toBeGreaterThan(projection[0]!.meanWeightG);
  });

  it('keeps one pen out of another', () => {
    const other = { ...pen, penId: penId('P2'), number: 2, tgc: 1 };
    const both = projectPens([pen, other], horizon);
    expect(both.get(penId('P1'))![2]!.meanWeightG).toBeGreaterThan(
      both.get(penId('P2'))![2]!.meanWeightG,
    );
  });
});

describe('what a plan will touch', () => {
  it('takes a log the ledger is happy with', () => {
    expect(isPlannable(pen)).toBe(true);
  });

  it('leaves one it is not', () => {
    const miskeyed = {
      ...pen,
      events: [...events, { ...events[0]!, id: 'c', kind: 'mortality' as const, countDelta: 40 }],
    };
    expect(isPlannable(miskeyed)).toBe(false);
  });

  it('offers the heat up to a week and no further', () => {
    const heat = heatUpTo(horizon, AT);
    expect(heat.every((sample) => sample.at < AT)).toBe(true);
    expect(heat).toHaveLength(60);
  });

  it('turns kilogrammes into the tonnes a licence uses', () => {
    expect(positionTonnes({ biomassKg: 2_500 } as never)).toBe(2.5);
  });
});
