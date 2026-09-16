import { describe, expect, it } from 'vitest'

import {
  DIFFICULTY_ORDER,
  assessEncounter,
  clampLevel,
  classifyDifficulty,
  groupMultiplier,
  partyThresholds,
} from '../../src/core/rules/encounter-difficulty'
import {
  CONDITIONS,
  bumpExhaustion,
  clampExhaustion,
  emptyConditionState,
  hasDisadvantageOnAttacks,
  isIncapacitated,
  withCondition,
  withoutCondition,
} from '../../src/core/rules/conditions'
import {
  DEFAULT_LEVEL_THRESHOLDS,
  awardXp,
  deductXp,
  levelForXp,
  progressFromXp,
  splitXp,
} from '../../src/core/rules/leveling'

// The arithmetic a day of encounters is built on. None of it is new; a day
// that reads these differently is a day nobody can check.

describe('thresholds a party is rated against', () => {
  it('multiplies the single character row by head count', () => {
    expect(partyThresholds({ size: 4, averageLevel: 1 })).toEqual({
      trivial: 48,
      easy: 100,
      medium: 200,
      hard: 300,
      deadly: 400,
    })
  })

  it('halves them for half the table', () => {
    expect(partyThresholds({ size: 2, averageLevel: 1 })).toEqual({
      trivial: 24,
      easy: 50,
      medium: 100,
      hard: 150,
      deadly: 200,
    })
  })

  it('reads the second level row for a second level party', () => {
    expect(partyThresholds({ size: 4, averageLevel: 2 })).toEqual({
      trivial: 100,
      easy: 200,
      medium: 400,
      hard: 600,
      deadly: 800,
    })
  })

  it('drops the fraction on an uneven table rather than rounding it', () => {
    expect(partyThresholds({ size: 4, averageLevel: 2.75 })).toEqual(
      partyThresholds({ size: 4, averageLevel: 2 }),
    )
  })

  it('keeps a table on the level below until every fraction is gone', () => {
    expect(partyThresholds({ size: 4, averageLevel: 2.999 }).medium).toBe(400)
    expect(partyThresholds({ size: 4, averageLevel: 3 }).medium).toBe(600)
  })

  it('holds a level below one at one', () => {
    expect(clampLevel(0)).toBe(1)
    expect(clampLevel(-4)).toBe(1)
  })

  it('holds a level above twenty at twenty', () => {
    expect(clampLevel(31)).toBe(20)
  })

  it('floors a level between two rows', () => {
    expect(clampLevel(4.9)).toBe(4)
  })
})

describe('the group multiplier', () => {
  it('leaves one monster alone for a normal table', () => {
    expect(groupMultiplier(1, 4)).toBe(1)
  })

  it('climbs the ladder as the monsters arrive', () => {
    expect(groupMultiplier(2, 4)).toBe(1.5)
    expect(groupMultiplier(3, 4)).toBe(2)
    expect(groupMultiplier(7, 4)).toBe(2.5)
    expect(groupMultiplier(11, 4)).toBe(3)
    expect(groupMultiplier(15, 4)).toBe(4)
  })

  it('stays on a tier until the next one is reached', () => {
    expect(groupMultiplier(6, 4)).toBe(2)
    expect(groupMultiplier(10, 4)).toBe(2.5)
    expect(groupMultiplier(14, 4)).toBe(3)
  })

  it('bumps a pair of characters one tier up', () => {
    expect(groupMultiplier(1, 2)).toBe(1.5)
    expect(groupMultiplier(3, 2)).toBe(2.5)
  })

  it('bumps a lone adventurer the same way', () => {
    expect(groupMultiplier(2, 1)).toBe(2)
  })

  it('knocks a crowd of six one tier down', () => {
    expect(groupMultiplier(3, 6)).toBe(1.5)
    expect(groupMultiplier(7, 6)).toBe(2)
  })

  it('cannot knock a lone monster below the bottom of the ladder', () => {
    expect(groupMultiplier(1, 6)).toBe(1)
  })

  it('cannot bump a horde above the top of it', () => {
    expect(groupMultiplier(15, 2)).toBe(4)
  })

  it('leaves a table of five and a table of three alone', () => {
    expect(groupMultiplier(4, 5)).toBe(2)
    expect(groupMultiplier(4, 3)).toBe(2)
  })
})

