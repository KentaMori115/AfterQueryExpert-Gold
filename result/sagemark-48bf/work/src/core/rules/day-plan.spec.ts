import { describe, expect, it } from 'vitest'

import { ValidationError } from '../lib/errors'
import {
  hardestOf,
  planAdventuringDay,
  plannedIds,
  unplanned,
  unspent,
} from './day-plan'

function who(id: string, xp = 0, active: string[] = [], exhaustion = 0) {
  return { id, xp, state: { active, exhaustion } } as never as {
    id: string
    xp: number
    state: { active: never[]; exhaustion: never }
  }
}

const party = ['brann', 'sela', 'oskar', 'wren'].map((id) => who(id, 290))

const slate = [
  { id: 'gate-watch', monsterXps: [200, 200] },
  { id: 'rat-nest', monsterXps: [50] },
  { id: 'sewer-run', monsterXps: [50] },
]

describe('planAdventuringDay', () => {
  it('opens the day on the party as it stands', () => {
    const plan = planAdventuringDay({ party, slate })
    expect(plan.allowance).toBe(1200)
  })

  it('buys a fight the morning could not take', () => {
    const plan = planAdventuringDay({ party, slate })
    expect(plannedIds(plan)).toEqual(['rat-nest', 'gate-watch', 'sewer-run'])
    expect(plan.entries[1]).toEqual({
      pickId: 'gate-watch',
      difficulty: 'hard',
      rawXp: 400,
      effectiveXp: 600,
    })
  })

  it('tires the party on the one fight that earned it', () => {
    const plan = planAdventuringDay({ party, slate })
    expect(plan.party.map((member) => member.state.exhaustion)).toEqual([1, 1, 1, 1])
  })

  it('leaves a poisoned character out of the split', () => {
    const thinned = [who('brann', 290, ['poisoned']), who('sela', 290), who('oskar', 290), who('wren', 290)]
    const plan = planAdventuringDay({ party: thinned, slate: [{ id: 'rat-nest', monsterXps: [50] }] })
    expect(plan.party.map((member) => member.xp)).toEqual([290, 307, 307, 306])
  })

  it('leaves the party where the day left it', () => {
    const plan = planAdventuringDay({ party, slate })
    expect(plan.gained).toBe(500)
    expect(plan.party.map((member) => [member.id, member.xp, member.level])).toEqual([
      ['brann', 415, 2],
      ['sela', 415, 2],
      ['oskar', 415, 2],
      ['wren', 415, 2],
    ])
  })

  it('runs nothing when nothing can be run', () => {
    const green = party.map((member) => who(member.id, 0))
    const plan = planAdventuringDay({ party: green, slate: [slate[0]!] })
    expect(plan.entries).toEqual([])
    expect(plan.spent).toBe(0)
    expect(plan.gained).toBe(0)
    expect(plan.party.map((member) => member.level)).toEqual([1, 1, 1, 1])
  })

  it('rejects a roster and a slate it cannot read', () => {
    expect(() => planAdventuringDay({ party: [], slate })).toThrow(ValidationError)
    expect(() =>
      planAdventuringDay({
        party,
        slate: [
          { id: 'a', monsterXps: [10] },
          { id: 'a', monsterXps: [10] },
        ],
      }),
    ).toThrow(ValidationError)
  })
})

describe('reading a plan', () => {
  it('says what stayed on the table', () => {
    const green = party.map((member) => who(member.id, 0))
    const plan = planAdventuringDay({ party: green, slate })
    expect(unplanned({ party: green, slate }, plan)).toEqual(['gate-watch'])
  })

  it('says what is left of the allowance', () => {
    const plan = planAdventuringDay({ party, slate })
    expect(plan.spent).toBe(700)
    expect(unspent(plan)).toBe(500)
  })

  it('names the hardest thing the party walked into', () => {
    const plan = planAdventuringDay({ party, slate })
    expect(hardestOf(plan)).toBe('hard')
  })

  it('names nothing for a day that never started', () => {
    const plan = planAdventuringDay({ party, slate: [] })
    expect(hardestOf(plan)).toBe(null)
  })
})
