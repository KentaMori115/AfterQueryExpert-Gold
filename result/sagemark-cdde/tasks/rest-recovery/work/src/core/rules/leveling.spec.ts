import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LEVEL_THRESHOLDS,
  LevelingError,
  awardXp,
  deductXp,
  levelForXp,
  maxLevel,
  progressFromXp,
  splitXp,
  xpToReach,
} from './leveling'

describe('levelForXp', () => {
  it('returns 1 for negative xp', () => {
    expect(levelForXp(-50)).toBe(1)
  })

  it('returns 1 below the first threshold above zero', () => {
    expect(levelForXp(100)).toBe(1)
  })

  it.each([
    [0, 1],
    [299, 1],
    [300, 2],
    [900, 3],
    [2700, 4],
    [6500, 5],
    [355000, 20],
    [1_000_000, 20],
  ] as const)('xp %d gives level %d', (xp, expected) => {
    expect(levelForXp(xp)).toBe(expected)
  })

  it('uses a custom threshold table when provided', () => {
    const table = [
      { level: 1, xp: 0 },
      { level: 2, xp: 5 },
      { level: 3, xp: 10 },
    ]
    expect(levelForXp(6, table)).toBe(2)
    expect(levelForXp(10, table)).toBe(3)
  })
})

describe('progressFromXp', () => {
  it('reports 0 progress at the bottom of a level', () => {
    const p = progressFromXp(900)
    expect(p.level).toBe(3)
    expect(p.xpIntoLevel).toBe(0)
    expect(p.pct).toBe(0)
  })

  it('reports completion at the cap', () => {
    const p = progressFromXp(400000)
    expect(p.level).toBe(20)
    expect(p.xpForNextLevel).toBeNull()
    expect(p.pct).toBe(1)
  })

  it('clamps pct to 1 if xp goes beyond the next threshold', () => {
    const p = progressFromXp(2700 + 1)
    expect(p.level).toBe(4)
  })

  it('reports half progress in a level', () => {
    const p = progressFromXp(900 + (2700 - 900) / 2)
    expect(p.pct).toBeCloseTo(0.5, 3)
  })
})

describe('awardXp and deductXp', () => {
  it('awardXp adds and rounds', () => {
    expect(awardXp(100, 50.4)).toBe(150)
    expect(awardXp(100, 50.6)).toBe(151)
  })

  it('awardXp rejects negative amounts', () => {
    expect(() => awardXp(100, -10)).toThrow(LevelingError)
  })

  it('deductXp subtracts, clamping at zero', () => {
    expect(deductXp(100, 30)).toBe(70)
    expect(deductXp(50, 200)).toBe(0)
  })

  it('deductXp rejects negative amounts', () => {
    expect(() => deductXp(100, -10)).toThrow(LevelingError)
  })
})

describe('maxLevel and xpToReach', () => {
  it('reports max level of the default table', () => {
    expect(maxLevel()).toBe(20)
  })

  it('xpToReach returns null for unknown levels', () => {
    expect(xpToReach(99)).toBeNull()
  })

  it('xpToReach returns the threshold for known levels', () => {
    expect(xpToReach(5)).toBe(6500)
  })
})

describe('splitXp', () => {
  it('splits evenly when divisible', () => {
    expect(splitXp(1000, 4)).toEqual({ perCharacter: 250, remainder: 0 })
  })

  it('reports the remainder when uneven', () => {
    expect(splitXp(1001, 4)).toEqual({ perCharacter: 250, remainder: 1 })
  })

  it('rejects a non positive party size', () => {
    expect(() => splitXp(100, 0)).toThrow(LevelingError)
    expect(() => splitXp(100, -1)).toThrow(LevelingError)
  })

  it('clamps a negative total to zero', () => {
    expect(splitXp(-50, 2)).toEqual({ perCharacter: 0, remainder: 0 })
  })
})

describe('DEFAULT_LEVEL_THRESHOLDS', () => {
  it('is strictly increasing', () => {
    for (let i = 1; i < DEFAULT_LEVEL_THRESHOLDS.length; i++) {
      expect(DEFAULT_LEVEL_THRESHOLDS[i]!.xp).toBeGreaterThan(DEFAULT_LEVEL_THRESHOLDS[i - 1]!.xp)
      expect(DEFAULT_LEVEL_THRESHOLDS[i]!.level).toBeGreaterThan(DEFAULT_LEVEL_THRESHOLDS[i - 1]!.level)
    }
  })
})