describe('classifying a fight', () => {
  const four = partyThresholds({ size: 4, averageLevel: 1 })

  it('reads a fight on a threshold as that threshold', () => {
    expect(classifyDifficulty(400, four)).toBe('deadly')
    expect(classifyDifficulty(300, four)).toBe('hard')
    expect(classifyDifficulty(200, four)).toBe('medium')
    expect(classifyDifficulty(100, four)).toBe('easy')
  })

  it('reads a fight one under it as the tier below', () => {
    expect(classifyDifficulty(399, four)).toBe('hard')
    expect(classifyDifficulty(299, four)).toBe('medium')
    expect(classifyDifficulty(199, four)).toBe('easy')
    expect(classifyDifficulty(99, four)).toBe('trivial')
  })

  it('calls nothing at all trivial', () => {
    expect(classifyDifficulty(0, four)).toBe('trivial')
  })

  it('lists the tiers from softest to worst', () => {
    expect(DIFFICULTY_ORDER).toEqual(['trivial', 'easy', 'medium', 'hard', 'deadly'])
  })
})

describe('assessing an encounter whole', () => {
  const party = { size: 4, averageLevel: 1 }

  it('answers the raw and the effective figure apart', () => {
    const assessment = assessEncounter({ party, monsterXps: [200, 200] })
    expect(assessment.rawXp).toBe(400)
    expect(assessment.effectiveXp).toBe(600)
    expect(assessment.multiplier).toBe(1.5)
    expect(assessment.difficulty).toBe('deadly')
  })

  it('drops a monster worth nothing before it counts them', () => {
    const assessment = assessEncounter({ party, monsterXps: [100, 0, 100] })
    expect(assessment.monsterCount).toBe(2)
    expect(assessment.multiplier).toBe(1.5)
  })

  it('drops one worth less than nothing as well', () => {
    const assessment = assessEncounter({ party, monsterXps: [100, -50, 100] })
    expect(assessment.rawXp).toBe(200)
    expect(assessment.monsterCount).toBe(2)
  })

  it('rounds a half up', () => {
    expect(assessEncounter({ party, monsterXps: [51, 50] }).effectiveXp).toBe(152)
  })

  it('leaves an empty encounter at nothing', () => {
    const assessment = assessEncounter({ party, monsterXps: [] })
    expect(assessment.rawXp).toBe(0)
    expect(assessment.effectiveXp).toBe(0)
    expect(assessment.monsterCount).toBe(0)
    expect(assessment.difficulty).toBe('trivial')
  })

  it('carries the thresholds it rated against', () => {
    const assessment = assessEncounter({ party, monsterXps: [10] })
    expect(assessment.partyThresholds).toEqual(partyThresholds(party))
  })
})

describe('experience going out', () => {
  it('splits evenly and hands the leftover back', () => {
    expect(splitXp(50, 4)).toEqual({ perCharacter: 12, remainder: 2 })
  })

  it('leaves nothing over when it divides', () => {
    expect(splitXp(400, 4)).toEqual({ perCharacter: 100, remainder: 0 })
  })

  it('gives a lone character the lot', () => {
    expect(splitXp(49, 1)).toEqual({ perCharacter: 49, remainder: 0 })
  })

  it('cannot hand out more than there was', () => {
    const share = splitXp(199, 4)
    expect(share.perCharacter * 4 + share.remainder).toBe(199)
  })

  it('floors a fractional total before it splits it', () => {
    expect(splitXp(50.9, 4)).toEqual({ perCharacter: 12, remainder: 2 })
  })

  it('refuses a table of nobody', () => {
    expect(() => splitXp(50, 0)).toThrow()
  })

  it('adds an award onto a total', () => {
    expect(awardXp(290, 12)).toBe(302)
  })

  it('refuses a negative award', () => {
    expect(() => awardXp(290, -1)).toThrow()
  })

  it('takes an award back off', () => {
    expect(deductXp(302, 12)).toBe(290)
  })
})

