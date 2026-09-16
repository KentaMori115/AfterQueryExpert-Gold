import { describe, expect, it } from 'vitest'

import { ValidationError } from '../lib/errors'
import {
  MAX_SLATE_PICKS,
  assertSlate,
  isRunnable,
  pickById,
  rateSlate,
  ratePick,
  runnablePicks,
  nobodyUpToIt,
  slateIds,
  slateOrder,
  tiring,
} from './day-slate'

function who(id: string, xp = 0, active: string[] = [], exhaustion = 0) {
  return { id, xp, state: { active, exhaustion } } as never as {
    id: string
    xp: number
    state: { active: never[]; exhaustion: never }
  }
}

const party = ['brann', 'sela', 'oskar', 'wren'].map((id) => who(id))

const slate = [
  { id: 'gate-watch', monsterXps: [200, 200] },
  { id: 'rat-nest', monsterXps: [50] },
  { id: 'sewer-run', monsterXps: [25, 25] },
]

describe('assertSlate', () => {
  it('accepts a prepared slate', () => {
    expect(() => assertSlate(slate)).not.toThrow()
  })

  it('rejects two encounters under one id', () => {
    expect(() =>
      assertSlate([
        { id: 'a', monsterXps: [10] },
        { id: 'a', monsterXps: [20] },
      ]),
    ).toThrow(ValidationError)
  })

  it('rejects a monster with no finite value', () => {
    expect(() => assertSlate([{ id: 'a', monsterXps: [Number.NaN] }])).toThrow(ValidationError)
  })

  it('rejects a slate longer than the day carries', () => {
    const long = Array.from({ length: MAX_SLATE_PICKS + 1 }, (_, i) => ({
      id: `p${i}`,
      monsterXps: [10],
    }))
    expect(() => assertSlate(long)).toThrow(ValidationError)
  })
})

describe('ratePick', () => {
  it('reads the fight three ways at once', () => {
    expect(ratePick(slate[0]!, party)).toEqual({
      pickId: 'gate-watch',
      rawXp: 400,
      effectiveXp: 600,
      multiplier: 1.5,
      monsterCount: 2,
      difficulty: 'deadly',
    })
  })

  it('drops monsters worth nothing before it counts them', () => {
    const rating = ratePick({ id: 'mob', monsterXps: [100, 0, 100] }, party)
    expect(rating.monsterCount).toBe(2)
    expect(rating.multiplier).toBe(1.5)
    expect(rating.effectiveXp).toBe(300)
  })

  it('moves with the party rather than with the slate', () => {
    const later = party.map((member) => who(member.id, 900))
    expect(ratePick(slate[0]!, party).difficulty).toBe('deadly')
    expect(ratePick(slate[0]!, later).difficulty).toBe('medium')
  })
})

describe('rateSlate', () => {
  it('rates every pick in slate order', () => {
    expect(rateSlate(slate, party).map((r) => r.pickId)).toEqual([
      'gate-watch',
      'rat-nest',
      'sewer-run',
    ])
  })
})

describe('runnable', () => {
  it('turns down a deadly fight and nothing else', () => {
    expect(isRunnable(ratePick(slate[0]!, party))).toBe(false)
    expect(isRunnable(ratePick(slate[1]!, party))).toBe(true)
  })

  it('lists what the party would take today', () => {
    expect(runnablePicks(slate, party).map((p) => p.id)).toEqual(['rat-nest', 'sewer-run'])
  })
})

describe('a day that has worn on', () => {
  it('counts a fight as tiring from medium up', () => {
    expect(tiring('easy')).toBe(false)
    expect(tiring('medium')).toBe(true)
    expect(tiring('deadly')).toBe(true)
  })

  it('knows when there is nobody left to send', () => {
    expect(nobodyUpToIt(party)).toBe(false)
    expect(nobodyUpToIt([who('brann', 0, ['poisoned'])])).toBe(true)
    expect(nobodyUpToIt([who('brann', 0, [], 3)])).toBe(true)
  })

  it('rates a fight against the characters still standing', () => {
    const thinned = [who('brann', 0, ['poisoned']), who('sela'), who('oskar')]
    expect(ratePick({ id: 'pair', monsterXps: [60, 60] }, thinned).effectiveXp).toBe(240)
  })
})

describe('slate lookups', () => {
  it('finds a pick by id', () => {
    expect(pickById(slate, 'rat-nest')?.monsterXps).toEqual([50])
  })

  it('answers null for an id nobody prepared', () => {
    expect(pickById(slate, 'dragon')).toBe(null)
  })

  it('remembers where each pick sits', () => {
    expect(slateOrder(slate).get('sewer-run')).toBe(2)
  })

  it('lists ids in the order they arrived', () => {
    expect(slateIds(slate)).toEqual(['gate-watch', 'rat-nest', 'sewer-run'])
  })
})
