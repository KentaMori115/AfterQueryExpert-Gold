import { describe, expect, it } from 'vitest'

import {
  SPELL_LEVELS,
  emptySpellSlotState,
  longRest,
  maxSlots,
  restore,
  spellSlotStateFor,
  spend,
  totalMax,
  totalRemaining,
  visibleLevels,
} from './spell-slots'

describe('maxSlots', () => {
  it('matches the players handbook for the iconic anchors', () => {
    expect(maxSlots(1, 1)).toBe(2)
    expect(maxSlots(2, 2)).toBe(0)
    expect(maxSlots(3, 1)).toBe(4)
    expect(maxSlots(3, 2)).toBe(2)
    expect(maxSlots(5, 3)).toBe(2)
    expect(maxSlots(11, 6)).toBe(1)
    expect(maxSlots(20, 9)).toBe(1)
  })

  it('clamps levels outside the table', () => {
    expect(maxSlots(0, 1)).toBe(0)
    expect(maxSlots(99, 1)).toBe(4)
  })
})

describe('spellSlotStateFor', () => {
  it('builds a full state with remaining equal to max', () => {
    const s = spellSlotStateFor(5)
    expect(s[1].max).toBe(4)
    expect(s[1].remaining).toBe(4)
    expect(s[3].max).toBe(2)
  })
})

describe('spend and restore', () => {
  it('spend reduces remaining and clamps at zero', () => {
    let s = spellSlotStateFor(1)
    s = spend(s, 1)
    s = spend(s, 1)
    s = spend(s, 1)
    expect(s[1].remaining).toBe(0)
  })

  it('restore adds up to max', () => {
    let s = spellSlotStateFor(1)
    s = spend(s, 1)
    s = restore(s, 1, 5)
    expect(s[1].remaining).toBe(s[1].max)
  })

  it('restore is a no op on a level the caster does not have', () => {
    const s = spellSlotStateFor(1)
    const next = restore(s, 5)
    expect(next).toEqual(s)
  })
})

describe('longRest', () => {
  it('refills every level to its max', () => {
    let s = spellSlotStateFor(5)
    s = spend(s, 1)
    s = spend(s, 2)
    s = longRest(s)
    expect(s[1].remaining).toBe(s[1].max)
    expect(s[2].remaining).toBe(s[2].max)
  })
})

describe('totals and visibleLevels', () => {
  it('totalMax and totalRemaining sum across every visible level', () => {
    const s = spellSlotStateFor(3)
    expect(totalMax(s)).toBeGreaterThan(0)
    expect(totalRemaining(s)).toBe(totalMax(s))
  })

  it('visibleLevels filters to those with at least one slot', () => {
    const s = spellSlotStateFor(3)
    const levels = visibleLevels(s)
    expect(levels).toEqual([1, 2])
  })

  it('an empty state has zero totals', () => {
    expect(totalMax(emptySpellSlotState())).toBe(0)
    expect(totalRemaining(emptySpellSlotState())).toBe(0)
  })
})

describe('SPELL_LEVELS', () => {
  it('covers 1 through 9', () => {
    expect(SPELL_LEVELS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