describe('levels off a total', () => {
  it('sits at first level below three hundred', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(299)).toBe(1)
  })

  it('turns second on the three hundredth point', () => {
    expect(levelForXp(300)).toBe(2)
  })

  it('walks the whole table up', () => {
    expect(levelForXp(900)).toBe(3)
    expect(levelForXp(2700)).toBe(4)
    expect(levelForXp(6500)).toBe(5)
    expect(levelForXp(14000)).toBe(6)
  })

  it('holds at twentieth however much is put on top', () => {
    expect(levelForXp(355000)).toBe(20)
    expect(levelForXp(1000000)).toBe(20)
  })

  it('holds a negative total at first', () => {
    expect(levelForXp(-40)).toBe(1)
  })

  it('reads the first row as level one at nothing', () => {
    expect(DEFAULT_LEVEL_THRESHOLDS[0]).toEqual({ level: 1, xp: 0 })
  })

  it('reports how far into a level a total sits', () => {
    const progress = progressFromXp(600)
    expect(progress.level).toBe(2)
    expect(progress.xpIntoLevel).toBe(300)
    expect(progress.xpForNextLevel).toBe(900)
  })

  it('reports a finished table as finished', () => {
    expect(progressFromXp(400000).xpForNextLevel).toBe(null)
  })
})

describe('who the rules already have at a disadvantage', () => {
  const clear = emptyConditionState()

  it('has nothing against a character with nothing on them', () => {
    expect(hasDisadvantageOnAttacks(clear)).toBe(false)
  })

  it('names the five words that swing it', () => {
    for (const word of ['blinded', 'frightened', 'poisoned', 'prone', 'restrained'] as const) {
      expect(hasDisadvantageOnAttacks(withCondition(clear, word))).toBe(true)
    }
  })

  it('leaves the other nine alone', () => {
    for (const word of CONDITIONS) {
      if (['blinded', 'frightened', 'poisoned', 'prone', 'restrained'].includes(word)) continue
      expect(hasDisadvantageOnAttacks(withCondition(clear, word))).toBe(false)
    }
  })

  it('is not the same question as being incapacitated', () => {
    expect(isIncapacitated(withCondition(clear, 'unconscious'))).toBe(true)
    expect(hasDisadvantageOnAttacks(withCondition(clear, 'unconscious'))).toBe(false)
    expect(isIncapacitated(withCondition(clear, 'poisoned'))).toBe(false)
  })

  it('turns over at the third step of exhaustion', () => {
    expect(hasDisadvantageOnAttacks({ active: [], exhaustion: 2 })).toBe(false)
    expect(hasDisadvantageOnAttacks({ active: [], exhaustion: 3 })).toBe(true)
  })

  it('drops back once the word is taken off again', () => {
    const poisoned = withCondition(clear, 'poisoned')
    expect(hasDisadvantageOnAttacks(withoutCondition(poisoned, 'poisoned'))).toBe(false)
  })
})

describe('the exhaustion track', () => {
  it('steps up one at a time', () => {
    expect(bumpExhaustion({ active: [], exhaustion: 0 }, 1).exhaustion).toBe(1)
    expect(bumpExhaustion({ active: [], exhaustion: 2 }, 1).exhaustion).toBe(3)
  })

  it('stops at six', () => {
    expect(bumpExhaustion({ active: [], exhaustion: 6 }, 1).exhaustion).toBe(6)
    expect(clampExhaustion(9)).toBe(6)
  })

  it('never runs below nothing', () => {
    expect(bumpExhaustion({ active: [], exhaustion: 1 }, -4).exhaustion).toBe(0)
    expect(clampExhaustion(-2)).toBe(0)
  })

  it('floors a step that is not whole', () => {
    expect(clampExhaustion(2.9)).toBe(2)
  })

  it('keeps the conditions it was handed', () => {
    const state = { active: ['charmed'] as const, exhaustion: 0 }
    expect(bumpExhaustion(state, 1).active).toEqual(['charmed'])
  })

  it('opens a fresh state at nothing', () => {
    expect(emptyConditionState()).toEqual({ active: [], exhaustion: 0 })
  })
})
