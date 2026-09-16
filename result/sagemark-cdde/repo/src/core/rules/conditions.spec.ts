import { describe, expect, it } from 'vitest'

import {
  CONDITIONS,
  EXHAUSTION_LEVELS,
  bumpExhaustion,
  clampExhaustion,
  conditionDescription,
  conditionLabel,
  emptyConditionState,
  exhaustionLabel,
  exhaustionTone,
  hasDisadvantageOnAttacks,
  isIncapacitated,
  withCondition,
  withoutCondition,
} from './conditions'

describe('constants', () => {
  it('lists every condition with a description', () => {
    expect(CONDITIONS.length).toBeGreaterThanOrEqual(14)
    for (const c of CONDITIONS) {
      expect(conditionDescription(c).length).toBeGreaterThan(0)
      expect(conditionLabel(c)).toMatch(/^[A-Z]/)
    }
  })

  it('exhaustion ladder runs from zero through six', () => {
    expect(EXHAUSTION_LEVELS).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const lvl of EXHAUSTION_LEVELS) {
      expect(exhaustionLabel(lvl).length).toBeGreaterThan(0)
    }
  })
})

describe('exhaustionTone', () => {
  it('escalates from success up to danger', () => {
    expect(exhaustionTone(0)).toBe('success')
    expect(exhaustionTone(2)).toBe('info')
    expect(exhaustionTone(4)).toBe('warning')
    expect(exhaustionTone(6)).toBe('danger')
  })
})

describe('withCondition and withoutCondition', () => {
  it('adds a condition only once', () => {
    let s = emptyConditionState()
    s = withCondition(s, 'poisoned')
    s = withCondition(s, 'poisoned')
    expect(s.active).toEqual(['poisoned'])
  })

  it('removes the named condition', () => {
    let s = emptyConditionState()
    s = withCondition(s, 'poisoned')
    s = withCondition(s, 'prone')
    s = withoutCondition(s, 'poisoned')
    expect(s.active).toEqual(['prone'])
  })

  it('is a no op when removing a missing condition', () => {
    const s = emptyConditionState()
    expect(withoutCondition(s, 'poisoned')).toBe(s)
  })
})

describe('bumpExhaustion and clampExhaustion', () => {
  it('walks the ladder up and down', () => {
    let s = emptyConditionState()
    s = bumpExhaustion(s, 3)
    expect(s.exhaustion).toBe(3)
    s = bumpExhaustion(s, 2)
    expect(s.exhaustion).toBe(5)
    s = bumpExhaustion(s, 99)
    expect(s.exhaustion).toBe(6)
    s = bumpExhaustion(s, -10)
    expect(s.exhaustion).toBe(0)
  })

  it('clamps invalid values', () => {
    expect(clampExhaustion(-1)).toBe(0)
    expect(clampExhaustion(99)).toBe(6)
    expect(clampExhaustion(Number.NaN)).toBe(0)
  })
})

describe('isIncapacitated', () => {
  it('flags exhaustion at 6 and incapacitating conditions', () => {
    expect(isIncapacitated({ active: [], exhaustion: 6 })).toBe(true)
    expect(isIncapacitated({ active: ['stunned'], exhaustion: 0 })).toBe(true)
    expect(isIncapacitated({ active: ['poisoned'], exhaustion: 0 })).toBe(false)
  })
})

describe('hasDisadvantageOnAttacks', () => {
  it('checks the condition list and exhaustion threshold', () => {
    expect(hasDisadvantageOnAttacks({ active: ['poisoned'], exhaustion: 0 })).toBe(true)
    expect(hasDisadvantageOnAttacks({ active: [], exhaustion: 3 })).toBe(true)
    expect(hasDisadvantageOnAttacks({ active: ['charmed'], exhaustion: 1 })).toBe(false)
  })
})
