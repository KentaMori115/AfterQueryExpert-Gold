import { describe, expect, it } from 'vitest'

import {
  DIFFICULTY_ORDER,
  assessEncounter,
  classifyDifficulty,
  clampLevel,
  difficultyTone,
  groupMultiplier,
  partyThresholds,
} from './encounter-difficulty'

describe('DIFFICULTY_ORDER', () => {
  it('runs from trivial to deadly', () => {
    expect(DIFFICULTY_ORDER).toEqual(['trivial', 'easy', 'medium', 'hard', 'deadly'])
  })
})

describe('clampLevel', () => {
  it('floors and clamps into 1..20', () => {
    expect(clampLevel(0)).toBe(1)
    expect(clampLevel(25)).toBe(20)
    expect(clampLevel(3.7)).toBe(3)
    expect(clampLevel(Number.NaN)).toBe(1)
  })
})

describe('partyThresholds', () => {
  it('scales with party size', () => {
    const four = partyThresholds({ size: 4, averageLevel: 1 })
    expect(four.easy).toBe(100)
    expect(four.medium).toBe(200)
    expect(four.hard).toBe(300)
    expect(four.deadly).toBe(400)
  })

  it('uses the right row for the level', () => {
    const t = partyThresholds({ size: 1, averageLevel: 5 })
    expect(t.deadly).toBe(1100)
  })
})

describe('groupMultiplier', () => {
  it('returns the dmg multipliers by monster count', () => {
    expect(groupMultiplier(1, 4)).toBe(1)
    expect(groupMultiplier(2, 4)).toBe(1.5)
    expect(groupMultiplier(3, 4)).toBe(2)
    expect(groupMultiplier(7, 4)).toBe(2.5)
    expect(groupMultiplier(11, 4)).toBe(3)
    expect(groupMultiplier(15, 4)).toBe(4)
  })

  it('bumps the multiplier up one step for small parties', () => {
    expect(groupMultiplier(1, 2)).toBe(1)
    expect(groupMultiplier(3, 2)).toBe(2)
  })

  it('knocks the multiplier down one step for large parties', () => {
    expect(groupMultiplier(2, 6)).toBe(1.5)
    expect(groupMultiplier(3, 7)).toBe(1.5)
  })
})

describe('classifyDifficulty', () => {
  const thresholds = { trivial: 0, easy: 100, medium: 200, hard: 300, deadly: 400 }

  it('matches the right bucket', () => {
    expect(classifyDifficulty(50, thresholds)).toBe('trivial')
    expect(classifyDifficulty(150, thresholds)).toBe('easy')
    expect(classifyDifficulty(250, thresholds)).toBe('medium')
    expect(classifyDifficulty(350, thresholds)).toBe('hard')
    expect(classifyDifficulty(450, thresholds)).toBe('deadly')
  })
})

describe('assessEncounter', () => {
  it('sums raw xp and applies the multiplier', () => {
    const r = assessEncounter({
      party: { size: 4, averageLevel: 5 },
      monsterXps: [450, 450],
    })
    expect(r.rawXp).toBe(900)
    expect(r.multiplier).toBe(1.5)
    expect(r.effectiveXp).toBe(1350)
    expect(r.monsterCount).toBe(2)
    expect(r.difficulty).toBe('easy')
  })

  it('classifies a single boss as deadly when the xp is high enough', () => {
    const r = assessEncounter({
      party: { size: 4, averageLevel: 3 },
      monsterXps: [3000],
    })
    expect(r.difficulty).toBe('deadly')
  })

  it('ignores zero or negative monster entries', () => {
    const r = assessEncounter({
      party: { size: 4, averageLevel: 5 },
      monsterXps: [450, 0, -10, 450],
    })
    expect(r.monsterCount).toBe(2)
  })

  it('returns a trivial difficulty when the party rolls in deep', () => {
    const r = assessEncounter({
      party: { size: 6, averageLevel: 10 },
      monsterXps: [25],
    })
    expect(r.difficulty).toBe('trivial')
  })
})

describe('difficultyTone', () => {
  it('paints each difficulty a sensible colour', () => {
    expect(difficultyTone('trivial')).toBe('neutral')
    expect(difficultyTone('easy')).toBe('success')
    expect(difficultyTone('medium')).toBe('info')
    expect(difficultyTone('hard')).toBe('warning')
    expect(difficultyTone('deadly')).toBe('danger')
  })
})
