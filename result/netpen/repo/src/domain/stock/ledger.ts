/**
 * The stock ledger.
 *
 * Every figure about a pen is derived from the event log rather than stored,
 * because a running total that is written to by six different screens drifts,
 * and a pen whose stated count disagrees with its history is a pen nobody can
 * reconcile at harvest. Correcting a mistake means adding an adjustment event,
 * not editing the past.
 *
 * Mean weight is the subtle part. It is only known on the days somebody
 * weighed a sample; between weighings the pen keeps growing and the ledger has
 * to carry it forward, which it does with the group's growth coefficient and
 * the temperature that actually happened. A ledger that holds the last weighed
 * figure flat understates biomass by more and more as the interval lengthens,
 * and the interval is often a month.
 */

import { byEventTime, hasConsistentSign, type StockEvent } from './types';
import { weightAfter } from '../growth/tgc';
import { accumulate, type TemperatureSample } from '../time/degreeDays';
import type { Instant } from '../time/duration';

export interface StockPosition {
  readonly at: Instant;
  readonly count: number;
  readonly meanWeightG: number;
  readonly biomassKg: number;
  readonly stockedCount: number;
  readonly mortalityCount: number;
  readonly harvestedCount: number;
  readonly transferredInCount: number;
  readonly transferredOutCount: number;
  readonly escapedCount: number;
  readonly adjustmentCount: number;
  readonly lastWeighedAt: Instant | null;
  readonly mortalityBiomassKg: number;
  readonly harvestedBiomassKg: number;
}

export const EMPTY_POSITION: StockPosition = {
  at: 0,
  count: 0,
  meanWeightG: 0,
  biomassKg: 0,
  stockedCount: 0,
  mortalityCount: 0,
  harvestedCount: 0,
  transferredInCount: 0,
  transferredOutCount: 0,
  escapedCount: 0,
  adjustmentCount: 0,
  lastWeighedAt: null,
  mortalityBiomassKg: 0,
  harvestedBiomassKg: 0,
};

export interface LedgerOptions {
  /** Growth coefficient used to carry weight between weighings. */
  readonly tgc: number;
  /** Daily mean temperatures, used to accumulate heat since the last weighing. */
  readonly temperatures: readonly TemperatureSample[];
}

/**
 * Fold the log up to an instant. Events after it are ignored rather than
 * treated as an error, so the same log answers "where was this pen in week 20"
 * without being filtered first.
 */
export function positionAt(
  events: readonly StockEvent[],
  at: Instant,
  options: LedgerOptions,
): StockPosition {
  const ordered = [...events].filter((event) => event.at <= at).sort(byEventTime);

  let count = 0;
  let weighedWeightG = 0;
  let lastWeighedAt: Instant | null = null;
  const totals = { ...EMPTY_POSITION };

  for (const event of ordered) {
    switch (event.kind) {
      case 'stocked':
        totals.stockedCount += event.countDelta;
        weighedWeightG = event.meanWeightG ?? weighedWeightG;
        lastWeighedAt = event.at;
        break;
      case 'mortality':
        totals.mortalityCount += -event.countDelta;
        totals.mortalityBiomassKg += (-event.countDelta * (event.meanWeightG ?? 0)) / 1_000;
        break;
      case 'harvested':
        totals.harvestedCount += -event.countDelta;
        totals.harvestedBiomassKg += (-event.countDelta * (event.meanWeightG ?? 0)) / 1_000;
        break;
      case 'transferred-in':
        totals.transferredInCount += event.countDelta;
        break;
      case 'transferred-out':
        totals.transferredOutCount += -event.countDelta;
        break;
      case 'escape':
        totals.escapedCount += -event.countDelta;
        break;
      case 'count-adjustment':
        totals.adjustmentCount += event.countDelta;
        break;
      case 'weighed':
        weighedWeightG = event.meanWeightG ?? weighedWeightG;
        lastWeighedAt = event.at;
        break;
    }

    if (event.kind !== 'weighed') count += event.countDelta;
  }

  const meanWeightG = carryWeightForward(weighedWeightG, lastWeighedAt, at, options);

  return {
    ...totals,
    at,
    count: count > 0 ? count : 0,
    meanWeightG,
    biomassKg: (Math.max(count, 0) * meanWeightG) / 1_000,
    lastWeighedAt,
  };
}

/**
 * Grow the last weighed figure forward over the heat since. Returns the
 * weighed figure unchanged when there is no temperature record to grow it
 * against, which is honest: without temperature there is nothing to say.
 */
export function carryWeightForward(
  weighedWeightG: number,
  weighedAt: Instant | null,
  at: Instant,
  options: LedgerOptions,
): number {
  if (weighedWeightG <= 0 || weighedAt === null || at <= weighedAt) return weighedWeightG;

  const heat = accumulate(
    options.temperatures.filter((sample) => sample.at >= weighedAt && sample.at < at),
  );
  if (heat <= 0) return weighedWeightG;

  return weightAfter(weighedWeightG, heat, options.tgc);
}

/** The position on each of a series of instants, for a chart or a table. */
export function ledgerSeries(
  events: readonly StockEvent[],
  instants: readonly Instant[],
  options: LedgerOptions,
): StockPosition[] {
  return instants.map((at) => positionAt(events, at, options));
}

export type LedgerIssueKind =
  | 'inconsistent-sign'
  | 'missing-weight'
  | 'negative-count'
  | 'out-of-order-stocking'
  | 'no-stocking';

export interface LedgerIssue {
  readonly kind: LedgerIssueKind;
  readonly eventId: string | null;
  readonly message: string;
}

export const ISSUE_LABELS: Record<LedgerIssueKind, string> = {
  'inconsistent-sign': 'Event moves fish the wrong way',
  'missing-weight': 'Event needs a mean weight and has none',
  'negative-count': 'Log takes the pen below zero fish',
  'out-of-order-stocking': 'Fish leave the pen before any were put in',
  'no-stocking': 'Group has no stocking event',
};

/**
 * Check a log before trusting it. Cheap, and it catches the two mistakes that
 * are otherwise found at harvest: a sign the wrong way round, and a mortality
 * recorded against a pen that was never stocked.
 */
export function validate(events: readonly StockEvent[]): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  const ordered = [...events].sort(byEventTime);

  if (!ordered.some((event) => event.kind === 'stocked')) {
    issues.push({
      kind: 'no-stocking',
      eventId: null,
      message: ISSUE_LABELS['no-stocking'],
    });
  }

  let running = 0;
  let stockedYet = false;

  for (const event of ordered) {
    if (!hasConsistentSign(event)) {
      issues.push({
        kind: 'inconsistent-sign',
        eventId: event.id,
        message: `${event.kind} with a delta of ${event.countDelta}`,
      });
    }

    if ((event.kind === 'mortality' || event.kind === 'harvested') && event.meanWeightG === null) {
      issues.push({
        kind: 'missing-weight',
        eventId: event.id,
        message: `${event.kind} carries no mean weight`,
      });
    }

    if (event.kind === 'stocked') stockedYet = true;
    else if (!stockedYet && event.countDelta < 0) {
      issues.push({
        kind: 'out-of-order-stocking',
        eventId: event.id,
        message: ISSUE_LABELS['out-of-order-stocking'],
      });
    }

    if (event.kind !== 'weighed') running += event.countDelta;
    if (running < 0) {
      issues.push({
        kind: 'negative-count',
        eventId: event.id,
        message: `Standing count would be ${running}`,
      });
      running = 0;
    }
  }

  return issues;
}
