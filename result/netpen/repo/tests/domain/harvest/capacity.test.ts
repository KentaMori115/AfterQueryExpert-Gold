import { describe, expect, it } from 'vitest';

import {
  bookedTonnes,
  fits,
  formatSlot,
  idleCapacityT,
  isFree,
  openSlots,
  openWeeks,
  remainingT,
  reserve,
  slotAt,
} from '@/domain/harvest/capacity';
import { penId } from '@/domain/ids';

const ledger = openSlots([600, 600, 450]);

describe('an untouched ledger', () => {
  it('holds a slot for every week the boat runs', () => {
    expect(ledger).toHaveLength(3);
    expect(openWeeks(ledger)).toEqual([0, 1, 2]);
  });

  it('has taken nothing and offered everything', () => {
    expect(bookedTonnes(ledger)).toBe(0);
    expect(idleCapacityT(ledger)).toBe(1_650);
  });

  it('knows nothing about a week outside the horizon', () => {
    expect(slotAt(ledger, 9)).toBeNull();
    expect(isFree(ledger, 9)).toBe(false);
    expect(fits(ledger, 9, 1)).toBe(false);
  });
});

describe('what the boat will take', () => {
  it('takes a load exactly at capacity', () => {
    expect(fits(ledger, 2, 450)).toBe(true);
  });

  it('refuses a load over it', () => {
    expect(fits(ledger, 2, 450.01)).toBe(false);
  });

  it('counts a week against what is already in it', () => {
    const part = reserve(ledger, 2, penId('P1'), 300);
    expect(remainingT(part, 2)).toBe(150);
    expect(fits(part, 2, 150)).toBe(true);
    expect(fits(part, 2, 150.01)).toBe(false);
  });
});

describe('booking a week', () => {
  const booked = reserve(ledger, 1, penId('P3'), 512);

  it('leaves the week open while there is room in it', () => {
    expect(isFree(booked, 1)).toBe(true);
    expect(openWeeks(booked)).toEqual([0, 1, 2]);
    expect(remainingT(booked, 1)).toBe(88);
  });

  it('remembers what was put on the boat', () => {
    expect(bookedTonnes(booked)).toBe(512);
    expect(idleCapacityT(booked)).toBe(1_138);
  });

  it('leaves the ledger it was given alone', () => {
    expect(bookedTonnes(ledger)).toBe(0);
    expect(remainingT(ledger, 1)).toBe(600);
  });

  it('takes a second pen into the same week while it fits', () => {
    const shared = reserve(booked, 1, penId('P4'), 88);
    expect(shared[1]!.penIds).toEqual([penId('P3'), penId('P4')]);
    expect(isFree(shared, 1)).toBe(false);
    expect(openWeeks(shared)).toEqual([0, 2]);
  });

  it('refuses one that would put the week over', () => {
    expect(() => reserve(booked, 1, penId('P4'), 88.01)).toThrow(RangeError);
  });

  it('refuses the same pen twice in a week', () => {
    expect(() => reserve(booked, 1, penId('P3'), 10)).toThrow(RangeError);
  });

  it('refuses a week the boat does not run', () => {
    expect(() => reserve(booked, 7, penId('P4'), 100)).toThrow(RangeError);
  });

  it('reads back as a line the crew can use', () => {
    expect(formatSlot(booked[1]!)).toContain('P3');
    expect(formatSlot(booked[0]!)).toContain('open');
  });
});
