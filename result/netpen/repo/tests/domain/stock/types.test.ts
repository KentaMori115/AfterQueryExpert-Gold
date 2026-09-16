import { describe, expect, it } from 'vitest';

import { generationId, groupId, penId, siteId } from '@/domain/ids';
import {
  byEventTime,
  EVENT_LABELS,
  type Generation,
  GENERATION_STATUS_LABELS,
  hasConsistentSign,
  isLive,
  isOpen,
  MOVEMENT_EVENTS,
  movesFish,
  type StockEvent,
  type StockGroup,
} from '@/domain/stock/types';
import { addDays, parseInstant } from '@/domain/time/duration';

const stocked = parseInstant('2024-04-15T00:00:00Z');

const generation: Generation = {
  id: generationId('gen-s24'),
  siteId: siteId('site-1'),
  code: 'S24',
  input: 'spring',
  status: 'growing',
  hatchery: 'Loch Aline',
  strain: 'Mowi 4',
  firstStockedAt: stocked,
  lastHarvestedAt: null,
  budgetTgc: 3.1,
  budgetFcr: 1.15,
  notes: '',
};

const group: StockGroup = {
  id: groupId('grp-s24-p3'),
  generationId: generation.id,
  penId: penId('pen-3'),
  reference: 'S24-P3',
  stockedAt: stocked,
  closedAt: null,
  notes: '',
};

function event(overrides: Partial<StockEvent> = {}): StockEvent {
  return {
    id: 'evt-1',
    groupId: group.id,
    at: stocked,
    kind: 'mortality',
    countDelta: -40,
    meanWeightG: 3_200,
    note: '',
    ...overrides,
  };
}

describe('generations', () => {
  it('is live through stocking, growing and harvesting', () => {
    for (const status of ['stocking', 'growing', 'harvesting'] as const) {
      expect(isLive({ ...generation, status })).toBe(true);
    }
  });

  it('is not live before it starts or after it closes', () => {
    expect(isLive({ ...generation, status: 'planned' })).toBe(false);
    expect(isLive({ ...generation, status: 'closed' })).toBe(false);
  });

  it('names every status', () => {
    expect(Object.keys(GENERATION_STATUS_LABELS)).toHaveLength(5);
  });
});

describe('groups', () => {
  it('is open while it has not been closed', () => {
    expect(isOpen(group, addDays(stocked, 200))).toBe(true);
  });

  it('closes at the instant it was closed', () => {
    const closed = { ...group, closedAt: addDays(stocked, 500) };
    expect(isOpen(closed, addDays(stocked, 499))).toBe(true);
    expect(isOpen(closed, addDays(stocked, 500))).toBe(false);
  });
});

describe('events', () => {
  it('separates the ones that move fish from the ones that only measure', () => {
    expect(movesFish('mortality')).toBe(true);
    expect(movesFish('harvested')).toBe(true);
    expect(movesFish('weighed')).toBe(false);
    expect(MOVEMENT_EVENTS).toHaveLength(7);
  });

  it('names every kind', () => {
    expect(Object.keys(EVENT_LABELS)).toHaveLength(8);
    expect(EVENT_LABELS['transferred-in']).toBe('Transferred in');
  });

  it('requires anything leaving the pen to be negative', () => {
    expect(hasConsistentSign(event({ kind: 'mortality', countDelta: -40 }))).toBe(true);
    expect(hasConsistentSign(event({ kind: 'mortality', countDelta: 40 }))).toBe(false);
    expect(hasConsistentSign(event({ kind: 'harvested', countDelta: -50_000 }))).toBe(true);
    expect(hasConsistentSign(event({ kind: 'escape', countDelta: 500 }))).toBe(false);
  });

  it('requires anything arriving to be positive', () => {
    expect(hasConsistentSign(event({ kind: 'stocked', countDelta: 180_000 }))).toBe(true);
    expect(hasConsistentSign(event({ kind: 'stocked', countDelta: -180_000 }))).toBe(false);
    expect(hasConsistentSign(event({ kind: 'transferred-in', countDelta: 20_000 }))).toBe(true);
  });

  it('lets an adjustment go either way but not nowhere', () => {
    expect(hasConsistentSign(event({ kind: 'count-adjustment', countDelta: 1_200 }))).toBe(true);
    expect(hasConsistentSign(event({ kind: 'count-adjustment', countDelta: -1_200 }))).toBe(true);
    expect(hasConsistentSign(event({ kind: 'count-adjustment', countDelta: 0 }))).toBe(false);
  });

  it('requires a weighing to move no fish at all', () => {
    expect(hasConsistentSign(event({ kind: 'weighed', countDelta: 0 }))).toBe(true);
    expect(hasConsistentSign(event({ kind: 'weighed', countDelta: -5 }))).toBe(false);
  });

  it('orders by time and then by id so the sort is stable', () => {
    const first = event({ id: 'a', at: stocked });
    const second = event({ id: 'b', at: stocked });
    const later = event({ id: 'c', at: addDays(stocked, 1) });
    expect([later, second, first].sort(byEventTime).map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
