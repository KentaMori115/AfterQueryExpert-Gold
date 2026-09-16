import { describe, expect, it } from 'vitest'

import { availableDice, largestAvailable, parseHitDicePool, regainDice } from '../hit-dice'

// The pool type is read off the documented reader, so nothing here pins a name
// the request never gave.
type HitDicePool = ReturnType<typeof parseHitDicePool>

function pool(text: string): HitDicePool {
  return parseHitDicePool(text)
}

function sizes(held: HitDicePool): number[] {
  return held.map((group) => group.sides)
}

function spentIn(held: HitDicePool): number {
  return held.reduce((acc, group) => acc + group.spent, 0)
}

function totalIn(held: HitDicePool): number {
  return held.reduce((acc, group) => acc + group.total, 0)
}

function groupFor(held: HitDicePool, side: number): { total: number; spent: number } {
  const group = held.find((g) => g.sides === side)
  return { total: group?.total ?? 0, spent: group?.spent ?? 0 }
}

describe('reading a pool off the sheet', () => {
  it('reads a single size', () => {
    expect(pool('5d8')).toEqual([{ sides: 8, total: 5, spent: 0 }])
  })

  it('reads a bare die as one of them', () => {
    expect(pool('d12')).toEqual([{ sides: 12, total: 1, spent: 0 }])
  })

  it('orders the sizes largest first', () => {
    expect(sizes(pool('3d6+2d12+1d8'))).toEqual([12, 8, 6])
  })

  it('merges a size that was written twice', () => {
    expect(pool('2d8+3d8')).toEqual([{ sides: 8, total: 5, spent: 0 }])
  })

  it('merges without losing the other sizes', () => {
    const held = pool('1d10+2d6+2d10')
    expect(sizes(held)).toEqual([10, 6])
    expect(groupFor(held, 10)).toEqual({ total: 3, spent: 0 })
    expect(groupFor(held, 6)).toEqual({ total: 2, spent: 0 })
  })

  it('starts every die unspent', () => {
    const held = pool('4d10+2d6')
    expect(spentIn(held)).toBe(0)
    expect(totalIn(held)).toBe(6)
    expect(availableDice(held)).toBe(6)
  })

  it('refuses a flat number in the expression', () => {
    expect(() => pool('4d8+2')).toThrow()
  })

  it('refuses a die that is taken away', () => {
    expect(() => pool('4d8-1d6')).toThrow()
  })

  it('refuses a die carrying advantage', () => {
    expect(() => pool('d8adv')).toThrow()
  })

  it('refuses a die carrying disadvantage', () => {
    expect(() => pool('d8dis')).toThrow()
  })

  it('refuses a keep-highest die', () => {
    expect(() => pool('4d8kh2')).toThrow()
  })

  it('refuses a keep-lowest die', () => {
    expect(() => pool('4d8kl1')).toThrow()
  })

  it('refuses something that is not an expression at all', () => {
    expect(() => pool('a handful')).toThrow()
  })

  it('refuses an empty sheet entry', () => {
    expect(() => pool('')).toThrow()
  })
})

describe('what the pool still holds', () => {
  it('counts what is left across sizes', () => {
    const held: HitDicePool = [
      { sides: 10, total: 4, spent: 3 },
      { sides: 6, total: 2, spent: 0 },
    ]
    expect(availableDice(held)).toBe(3)
  })

  it('counts nothing left once every die is gone', () => {
    const held: HitDicePool = [{ sides: 8, total: 3, spent: 3 }]
    expect(availableDice(held)).toBe(0)
  })

  it('names the largest size with a die left', () => {
    const held: HitDicePool = [
      { sides: 12, total: 2, spent: 2 },
      { sides: 8, total: 2, spent: 1 },
    ]
    expect(largestAvailable(held)).toBe(8)
  })

  it('names the largest size when the pool is untouched', () => {
    expect(largestAvailable(pool('2d6+1d12'))).toBe(12)
  })

  it('names nothing when every die is gone', () => {
    const held: HitDicePool = [{ sides: 8, total: 3, spent: 3 }]
    expect(largestAvailable(held)).toBe(null)
  })

  it('names nothing for a pool with no dice in it', () => {
    expect(largestAvailable([])).toBe(null)
    expect(availableDice([])).toBe(0)
  })
})

describe('handing dice back', () => {
  it('unspends from the largest size first', () => {
    const held: HitDicePool = [
      { sides: 10, total: 3, spent: 3 },
      { sides: 6, total: 3, spent: 3 },
    ]
    const back = regainDice(held, 4)
    expect(groupFor(back, 10).spent).toBe(0)
    expect(groupFor(back, 6).spent).toBe(2)
  })

  it('works down the sizes when the largest is already whole', () => {
    const held: HitDicePool = [
      { sides: 12, total: 2, spent: 0 },
      { sides: 8, total: 4, spent: 4 },
    ]
    const back = regainDice(held, 2)
    expect(groupFor(back, 12).spent).toBe(0)
    expect(groupFor(back, 8).spent).toBe(2)
  })

  it('hands back no more than were spent', () => {
    const held: HitDicePool = [{ sides: 8, total: 5, spent: 2 }]
    const back = regainDice(held, 9)
    expect(spentIn(back)).toBe(0)
    expect(totalIn(back)).toBe(5)
  })

  it('hands back nothing for nothing', () => {
    const held: HitDicePool = [{ sides: 8, total: 5, spent: 2 }]
    expect(regainDice(held, 0)).toEqual(held)
  })

  it('leaves a pool that owes nothing exactly as it was', () => {
    const held = pool('3d8')
    expect(regainDice(held, 3)).toEqual(held)
  })
})
