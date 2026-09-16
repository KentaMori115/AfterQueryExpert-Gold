import { describe, expect, it } from 'vitest';

import { groupId } from '@/domain/ids';
import {
  carryWeightForward,
  ISSUE_LABELS,
  type LedgerOptions,
  ledgerSeries,
  positionAt,
  validate,
} from '@/domain/stock/ledger';
import type { StockEvent } from '@/domain/stock/types';
import type { TemperatureSample } from '@/domain/time/degreeDays';
import { addDays, parseInstant } from '@/domain/time/duration';

const stocked = parseInstant('2024-04-15T00:00:00Z');
const group = groupId('grp-s24-p3');

/** A steady ten degrees, which makes the degree-days easy to reason about. */
const temperatures: TemperatureSample[] = Array.from({ length: 400 }, (_unused, index) => ({
  at: addDays(stocked, index),
  meanC: 10,
}));

const options: LedgerOptions = { tgc: 3.0, temperatures };

let sequence = 0;
function event(overrides: Partial<StockEvent> = {}): StockEvent {
  sequence += 1;
  return {
    id: `evt-${String(sequence).padStart(3, '0')}`,
    groupId: group,
    at: stocked,
    kind: 'mortality',
    countDelta: -40,
    meanWeightG: 120,
    note: '',
    ...overrides,
  };
}

const log: StockEvent[] = [
  event({ at: stocked, kind: 'stocked', countDelta: 180_000, meanWeightG: 110 }),
  event({ at: addDays(stocked, 10), kind: 'mortality', countDelta: -300, meanWeightG: 130 }),
  event({ at: addDays(stocked, 30), kind: 'weighed', countDelta: 0, meanWeightG: 420 }),
  event({ at: addDays(stocked, 60), kind: 'mortality', countDelta: -450, meanWeightG: 800 }),
  event({ at: addDays(stocked, 90), kind: 'weighed', countDelta: 0, meanWeightG: 1_450 }),
  event({
    at: addDays(stocked, 120),
    kind: 'transferred-out',
    countDelta: -20_000,
    meanWeightG: 2_100,
  }),
];

describe('folding the log', () => {
  it('counts what went in', () => {
    const position = positionAt(log, stocked, options);
    expect(position.count).toBe(180_000);
    expect(position.stockedCount).toBe(180_000);
  });

  it('takes mortality off as it happens', () => {
    expect(positionAt(log, addDays(stocked, 10), options).count).toBe(179_700);
    expect(positionAt(log, addDays(stocked, 60), options).mortalityCount).toBe(750);
  });

  it('takes transfers off too', () => {
    const position = positionAt(log, addDays(stocked, 120), options);
    expect(position.count).toBe(180_000 - 750 - 20_000);
    expect(position.transferredOutCount).toBe(20_000);
  });

  it('ignores events after the instant asked about', () => {
    expect(positionAt(log, addDays(stocked, 5), options).count).toBe(180_000);
  });

  it('adds up the biomass that left', () => {
    const position = positionAt(log, addDays(stocked, 120), options);
    expect(position.mortalityBiomassKg).toBeCloseTo((300 * 130 + 450 * 800) / 1_000, 6);
  });

  it('is empty for a log with nothing in it', () => {
    const position = positionAt([], stocked, options);
    expect(position.count).toBe(0);
    expect(position.biomassKg).toBe(0);
  });
});

describe('carrying weight between weighings', () => {
  it('takes the weighed figure on the day it was taken', () => {
    expect(positionAt(log, addDays(stocked, 90), options).meanWeightG).toBeCloseTo(1_450, 6);
    expect(positionAt(log, addDays(stocked, 90), options).lastWeighedAt).toBe(addDays(stocked, 90));
  });

  it('grows it forward over the heat since', () => {
    // Thirty days at ten degrees is three hundred degree-days.
    const carried = positionAt(log, addDays(stocked, 120), options).meanWeightG;
    expect(carried).toBeGreaterThan(1_450);
    expect(carried).toBeCloseTo(
      carryWeightForward(1_450, addDays(stocked, 90), addDays(stocked, 120), options),
      6,
    );
  });

  it('understates nothing over a long interval', () => {
    const flat = 1_450;
    const carried = positionAt(log, addDays(stocked, 180), options).meanWeightG;
    expect(carried / flat).toBeGreaterThan(1.5);
  });

  it('holds the figure when there is no temperature to grow against', () => {
    const noHeat = { tgc: 3.0, temperatures: [] };
    expect(positionAt(log, addDays(stocked, 180), noHeat).meanWeightG).toBeCloseTo(1_450, 6);
  });

  it('does not grow backwards before the weighing', () => {
    expect(carryWeightForward(1_450, addDays(stocked, 90), addDays(stocked, 60), options)).toBe(
      1_450,
    );
  });

  it('has nothing to carry from a pen never weighed', () => {
    expect(carryWeightForward(0, null, addDays(stocked, 60), options)).toBe(0);
  });
});

describe('biomass', () => {
  it('is the standing count at the carried weight', () => {
    const position = positionAt(log, addDays(stocked, 120), options);
    expect(position.biomassKg).toBeCloseTo((position.count * position.meanWeightG) / 1_000, 6);
  });

  it('climbs through the cycle even as fish are lost', () => {
    const early = positionAt(log, addDays(stocked, 30), options);
    const late = positionAt(log, addDays(stocked, 200), options);
    expect(late.count).toBeLessThan(early.count);
    expect(late.biomassKg).toBeGreaterThan(early.biomassKg);
  });
});

describe('a series of positions', () => {
  it('gives one per instant asked for', () => {
    const weekly = Array.from({ length: 10 }, (_unused, index) => addDays(stocked, index * 7));
    const series = ledgerSeries(log, weekly, options);
    expect(series).toHaveLength(10);
    expect(series[0]?.at).toBe(stocked);
    expect(series.at(-1)?.biomassKg).toBeGreaterThan(series[0]!.biomassKg);
  });
});

describe('validating a log', () => {
  it('passes a clean log', () => {
    expect(validate(log)).toEqual([]);
  });

  it('catches a sign the wrong way round', () => {
    const bad = [...log, event({ kind: 'mortality', countDelta: 40, at: addDays(stocked, 130) })];
    const issues = validate(bad);
    expect(issues.map((issue) => issue.kind)).toContain('inconsistent-sign');
    expect(issues[0]?.message).toContain('mortality');
  });

  it('catches a mortality with no weight on it', () => {
    const bad = [
      ...log,
      event({ kind: 'mortality', countDelta: -10, meanWeightG: null, at: addDays(stocked, 130) }),
    ];
    expect(validate(bad).map((issue) => issue.kind)).toContain('missing-weight');
  });

  it('catches a log with nothing ever stocked', () => {
    const issues = validate([event({ kind: 'mortality', countDelta: -40 })]);
    expect(issues.map((issue) => issue.kind)).toContain('no-stocking');
    expect(issues.map((issue) => issue.kind)).toContain('out-of-order-stocking');
  });

  it('catches a log that takes the pen below zero', () => {
    const bad = [
      event({ at: stocked, kind: 'stocked', countDelta: 100, meanWeightG: 110 }),
      event({ at: addDays(stocked, 1), kind: 'mortality', countDelta: -500, meanWeightG: 120 }),
    ];
    expect(validate(bad).map((issue) => issue.kind)).toContain('negative-count');
  });

  it('has a sentence for every issue', () => {
    expect(Object.keys(ISSUE_LABELS)).toHaveLength(5);
  });
});
