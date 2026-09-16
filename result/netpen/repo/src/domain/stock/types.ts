/**
 * Generations and the groups of fish that make them up.
 *
 * A generation is a year class: all the smolt that went to sea in one input
 * window, tracked together for the life of the cycle. It is the unit the
 * fallowing rule applies to and the unit a site is audited on, because the
 * whole point of single year class farming is that a site holds one generation
 * at a time and then lies empty.
 *
 * A group is the fish from one generation sitting in one pen. Groups split
 * when stock is moved and merge when pens are consolidated, so a group has a
 * history rather than just a number, and the ledger is what reconstructs the
 * standing position from it.
 */

import type { GenerationId, GroupId, PenId, SiteId } from '../ids';
import type { Instant } from '../time/duration';

export type GenerationStatus = 'planned' | 'stocking' | 'growing' | 'harvesting' | 'closed';

export interface Generation {
  readonly id: GenerationId;
  readonly siteId: SiteId;
  /** Year class as everyone writes it, for example S24 or A24. */
  readonly code: string;
  /** Spring or autumn input, which decides the whole shape of the cycle. */
  readonly input: 'spring' | 'autumn';
  readonly status: GenerationStatus;
  readonly hatchery: string;
  readonly strain: string;
  readonly firstStockedAt: Instant | null;
  readonly lastHarvestedAt: Instant | null;
  /** Growth coefficient the budget was written against. */
  readonly budgetTgc: number;
  /** Conversion ratio the budget was written against. */
  readonly budgetFcr: number;
  readonly notes: string;
}

export const GENERATION_STATUS_LABELS: Record<GenerationStatus, string> = {
  planned: 'Planned',
  stocking: 'Stocking',
  growing: 'Growing',
  harvesting: 'Harvesting',
  closed: 'Closed',
};

export function isLive(generation: Generation): boolean {
  return (
    generation.status === 'stocking' ||
    generation.status === 'growing' ||
    generation.status === 'harvesting'
  );
}

export interface StockGroup {
  readonly id: GroupId;
  readonly generationId: GenerationId;
  readonly penId: PenId;
  /** What the crew calls it, usually the generation and the pen. */
  readonly reference: string;
  readonly stockedAt: Instant;
  readonly closedAt: Instant | null;
  readonly notes: string;
}

export function isOpen(group: StockGroup, at: Instant): boolean {
  return group.closedAt === null || group.closedAt > at;
}

/**
 * Everything that changes how many fish are in a pen or what they weigh. The
 * ledger is built from these and nothing else, so a correction is a new entry
 * rather than an edit to a running total.
 */
export type StockEventKind =
  | 'stocked'
  | 'mortality'
  | 'harvested'
  | 'transferred-in'
  | 'transferred-out'
  | 'escape'
  | 'count-adjustment'
  | 'weighed';

export interface StockEvent {
  readonly id: string;
  readonly groupId: GroupId;
  readonly at: Instant;
  readonly kind: StockEventKind;
  /** Signed. Negative for anything leaving the pen. */
  readonly countDelta: number;
  /** Mean weight of the fish involved, grams. Null on a pure count adjustment. */
  readonly meanWeightG: number | null;
  readonly note: string;
}

export const EVENT_LABELS: Record<StockEventKind, string> = {
  stocked: 'Stocked',
  mortality: 'Mortality',
  harvested: 'Harvested',
  'transferred-in': 'Transferred in',
  'transferred-out': 'Transferred out',
  escape: 'Escape',
  'count-adjustment': 'Count adjustment',
  weighed: 'Weighed',
};

/** Events that move fish, as against ones that only record a measurement. */
export const MOVEMENT_EVENTS: readonly StockEventKind[] = [
  'stocked',
  'mortality',
  'harvested',
  'transferred-in',
  'transferred-out',
  'escape',
  'count-adjustment',
];

export function movesFish(kind: StockEventKind): boolean {
  return MOVEMENT_EVENTS.includes(kind);
}

/**
 * Whether an event's sign is the one its kind requires. A mortality with a
 * positive delta is a transcription error, and catching it at the boundary is
 * far cheaper than reconciling a standing count that has quietly drifted.
 */
export function hasConsistentSign(event: StockEvent): boolean {
  switch (event.kind) {
    case 'stocked':
    case 'transferred-in':
      return event.countDelta > 0;
    case 'mortality':
    case 'harvested':
    case 'transferred-out':
    case 'escape':
      return event.countDelta < 0;
    case 'count-adjustment':
      return event.countDelta !== 0;
    case 'weighed':
      return event.countDelta === 0;
  }
}

export function byEventTime(a: StockEvent, b: StockEvent): number {
  return a.at !== b.at ? a.at - b.at : a.id.localeCompare(b.id);
}
