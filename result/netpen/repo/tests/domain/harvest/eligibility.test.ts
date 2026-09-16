import { describe, expect, it } from 'vitest';

import {
  blockerAt,
  earliestHarvestWeek,
  formatBlocker,
  heldBy,
  isBigEnough,
  isReady,
} from '@/domain/harvest/eligibility';
import { projectPen } from '@/domain/harvest/forecast';
import { groupId, penId } from '@/domain/ids';

const DAY = 86_400_000;
const AT = Date.parse('2025-03-03T00:00:00Z');
const temperatures = Array.from({ length: 200 }, (_, index) => ({
  at: AT - 60 * DAY + index * DAY,
  meanC: 10,
}));

const treatment = (method: string) => ({
  id: 't1',
  method,
  completedAt: AT - 3 * DAY,
  penId: 'P1',
  beforeCount: 1.2,
  afterCount: 0.2,
  note: '',
});

const pen = {
  penId: penId('P1'),
  number: 1,
  tgc: 3,
  conditionFactor: 1.2,
  treatments: [treatment('emamectin-benzoate')] as never,
  events: [
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
      at: AT - 7 * DAY,
      kind: 'weighed' as const,
      countDelta: 0,
      meanWeightG: 3_400,
      note: '',
    },
  ],
};

const horizon = { at: AT, weeks: 5, temperatures };
const projection = projectPen(pen, horizon);

describe('waiting on a medicine', () => {
  it('holds the pen while the heat is short of the withdrawal', () => {
    expect(heldBy(pen, horizon, projection[0]!)).not.toBeNull();
  });

  it('lets it go once the heat has covered it', () => {
    expect(heldBy(pen, horizon, projection[3]!)).toBeNull();
  });

  it('never holds it for a method with no withdrawal at all', () => {
    const brushed = { ...pen, treatments: [treatment('mechanical-brush')] as never };
    expect(heldBy(brushed, horizon, projection[0]!)).toBeNull();
  });
});

describe('waiting on size', () => {
  it('is met once the fish reach the contract', () => {
    expect(isBigEnough(projection[0]!, 3_100)).toBe(true);
    expect(isBigEnough(projection[0]!, 4_500)).toBe(false);
  });

  it('reads the gutted weight, which is under the live one', () => {
    expect(projection[0]!.meanWeightG).toBeGreaterThan(3_600);
    expect(projection[0]!.guttedWeightG).toBeCloseTo(3_175.9197, 3);
    expect(isBigEnough(projection[0]!, 3_500)).toBe(false);
  });
});

describe('the two floors together', () => {
  it('take the later of them', () => {
    expect(earliestHarvestWeek(pen, horizon, projection, 3_000)).toBe(2);
    expect(earliestHarvestWeek(pen, horizon, projection, 3_500)).toBe(3);
  });

  it('leave a pen alone that never meets both', () => {
    expect(earliestHarvestWeek(pen, horizon, projection, 9_000)).toBeNull();
  });

  it('hold from that week on rather than only in it', () => {
    expect(isReady(pen, horizon, projection[1]!, 3_000)).toBe(false);
    expect(isReady(pen, horizon, projection[2]!, 3_000)).toBe(true);
  });
});

describe('what is holding a pen', () => {
  it('names the regulator first where both apply', () => {
    expect(blockerAt(pen, horizon, projection[0]!, 9_000)).toBe('withdrawal');
  });

  it('names size once the medicine has cleared', () => {
    expect(blockerAt(pen, horizon, projection[3]!, 9_000)).toBe('size');
  });

  it('names nothing when the pen may go', () => {
    expect(blockerAt(pen, horizon, projection[3]!, 3_000)).toBeNull();
    expect(formatBlocker(null)).toContain('Clear');
  });
});
