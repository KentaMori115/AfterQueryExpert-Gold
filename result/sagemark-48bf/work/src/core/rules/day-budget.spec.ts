import { describe, expect, it } from 'vitest'

import {
  ALLOWANCE_THRESHOLD,
  MEDIUM_ENCOUNTERS_PER_DAY,
  affords,
  budgetFraction,
  budgetTone,
  charge,
  dayAllowance,
  isSpent,
  openBudget,
  remaining,
} from './day-budget'

function who(id: string, xp = 0, active: string[] = [], exhaustion = 0) {
  return { id, xp, state: { active, exhaustion } } as never as {
    id: string
    xp: number
    state: { active: never[]; exhaustion: never }
  }
}

const four = ['brann', 'sela', 'oskar', 'wren'].map((id) => who(id))

describe('dayAllowance', () => {
  it('is six medium encounters for the party in front of it', () => {
    expect(MEDIUM_ENCOUNTERS_PER_DAY).toBe(6)
    expect(ALLOWANCE_THRESHOLD).toBe('medium')
    expect(dayAllowance(four)).toBe(1200)
  })

  it('scales with head count', () => {
    expect(dayAllowance(four.slice(0, 2))).toBe(600)
  })

  it('counts only the characters up to a fight', () => {
    const thinned = [who('a', 0, ['poisoned']), who('b'), who('c'), who('d')]
    expect(dayAllowance(thinned)).toBe(900)
  })

  it('moves with the level the party holds', () => {
    const veterans = four.map((member) => who(member.id, 6500))
    expect(dayAllowance(veterans)).toBe(12000)
  })

  it('reads a mean level the way the tables do', () => {
    const uneven = [who('a'), who('b', 300), who('c', 300), who('d', 300)]
    expect(dayAllowance(uneven)).toBe(1200)
  })
})

describe('spending', () => {
  it('opens with nothing spent', () => {
    expect(openBudget(four)).toEqual({ allowance: 1200, spent: 0 })
  })

  it('takes a fight that lands exactly on the allowance', () => {
    expect(affords(openBudget(four), 1200)).toBe(true)
    expect(affords(openBudget(four), 1201)).toBe(false)
  })

  it('refuses the fight after the allowance is gone', () => {
    const spent = charge(openBudget(four), 1200)
    expect(affords(spent, 1)).toBe(false)
    expect(isSpent(spent)).toBe(true)
  })

  it('keeps the allowance still while the spend climbs', () => {
    const twice = charge(charge(openBudget(four), 200), 300)
    expect(twice).toEqual({ allowance: 1200, spent: 500 })
    expect(remaining(twice)).toBe(700)
  })
})

describe('reading the day', () => {
  it('reports how much of the day has gone', () => {
    expect(budgetFraction(charge(openBudget(four), 600))).toBe(0.5)
  })

  it('never reports more than a whole day', () => {
    expect(budgetFraction(charge(openBudget(four), 5000))).toBe(1)
  })

  it('warns as the day fills and reddens once it is gone', () => {
    expect(budgetTone(openBudget(four))).toBe('success')
    expect(budgetTone(charge(openBudget(four), 600))).toBe('info')
    expect(budgetTone(charge(openBudget(four), 900))).toBe('warning')
    expect(budgetTone(charge(openBudget(four), 1200))).toBe('danger')
  })
})
