import { describe, expect, it } from 'vitest'

import { ValidationError } from '../lib/errors'
import { emptyConditionState } from './conditions'
import {
  ableMembers,
  assertParty,
  awardToParty,
  isAble,
  levelUps,
  meanLevel,
  memberLevel,
  partyShape,
  partySize,
  sameRoster,
  standings,
  tireParty,
  totalXp,
} from './party-progress'

function who(id: string, xp = 0, active: string[] = [], exhaustion = 0) {
  return { id, xp, state: { active, exhaustion } } as never as {
    id: string
    xp: number
    state: ReturnType<typeof emptyConditionState>
  }
}

const four = ['brann', 'sela', 'oskar', 'wren'].map((id) => who(id, 290))

describe('assertParty', () => {
  it('accepts a normal roster', () => {
    expect(() => assertParty(four)).not.toThrow()
  })

  it('rejects an empty roster', () => {
    expect(() => assertParty([])).toThrow(ValidationError)
  })

  it('rejects two characters under one id', () => {
    expect(() => assertParty([who('a'), who('a', 10)])).toThrow(ValidationError)
  })

  it('rejects negative experience', () => {
    expect(() => assertParty([who('a', -1)])).toThrow(ValidationError)
  })
})

describe('who is up to a fight', () => {
  it('sets aside the characters the rules already have at a disadvantage', () => {
    const roster = [who('a', 0, ['poisoned']), who('b'), who('c', 0, [], 3)]
    expect(ableMembers(roster).map((m) => m.id)).toEqual(['b'])
  })

  it('leaves a charmed character in the fight', () => {
    expect(isAble(who('a', 0, ['charmed']))).toBe(true)
    expect(isAble(who('a', 0, ['poisoned']))).toBe(false)
  })

  it('takes the head count and the level off them alone', () => {
    const roster = [who('a', 0, ['prone']), who('b', 900), who('c', 900)]
    expect(partyShape(roster)).toEqual({ size: 2, averageLevel: 3 })
  })

  it('answers a level of one for a party with nobody in it', () => {
    expect(meanLevel([])).toBe(1)
  })
})

describe('levels', () => {
  it('reads a level off each total', () => {
    expect(memberLevel(who('a', 299))).toBe(1)
    expect(memberLevel(who('a', 300))).toBe(2)
  })

  it('averages levels and not totals', () => {
    const uneven = [who('a'), who('b'), who('c'), who('d', 6500)]
    expect(meanLevel(uneven)).toBe(2)
  })

  it('hands the tables the mean as it falls', () => {
    const uneven = [who('a'), who('b', 300), who('c', 300), who('d', 300)]
    expect(partyShape(uneven)).toEqual({ size: 4, averageLevel: 1.75 })
  })

  it('counts heads', () => {
    expect(partySize(four)).toBe(4)
  })

  it('attaches a level and a state to every standing', () => {
    expect(standings([who('a', 900)])).toEqual([
      { id: 'a', xp: 900, level: 3, state: { active: [], exhaustion: 0 } },
    ])
  })
})

describe('awardToParty', () => {
  it('splits evenly and pays the leftover to the poorest', () => {
    const award = awardToParty(four, 50)
    expect(award.perCharacter).toBe(12)
    expect(award.remainder).toBe(2)
    expect(award.members.map((m) => m.xp)).toEqual([303, 303, 302, 302])
  })

  it('splits over the characters who were in it', () => {
    const roster = [who('a', 0, ['poisoned']), who('b'), who('c'), who('d')]
    const award = awardToParty(roster, 30)
    expect(award.perCharacter).toBe(10)
    expect(award.members.map((m) => m.xp)).toEqual([0, 10, 10, 10])
  })

  it('hands nothing out when nobody was in it', () => {
    const roster = [who('a', 0, ['poisoned'])]
    expect(awardToParty(roster, 30).members.map((m) => m.xp)).toEqual([0])
  })

  it('leaves the roster in the order it was given', () => {
    expect(awardToParty(four, 400).members.map((m) => m.id)).toEqual([
      'brann',
      'sela',
      'oskar',
      'wren',
    ])
  })

  it('hands the whole amount over when it divides', () => {
    const award = awardToParty(four, 400)
    expect(award.remainder).toBe(0)
    expect(totalXp(award.members) - totalXp(four)).toBe(400)
  })
})

describe('tireParty', () => {
  it('takes a step out of everybody who was in it', () => {
    const tired = tireParty(four)
    expect(tired.map((m) => m.state.exhaustion)).toEqual([1, 1, 1, 1])
  })

  it('leaves the ones who sat it out alone', () => {
    const roster = [who('a', 0, ['restrained']), who('b')]
    expect(tireParty(roster).map((m) => m.state.exhaustion)).toEqual([0, 1])
  })

  it('puts a character two steps in out of the next fight', () => {
    const roster = [who('a', 0, [], 2)]
    const tired = tireParty(roster)
    expect(tired[0]!.state.exhaustion).toBe(3)
    expect(ableMembers(tired)).toEqual([])
  })
})

describe('levelUps', () => {
  it('names only the characters the leftover carried over', () => {
    const shy = ['brann', 'sela', 'oskar', 'wren'].map((id) => who(id, 287))
    const after = awardToParty(shy, 50).members
    expect(after.map((m) => m.xp)).toEqual([300, 300, 299, 299])
    expect(levelUps(shy, after)).toEqual(['brann', 'sela'])
  })

  it('names nobody when nothing moved', () => {
    expect(levelUps(four, four)).toEqual([])
  })
})

describe('sameRoster', () => {
  it('is true for the same totals in the same order', () => {
    expect(sameRoster(four, [...four])).toBe(true)
  })

  it('is false once a total moves', () => {
    expect(sameRoster(four, awardToParty(four, 8).members)).toBe(false)
  })
})
