/**
 * Indexed access over a dataset.
 *
 * A single row on the pen board joins across seven collections: the pen, the
 * group in it, its stock log, its lice counts, the treatments on it, the
 * oxygen readings and the temperature series. Doing that with array scans is
 * fine for eight pens and hopeless for a company with forty sites, so the
 * joins go through maps built once.
 *
 * The context holds no derived values at all. Anything computed lives in a
 * projection, so there is never a question of whether a cached figure is
 * stale, and a correction to the log is visible on the next read.
 */

import type { TreatmentEvent } from '@/domain/health/treatment';
import type { Pen } from '@/domain/site/types';
import type { StockEvent, StockGroup } from '@/domain/stock/types';
import type { TemperatureSample } from '@/domain/time/degreeDays';

import type { Dataset, LiceCount, OxygenReading, Person } from '../fixtures';

function index<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

function group<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const bucket = map.get(key(item));
    if (bucket) bucket.push(item);
    else map.set(key(item), [item]);
  }
  return map;
}

export interface DataContext {
  readonly dataset: Dataset;
  readonly penById: ReadonlyMap<string, Pen>;
  readonly penByNumber: ReadonlyMap<number, Pen>;
  readonly groupById: ReadonlyMap<string, StockGroup>;
  readonly groupByPen: ReadonlyMap<string, StockGroup>;
  readonly eventsByGroup: ReadonlyMap<string, StockEvent[]>;
  readonly liceByGroup: ReadonlyMap<string, LiceCount[]>;
  readonly liceByPen: ReadonlyMap<string, LiceCount[]>;
  readonly treatmentsByPen: ReadonlyMap<string, TreatmentEvent[]>;
  readonly oxygenByPen: ReadonlyMap<string, OxygenReading[]>;
  readonly personById: ReadonlyMap<string, Person>;
  /** Daily means at the depth decisions are taken against, up to now. */
  readonly reference: readonly TemperatureSample[];
  /** Daily normals running forward, which a projection grows on. */
  readonly forecast: readonly TemperatureSample[];
  temperaturesAt(depthM: number): readonly TemperatureSample[];
}

export const REFERENCE_DEPTH_M = 5;

export function createContext(dataset: Dataset): DataContext {
  const liceByGroup = group(dataset.liceCounts, (count) => String(count.groupId));

  return {
    dataset,
    penById: index(dataset.pens, (pen) => String(pen.id)),
    penByNumber: new Map(dataset.pens.map((pen) => [pen.number, pen])),
    groupById: index(dataset.groups, (entry) => String(entry.id)),
    groupByPen: index(dataset.groups, (entry) => String(entry.penId)),
    eventsByGroup: group(dataset.events, (event) => String(event.groupId)),
    liceByGroup,
    liceByPen: group(dataset.liceCounts, (count) => String(count.penId)),
    treatmentsByPen: group(dataset.treatments, (treatment) => treatment.penId),
    oxygenByPen: group(dataset.oxygen, (reading) => reading.penId),
    personById: index(dataset.people, (person) => String(person.id)),
    reference: dataset.temperatures.get(REFERENCE_DEPTH_M) ?? [],
    forecast: dataset.forecast,
    temperaturesAt(depthM) {
      return dataset.temperatures.get(depthM) ?? [];
    },
  };
}

/** The group currently in a pen, if it still holds fish. */
export function openGroupIn(
  context: DataContext,
  penIdValue: string,
  at: number,
): StockGroup | null {
  const candidate = context.groupByPen.get(penIdValue);
  if (!candidate) return null;
  if (candidate.closedAt !== null && candidate.closedAt <= at) return null;
  return candidate;
}

/** Stock events for a group in time order, which the ledger assumes. */
export function eventsFor(context: DataContext, groupIdValue: string): StockEvent[] {
  return [...(context.eventsByGroup.get(groupIdValue) ?? [])].sort((a, b) =>
    a.at !== b.at ? a.at - b.at : a.id.localeCompare(b.id),
  );
}

/** The most recent lice count on a group at or before an instant. */
export function latestCount(
  context: DataContext,
  groupIdValue: string,
  at: number,
): LiceCount | null {
  const counts = (context.liceByGroup.get(groupIdValue) ?? []).filter(
    (count) => count.countedAt <= at,
  );
  if (counts.length === 0) return null;
  return counts.reduce((latest, count) => (count.countedAt > latest.countedAt ? count : latest));
}

/** Oxygen readings on a pen inside a window, oldest first. */
export function oxygenBetween(
  context: DataContext,
  penIdValue: string,
  from: number,
  to: number,
): OxygenReading[] {
  return (context.oxygenByPen.get(penIdValue) ?? [])
    .filter((reading) => reading.at >= from && reading.at < to)
    .sort((a, b) => a.at - b.at);
}
