import { describe, expect, it } from 'vitest'

import { ValidationError } from '../../src/core/lib/errors'
import type { Condition } from '../../src/core/rules/conditions'
import { planAdventuringDay } from '../../src/core/rules/day-plan'

type Member = { id: string; xp: number; state: { active: Condition[]; exhaustion: number } }
type Roster = Member[]
type Slate = Array<{ id: string; monsterXps: number[] }>

function who(id: string, xp = 0, active: Condition[] = [], exhaustion = 0): Member {
  return { id, xp, state: { active, exhaustion: exhaustion as never } } as Member
}

function roster(xp = 0, ids = ['brann', 'sela', 'oskar', 'wren']): Roster {
  return ids.map((id) => who(id, xp))
}

function ran(plan: { entries: Array<{ pickId: string }> }): string[] {
  return plan.entries.map((entry) => entry.pickId)
}

function totals(plan: { party: Array<{ xp: number }> }): number[] {
  return plan.party.map((member) => member.xp)
}

function tiredness(plan: { party: Array<{ state: { exhaustion: number } }> }): number[] {
  return plan.party.map((member) => member.state.exhaustion)
}

// Four characters a dozen experience short of second level, and a gate watch
// that would end them this morning.
const almostSecond = roster(290)
const morningSlate: Slate = [
  { id: 'gate-watch', monsterXps: [200, 200] },
  { id: 'rat-nest', monsterXps: [50] },
  { id: 'sewer-run', monsterXps: [50] },
]

describe('a morning the party is not ready for', () => {
  it('opens the day on the party standing in front of it', () => {
    const plan = planAdventuringDay({ party: almostSecond, slate: morningSlate })
    expect(plan.allowance).toBe(1200)
  })

  it('will not walk into the gate watch on its own', () => {
    const plan = planAdventuringDay({
      party: almostSecond,
      slate: [{ id: 'gate-watch', monsterXps: [200, 200] }],
    })
    expect(plan.entries).toEqual([])
    expect(plan.spent).toBe(0)
    expect(plan.gained).toBe(0)
  })

  it('leaves the roster where it found it on a day with no fights', () => {
    const plan = planAdventuringDay({
      party: almostSecond,
      slate: [{ id: 'gate-watch', monsterXps: [200, 200] }],
    })
    expect(totals(plan)).toEqual([290, 290, 290, 290])
    expect(tiredness(plan)).toEqual([0, 0, 0, 0])
  })

  it('buys the gate watch with a nest of rats first', () => {
    const plan = planAdventuringDay({ party: almostSecond, slate: morningSlate })
    expect(ran(plan)).toEqual(['rat-nest', 'gate-watch', 'sewer-run'])
  })

  it('rates the rats off the party that walked in', () => {
    const plan = planAdventuringDay({ party: almostSecond, slate: morningSlate })
    expect(plan.entries[0]).toEqual({
      pickId: 'rat-nest',
      difficulty: 'trivial',
      rawXp: 50,
      effectiveXp: 50,
    })
  })

  it('rates the gate watch hard once the party is second level', () => {
    const plan = planAdventuringDay({ party: almostSecond, slate: morningSlate })
    expect(plan.entries[1]).toEqual({
      pickId: 'gate-watch',
      difficulty: 'hard',
      rawXp: 400,
      effectiveXp: 600,
    })
  })

  it('charges the day the effective figure and hands over the raw one', () => {
    const plan = planAdventuringDay({ party: almostSecond, slate: morningSlate })
    expect(plan.spent).toBe(700)
    expect(plan.gained).toBe(500)
  })

  it('closes the day with everybody second level', () => {
    const plan = planAdventuringDay({ party: almostSecond, slate: morningSlate })
    expect(plan.party).toEqual([
      { id: 'brann', xp: 415, level: 2, state: { active: [], exhaustion: 1 } },
      { id: 'sela', xp: 415, level: 2, state: { active: [], exhaustion: 1 } },
      { id: 'oskar', xp: 415, level: 2, state: { active: [], exhaustion: 1 } },
      { id: 'wren', xp: 415, level: 2, state: { active: [], exhaustion: 1 } },
    ])
  })

  it('counts one step of tiredness for the one fight that earned it', () => {
    const plan = planAdventuringDay({ party: almostSecond, slate: morningSlate })
    expect(tiredness(plan)).toEqual([1, 1, 1, 1])
  })
})

// One character in four, and only the word on them changes.
const barrow: Slate = [{ id: 'barrow', monsterXps: [250] }]

describe('who is up to a fight', () => {
  it('leaves a poisoned character out of the party', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['poisoned']), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.allowance).toBe(900)
    expect(plan.entries[0]!.difficulty).toBe('hard')
  })

  it('keeps a charmed character in it', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['charmed']), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.allowance).toBe(1200)
    expect(plan.entries[0]!.difficulty).toBe('medium')
  })

  it('keeps an unconscious one in it too', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['unconscious']), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.allowance).toBe(1200)
    expect(plan.entries[0]!.difficulty).toBe('medium')
  })

  it('reads grappled and deafened as no reason to sit out', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['grappled']), who('sela', 0, ['deafened']), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.allowance).toBe(1200)
    expect(plan.entries[0]!.difficulty).toBe('medium')
  })

  it('reads prone and restrained as reason enough', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['prone']), who('sela', 0, ['restrained']), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.allowance).toBe(600)
    expect(plan.entries).toEqual([])
  })

  it('sits out a character three steps tired before the day began', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, [], 3), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.allowance).toBe(900)
    expect(plan.entries[0]!.difficulty).toBe('hard')
  })

  it('keeps one two steps tired', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, [], 2), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.allowance).toBe(1200)
    expect(plan.entries[0]!.difficulty).toBe('medium')
  })

  it('splits the barrow three ways when one is poisoned', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['poisoned']), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(totals(plan)).toEqual([0, 84, 83, 83])
  })

  it('splits it four ways when one is only charmed', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['charmed']), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(totals(plan)).toEqual([63, 63, 62, 62])
  })

  it('does not tire the character who sat out', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['poisoned']), who('sela'), who('oskar'), who('wren')],
      slate: [{ id: 'barrow', monsterXps: [250] }, { id: 'weir', monsterXps: [120] }],
    })
    expect(tiredness(plan)).toEqual([0, 1, 1, 1])
  })

  it('leaves the word that put them out where it was', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['poisoned']), who('sela'), who('oskar'), who('wren')],
      slate: barrow,
    })
    expect(plan.party[0]).toEqual({
      id: 'brann',
      xp: 0,
      level: 1,
      state: { active: ['poisoned'], exhaustion: 0 },
    })
  })

  it('runs a second fight with the smaller party and pays it out the same way', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['poisoned']), who('sela'), who('oskar'), who('wren')],
      slate: [{ id: 'barrow', monsterXps: [250] }, { id: 'weir', monsterXps: [120] }],
    })
    expect(ran(plan)).toEqual(['barrow', 'weir'])
    expect(plan.gained).toBe(370)
    expect(totals(plan)).toEqual([0, 124, 123, 123])
  })
})

describe('head count the tables can feel', () => {
  const pair: Slate = [{ id: 'pair', monsterXps: [60, 60] }]

  it('rates a pair medium for three characters', () => {
    const plan = planAdventuringDay({
      party: roster(0, ['brann', 'sela', 'oskar']),
      slate: pair,
    })
    expect(plan.entries[0]).toEqual({
      pickId: 'pair',
      difficulty: 'medium',
      rawXp: 120,
      effectiveXp: 180,
    })
  })

  it('and deadly for the same three with one of them poisoned', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, ['poisoned']), who('sela'), who('oskar')],
      slate: pair,
    })
    expect(plan.entries).toEqual([])
    expect(plan.gained).toBe(0)
  })

  it('multiplies a pair harder for two than for three', () => {
    const three = planAdventuringDay({
      party: roster(0, ['brann', 'sela', 'oskar']),
      slate: pair,
    })
    const two = planAdventuringDay({ party: roster(0, ['brann', 'sela']), slate: pair })
    expect(three.entries[0]!.effectiveXp).toBe(180)
    expect(two.entries).toEqual([])
  })

  const trio: Slate = [{ id: 'trio', monsterXps: [100, 100, 100] }]
  const seven = ['brann', 'sela', 'oskar', 'wren', 'ilva', 'tarn', 'mira']

  it('knocks the trio down a tier for a crowd of seven', () => {
    const plan = planAdventuringDay({ party: roster(0, seven), slate: trio })
    expect(plan.entries[0]).toEqual({
      pickId: 'trio',
      difficulty: 'medium',
      rawXp: 300,
      effectiveXp: 450,
    })
  })

  it('takes the knock away once two of the seven are down', () => {
    const plan = planAdventuringDay({
      party: [
        who('brann', 0, ['prone']),
        who('sela', 0, ['restrained']),
        ...roster(0, seven.slice(2)),
      ],
      slate: trio,
    })
    expect(plan.entries).toEqual([])
    expect(plan.allowance).toBe(1500)
  })

  it('splits three hundred seven ways and leaves one a point behind', () => {
    const plan = planAdventuringDay({ party: roster(0, seven), slate: trio })
    expect(totals(plan)).toEqual([43, 43, 43, 43, 43, 43, 42])
  })
})

describe('a party that thins out', () => {
  const walk: Slate = [
    { id: 'barrow', monsterXps: [250] },
    { id: 'weir', monsterXps: [150] },
    { id: 'lane', monsterXps: [90] },
  ]
  const staggered: Roster = [who('brann', 0, [], 2), who('sela', 0, [], 1), who('oskar'), who('wren')]

  it('starts with all four and runs everything', () => {
    const plan = planAdventuringDay({ party: staggered, slate: walk })
    expect(plan.allowance).toBe(1200)
    expect(ran(plan)).toEqual(['barrow', 'weir', 'lane'])
  })

  it('rates the barrow medium against four', () => {
    const plan = planAdventuringDay({ party: staggered, slate: walk })
    expect(plan.entries[0]).toEqual({
      pickId: 'barrow',
      difficulty: 'medium',
      rawXp: 250,
      effectiveXp: 250,
    })
  })

  it('rates the weir medium against the three still standing', () => {
    const plan = planAdventuringDay({ party: staggered, slate: walk })
    expect(plan.entries[1]).toEqual({
      pickId: 'weir',
      difficulty: 'medium',
      rawXp: 150,
      effectiveXp: 150,
    })
  })

  it('multiplies the lane up for the two who are left', () => {
    const plan = planAdventuringDay({ party: staggered, slate: walk })
    expect(plan.entries[2]).toEqual({
      pickId: 'lane',
      difficulty: 'medium',
      rawXp: 90,
      effectiveXp: 135,
    })
  })

  it('leaves four different totals behind it', () => {
    const plan = planAdventuringDay({ party: staggered, slate: walk })
    expect(totals(plan)).toEqual([63, 113, 157, 157])
  })

  it('finishes with everybody three steps tired', () => {
    const plan = planAdventuringDay({ party: staggered, slate: walk })
    expect(tiredness(plan)).toEqual([3, 3, 3, 3])
  })

  it('spends five hundred and thirty five of the allowance', () => {
    const plan = planAdventuringDay({ party: staggered, slate: walk })
    expect(plan.spent).toBe(535)
    expect(plan.gained).toBe(490)
  })

  it('takes the easy one first when everybody is already two steps tired', () => {
    const plan = planAdventuringDay({
      party: roster(0).map((member) => who(member.id, 0, [], 2)),
      slate: [walk[0]!, walk[1]!],
    })
    expect(ran(plan)).toEqual(['weir', 'barrow'])
    expect(plan.gained).toBe(400)
  })

  it('plans nothing for a party that has nothing left', () => {
    const plan = planAdventuringDay({
      party: roster(0).map((member) => who(member.id, 0, [], 3)),
      slate: [{ id: 'lane', monsterXps: [90] }],
    })
    expect(plan.entries).toEqual([])
    expect(plan.allowance).toBe(300)
    expect(tiredness(plan)).toEqual([3, 3, 3, 3])
  })
})

// A mixed table: a veteran, a journeyman, and two who joined this spring. Sela
// is one experience short of the level that would move the whole party.
const mixedTable: Roster = [who('ilva', 6500), who('brann', 900), who('sela', 287), who('oskar', 310)]

describe('a leftover that buys a level', () => {
  const bridge = { id: 'bridge-toll', monsterXps: [150, 150, 125] }

  it('reads the table at the level the characters hold between them', () => {
    const plan = planAdventuringDay({ party: mixedTable, slate: [bridge] })
    expect(plan.allowance).toBe(2400)
  })

  it('will not take the bridge toll cold', () => {
    const plan = planAdventuringDay({ party: mixedTable, slate: [bridge] })
    expect(plan.entries).toEqual([])
  })

  it('takes it after forty nine experience of cellar rats', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [49] }, bridge],
    })
    expect(ran(plan)).toEqual(['cellar-rats', 'bridge-toll'])
  })

  it('and will not take it after forty eight', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [48] }, bridge],
    })
    expect(ran(plan)).toEqual(['cellar-rats'])
  })

  it('puts the odd point of the forty nine on the character holding least', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [49] }],
    })
    expect(totals(plan)).toEqual([6512, 912, 300, 322])
  })

  it('leaves sela one short when the forty eighth point is not there', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [48] }],
    })
    expect(totals(plan)).toEqual([6512, 912, 299, 322])
  })

  it('rates the bridge toll medium by the time it is taken', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [49] }, bridge],
    })
    expect(plan.entries[1]).toEqual({
      pickId: 'bridge-toll',
      difficulty: 'medium',
      rawXp: 425,
      effectiveXp: 850,
    })
  })

  it('counts the whole bridge toll against the day', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [49] }, bridge],
    })
    expect(plan.spent).toBe(899)
    expect(plan.gained).toBe(474)
  })

  it('sends the day home four hundred and seventy four richer', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [49] }, bridge],
    })
    expect(plan.party.map((member) => [member.xp, member.level])).toEqual([
      [6618, 5],
      [1018, 3],
      [407, 2],
      [428, 2],
    ])
  })

  it('spends only the rats when the rats are all there is', () => {
    const plan = planAdventuringDay({
      party: mixedTable,
      slate: [{ id: 'cellar-rats', monsterXps: [48] }, bridge],
    })
    expect(plan.spent).toBe(48)
    expect(plan.gained).toBe(48)
    expect(tiredness(plan)).toEqual([0, 0, 0, 0])
  })
})

// Six toll posts on one road, none of them enough to tire anybody, and a
// bridge at the end that the day may or may not have room for.
const posts: Slate = [
  { id: 'post-1', monsterXps: [199] },
  { id: 'post-2', monsterXps: [199] },
  { id: 'post-3', monsterXps: [199] },
  { id: 'post-4', monsterXps: [199] },
  { id: 'post-5', monsterXps: [199] },
  { id: 'post-6', monsterXps: [199] },
]

describe('an allowance that runs out', () => {
  it('takes a seventh fight that lands exactly on the allowance', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [6] }],
    })
    expect(ran(plan)).toEqual(['post-1', 'post-2', 'post-3', 'post-4', 'post-5', 'post-6', 'toll'])
    expect(plan.spent).toBe(1200)
  })

  it('turns the same fight away one experience over', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [7] }],
    })
    expect(ran(plan)).toEqual(['post-1', 'post-2', 'post-3', 'post-4', 'post-5', 'post-6'])
    expect(plan.spent).toBe(1194)
  })

  it('holds the allowance still whichever way the day went', () => {
    const under = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [6] }],
    })
    const over = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [7] }],
    })
    expect(under.allowance).toBe(1200)
    expect(over.allowance).toBe(1200)
  })

  it('lands every character on exactly three hundred', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [6] }],
    })
    expect(totals(plan)).toEqual([300, 300, 300, 300])
    expect(plan.party.map((member) => member.level)).toEqual([2, 2, 2, 2])
    expect(plan.gained).toBe(1200)
  })

  it('leaves everybody one short of it without the toll', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [7] }],
    })
    expect(totals(plan)).toEqual([299, 299, 298, 298])
    expect(plan.party.map((member) => member.level)).toEqual([1, 1, 1, 1])
  })

  it('tires nobody on a road of easy posts', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: posts })
    expect(tiredness(plan)).toEqual([0, 0, 0, 0])
  })

  it('spreads the odd points round the table rather than down it', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: posts.slice(0, 2) })
    expect(totals(plan)).toEqual([100, 100, 99, 99])
  })

  it('rates a toll post easy while it is worth rating', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: posts.slice(0, 1) })
    expect(plan.entries[0]!.difficulty).toBe('easy')
  })

  it('spends six posts and stops there', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: posts })
    expect(plan.spent).toBe(1194)
    expect(plan.gained).toBe(1194)
  })
})

describe('what the tables count', () => {
  it('drops the monsters worth nothing before it counts heads', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'mob', monsterXps: [100, 0, 100] }],
    })
    expect(plan.entries[0]).toEqual({
      pickId: 'mob',
      difficulty: 'hard',
      rawXp: 200,
      effectiveXp: 300,
    })
  })

  it('reads a pair with a hanger on the same as a plain pair', () => {
    const withNothing = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'mob', monsterXps: [100, 0, 100] }],
    })
    const without = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'mob', monsterXps: [100, 100] }],
    })
    expect(withNothing.entries).toEqual(without.entries)
  })

  it('rounds the half up when the odds are multiplied', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'odd', monsterXps: [51, 50] }],
    })
    expect(plan.entries[0]!.effectiveXp).toBe(152)
    expect(plan.entries[0]!.rawXp).toBe(101)
  })

  it('rounds a hundred and ninety nine and a half onto the medium line', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'ledger', monsterXps: [67, 66] }],
    })
    expect(plan.entries[0]).toEqual({
      pickId: 'ledger',
      difficulty: 'medium',
      rawXp: 133,
      effectiveXp: 200,
    })
  })

  it('tires the party on the fight that landed on the line', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'ledger', monsterXps: [67, 66] }],
    })
    expect(tiredness(plan)).toEqual([1, 1, 1, 1])
  })

  it('gives one character the whole table to themselves', () => {
    const plan = planAdventuringDay({
      party: [who('solo')],
      slate: [
        { id: 'stray', monsterXps: [10] },
        { id: 'pack', monsterXps: [10, 10] },
      ],
    })
    expect(plan.allowance).toBe(300)
    expect(plan.entries).toEqual([
      { pickId: 'stray', difficulty: 'trivial', rawXp: 10, effectiveXp: 15 },
      { pickId: 'pack', difficulty: 'easy', rawXp: 20, effectiveXp: 40 },
    ])
    expect(totals(plan)).toEqual([30])
  })
})

describe('a table nobody is the same level on', () => {
  const veteranAndThree: Roster = [who('brann'), who('sela'), who('oskar'), who('ilva', 14000)]

  it('reads three novices and a sixth level as a second level party', () => {
    const plan = planAdventuringDay({ party: veteranAndThree, slate: [] })
    expect(plan.allowance).toBe(2400)
  })

  it('will not send them at a warband the veteran could handle', () => {
    const plan = planAdventuringDay({
      party: veteranAndThree,
      slate: [{ id: 'warband', monsterXps: [450, 450] }],
    })
    expect(plan.entries).toEqual([])
    expect(plan.gained).toBe(0)
    expect(totals(plan)).toEqual([0, 0, 0, 14000])
  })

  it('drops the mean again when the veteran is the one sitting out', () => {
    const plan = planAdventuringDay({
      party: [who('brann'), who('sela'), who('oskar'), who('ilva', 14000, ['frightened'])],
      slate: [],
    })
    expect(plan.allowance).toBe(900)
  })

  it('rates a crossroads off the level three quarters of the table have not reached', () => {
    const plan = planAdventuringDay({
      party: [who('brann'), who('sela', 300), who('oskar', 300), who('wren', 300)],
      slate: [{ id: 'crossroads', monsterXps: [380] }],
    })
    expect(plan.entries[0]).toEqual({
      pickId: 'crossroads',
      difficulty: 'hard',
      rawXp: 380,
      effectiveXp: 380,
    })
    expect(plan.allowance).toBe(1200)
  })

  it('splits the crossroads evenly and leaves the newcomer behind', () => {
    const plan = planAdventuringDay({
      party: [who('brann'), who('sela', 300), who('oskar', 300), who('wren', 300)],
      slate: [{ id: 'crossroads', monsterXps: [380] }],
    })
    expect(plan.party.map((member) => [member.xp, member.level])).toEqual([
      [95, 1],
      [395, 2],
      [395, 2],
      [395, 2],
    ])
  })
})

describe('which day the party takes', () => {
  const twins: Slate = [
    { id: 'heavy', monsterXps: [350] },
    { id: 'twin-a', monsterXps: [250] },
    { id: 'twin-b', monsterXps: [250] },
    { id: 'twin-c', monsterXps: [250] },
  ]

  it('takes the heavy fight and the first two twins', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: twins })
    expect(ran(plan)).toEqual(['heavy', 'twin-a', 'twin-b'])
  })

  it('reaches for whichever twins are earlier on the slate', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [twins[0]!, twins[3]!, twins[2]!, twins[1]!],
    })
    expect(ran(plan)).toEqual(['heavy', 'twin-c', 'twin-b'])
  })

  it('ends the same day whichever twins those were', () => {
    const first = planAdventuringDay({ party: roster(0), slate: twins })
    const second = planAdventuringDay({
      party: roster(0),
      slate: [twins[0]!, twins[3]!, twins[2]!, twins[1]!],
    })
    expect(first.gained).toBe(second.gained)
    expect(first.spent).toBe(850)
    expect(second.spent).toBe(850)
  })

  it('stops after three fights because nobody is left for a fourth', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: twins })
    expect(tiredness(plan)).toEqual([3, 3, 3, 3])
    expect(totals(plan)).toEqual([213, 213, 212, 212])
  })

  it('walks past an empty camp worth nothing', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [
        { id: 'empty-camp', monsterXps: [0, 0] },
        { id: 'toll-bridge', monsterXps: [120] },
      ],
    })
    expect(ran(plan)).toEqual(['toll-bridge'])
    expect(plan.spent).toBe(120)
    expect(plan.gained).toBe(120)
  })

  it('leaves the roster as the toll bridge left it', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [
        { id: 'empty-camp', monsterXps: [0, 0] },
        { id: 'toll-bridge', monsterXps: [120] },
      ],
    })
    expect(totals(plan)).toEqual([30, 30, 30, 30])
    expect(tiredness(plan)).toEqual([0, 0, 0, 0])
  })
})

describe('days that never start', () => {
  it('plans an empty slate as an empty day', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: [] })
    expect(plan.entries).toEqual([])
    expect(plan.spent).toBe(0)
    expect(plan.gained).toBe(0)
    expect(plan.allowance).toBe(1200)
  })

  it('turns down a wyrm nobody can fight', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'wyrm', monsterXps: [900] }],
    })
    expect(plan.entries).toEqual([])
    expect(totals(plan)).toEqual([0, 0, 0, 0])
  })

  it('refuses a day with nobody at the table', () => {
    expect(() => planAdventuringDay({ party: [], slate: [] })).toThrow(ValidationError)
  })

  it('refuses two characters under one id', () => {
    expect(() =>
      planAdventuringDay({ party: [who('brann'), who('brann', 40)], slate: [] }),
    ).toThrow(ValidationError)
  })

  it('refuses two encounters under one id', () => {
    expect(() =>
      planAdventuringDay({
        party: roster(0),
        slate: [
          { id: 'gate-watch', monsterXps: [10] },
          { id: 'gate-watch', monsterXps: [20] },
        ],
      }),
    ).toThrow(ValidationError)
  })

  it('plans a day for a table that has never fought anything', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [{ id: 'stoat', monsterXps: [8] }],
    })
    expect(plan.entries).toEqual([
      { pickId: 'stoat', difficulty: 'trivial', rawXp: 8, effectiveXp: 8 },
    ])
    expect(totals(plan)).toEqual([2, 2, 2, 2])
  })
})

describe('a day with nobody left in it', () => {
  const stoat: Slate = [{ id: 'stoat', monsterXps: [5] }]

  it('takes no fight at all when everybody is spent', () => {
    const plan = planAdventuringDay({
      party: roster(0).map((member) => who(member.id, 0, [], 3)),
      slate: stoat,
    })
    expect(plan.entries).toEqual([])
    expect(plan.gained).toBe(0)
    expect(plan.spent).toBe(0)
  })

  it('still works the allowance out for the party that started', () => {
    const plan = planAdventuringDay({
      party: roster(0).map((member) => who(member.id, 0, [], 3)),
      slate: stoat,
    })
    expect(plan.allowance).toBe(300)
  })

  it('sends the one character still standing on their own', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, [], 3), who('sela', 0, [], 3), who('oskar', 0, [], 3), who('wren')],
      slate: stoat,
    })
    expect(plan.entries).toEqual([
      { pickId: 'stoat', difficulty: 'trivial', rawXp: 5, effectiveXp: 8 },
    ])
    expect(totals(plan)).toEqual([0, 0, 0, 5])
  })

  it('multiplies a lone monster up for the one who is left', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 0, [], 3), who('sela', 0, [], 3), who('oskar', 0, [], 3), who('wren')],
      slate: stoat,
    })
    expect(plan.spent).toBe(8)
    expect(plan.gained).toBe(5)
  })
})

describe('the head count and the level are the same characters', () => {
  const barrowAlone: Slate = [{ id: 'barrow', monsterXps: [250] }]
  const withVeteran: Roster = [who('brann'), who('sela'), who('oskar'), who('ilva', 14000)]
  const veteranOut: Roster = [
    who('brann'),
    who('sela'),
    who('oskar'),
    who('ilva', 14000, ['frightened']),
  ]

  it('rates the barrow easy while the veteran is in', () => {
    const plan = planAdventuringDay({ party: withVeteran, slate: barrowAlone })
    expect(plan.entries[0]).toEqual({
      pickId: 'barrow',
      difficulty: 'easy',
      rawXp: 250,
      effectiveXp: 250,
    })
    expect(plan.allowance).toBe(2400)
  })

  it('and hard once the veteran is frightened out of it', () => {
    const plan = planAdventuringDay({ party: veteranOut, slate: barrowAlone })
    expect(plan.entries[0]).toEqual({
      pickId: 'barrow',
      difficulty: 'hard',
      rawXp: 250,
      effectiveXp: 250,
    })
    expect(plan.allowance).toBe(900)
  })

  it('splits it three ways and leaves the veteran cold', () => {
    const plan = planAdventuringDay({ party: veteranOut, slate: barrowAlone })
    expect(totals(plan)).toEqual([84, 83, 83, 14000])
    expect(tiredness(plan)).toEqual([1, 1, 1, 0])
  })

  it('splits it four ways with the veteran in', () => {
    const plan = planAdventuringDay({ party: withVeteran, slate: barrowAlone })
    expect(totals(plan)).toEqual([63, 63, 62, 14062])
    expect(tiredness(plan)).toEqual([0, 0, 0, 0])
  })
})

describe('a party with one fight left in it', () => {
  const walk: Slate = [
    { id: 'barrow', monsterXps: [250] },
    { id: 'weir', monsterXps: [150] },
    { id: 'lane', monsterXps: [90] },
  ]
  const nearlyDone = roster(0).map((member) => who(member.id, 0, [], 2))

  it('leaves the one fight that ends the day until last', () => {
    const plan = planAdventuringDay({ party: nearlyDone, slate: walk })
    expect(ran(plan)).toEqual(['weir', 'lane', 'barrow'])
  })

  it('takes all three rather than the biggest one', () => {
    const plan = planAdventuringDay({ party: nearlyDone, slate: walk })
    expect(plan.gained).toBe(490)
    expect(plan.spent).toBe(490)
  })

  it('ends with everybody three steps in', () => {
    const plan = planAdventuringDay({ party: nearlyDone, slate: walk })
    expect(totals(plan)).toEqual([123, 123, 122, 122])
    expect(tiredness(plan)).toEqual([3, 3, 3, 3])
  })
})

describe('a hundred and ninety eight against two hundred', () => {
  it('leaves a hundred and ninety eight easy and tires nobody', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [
        { id: 'ledger-lite', monsterXps: [67, 65] },
        { id: 'gully', monsterXps: [150] },
      ],
    })
    expect(plan.entries[0]).toEqual({
      pickId: 'ledger-lite',
      difficulty: 'easy',
      rawXp: 132,
      effectiveXp: 198,
    })
    expect(tiredness(plan)).toEqual([0, 0, 0, 0])
  })

  it('and takes a step out of everybody two experience later', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [
        { id: 'ledger', monsterXps: [67, 66] },
        { id: 'gully', monsterXps: [150] },
      ],
    })
    expect(plan.entries[0]!.effectiveXp).toBe(200)
    expect(tiredness(plan)).toEqual([1, 1, 1, 1])
  })

  it('pays out a point differently on each side of the line', () => {
    const lite = planAdventuringDay({
      party: roster(0),
      slate: [
        { id: 'ledger-lite', monsterXps: [67, 65] },
        { id: 'gully', monsterXps: [150] },
      ],
    })
    const over = planAdventuringDay({
      party: roster(0),
      slate: [
        { id: 'ledger', monsterXps: [67, 66] },
        { id: 'gully', monsterXps: [150] },
      ],
    })
    expect(totals(lite)).toEqual([71, 71, 70, 70])
    expect(totals(over)).toEqual([71, 71, 71, 70])
  })
})

describe('camps with nothing in them', () => {
  const camps: Slate = [
    { id: 'camp-a', monsterXps: [0] },
    { id: 'ford', monsterXps: [350] },
    { id: 'camp-b', monsterXps: [0, 0, 0] },
  ]

  it('walks past both of them', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: camps })
    expect(ran(plan)).toEqual(['ford'])
    expect(plan.spent).toBe(350)
  })

  it('plans an empty day when the camps are all there is', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [camps[0]!, camps[2]!],
    })
    expect(plan.entries).toEqual([])
    expect(plan.gained).toBe(0)
  })

  it('leaves the roster as the ford left it', () => {
    const plan = planAdventuringDay({ party: roster(0), slate: camps })
    expect(totals(plan)).toEqual([88, 88, 87, 87])
    expect(tiredness(plan)).toEqual([1, 1, 1, 1])
  })
})

describe('the last experience the day has room for', () => {
  it('takes a toll of five and stops one short of the allowance', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [5] }],
    })
    expect(ran(plan)).toHaveLength(7)
    expect(plan.spent).toBe(1199)
    expect(plan.gained).toBe(1199)
  })

  it('leaves one character a point short of second level', () => {
    const plan = planAdventuringDay({
      party: roster(0),
      slate: [...posts, { id: 'toll', monsterXps: [5] }],
    })
    expect(totals(plan)).toEqual([300, 300, 300, 299])
    expect(plan.party.map((member) => member.level)).toEqual([2, 2, 2, 1])
  })

  it('tires nobody on any of the three tolls', () => {
    for (const worth of [5, 6, 7]) {
      const plan = planAdventuringDay({
        party: roster(0),
        slate: [...posts, { id: 'toll', monsterXps: [worth] }],
      })
      expect(tiredness(plan)).toEqual([0, 0, 0, 0])
    }
  })
})

describe('a level the table has not all reached', () => {
  const evenSplit: Roster = [who('brann', 300), who('sela', 300), who('oskar', 900), who('wren', 900)]
  const keep: Slate = [{ id: 'keep', monsterXps: [700] }]

  it('holds a table averaging two and a half at the second level row', () => {
    const plan = planAdventuringDay({ party: evenSplit, slate: keep })
    expect(plan.entries[0]).toEqual({
      pickId: 'keep',
      difficulty: 'hard',
      rawXp: 700,
      effectiveXp: 700,
    })
    expect(plan.allowance).toBe(2400)
  })

  it('sends two of them up a level and leaves two where they were', () => {
    const plan = planAdventuringDay({ party: evenSplit, slate: keep })
    expect(plan.party.map((member) => [member.xp, member.level])).toEqual([
      [475, 2],
      [475, 2],
      [1075, 3],
      [1075, 3],
    ])
  })

  it('reads three novices and a fifth level as a second level table', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 299), who('sela', 299), who('oskar', 299), who('ilva', 6500)],
      slate: keep,
    })
    expect(plan.entries[0]!.difficulty).toBe('hard')
    expect(plan.allowance).toBe(2400)
  })

  it('carries the veteran along with the rest of them', () => {
    const plan = planAdventuringDay({
      party: [who('brann', 299), who('sela', 299), who('oskar', 299), who('ilva', 6500)],
      slate: keep,
    })
    expect(totals(plan)).toEqual([474, 474, 474, 6675])
    expect(plan.party.map((member) => member.level)).toEqual([2, 2, 2, 5])
  })
})

describe('a party that thins in the middle of a slate', () => {
  const halfTired: Roster = [
    who('brann', 0, [], 2),
    who('sela', 0, [], 2),
    who('oskar'),
    who('wren'),
  ]
  const twoBarrows: Slate = [
    { id: 'barrow', monsterXps: [250] },
    { id: 'weir', monsterXps: [250] },
  ]

  it('takes the first barrow against four', () => {
    const plan = planAdventuringDay({ party: halfTired, slate: twoBarrows })
    expect(plan.entries[0]).toEqual({
      pickId: 'barrow',
      difficulty: 'medium',
      rawXp: 250,
      effectiveXp: 250,
    })
  })

  it('cannot take the second against the two who are left', () => {
    const plan = planAdventuringDay({ party: halfTired, slate: twoBarrows })
    expect(ran(plan)).toEqual(['barrow'])
    expect(plan.spent).toBe(250)
  })

  it('holds the allowance at the figure four characters bought', () => {
    const plan = planAdventuringDay({ party: halfTired, slate: twoBarrows })
    expect(plan.allowance).toBe(1200)
  })

  it('leaves two of them spent and two a step in', () => {
    const plan = planAdventuringDay({ party: halfTired, slate: twoBarrows })
    expect(tiredness(plan)).toEqual([3, 3, 1, 1])
    expect(totals(plan)).toEqual([63, 63, 62, 62])
  })
})

describe('the small fight goes first', () => {
  const twoLeft = roster(0).map((member) => who(member.id, 0, [], 2))
  const bigAndSmall: Slate = [
    { id: 'big', monsterXps: [350] },
    { id: 'small', monsterXps: [40] },
  ]

  it('walks the trivial one before the hard one', () => {
    const plan = planAdventuringDay({ party: twoLeft, slate: bigAndSmall })
    expect(ran(plan)).toEqual(['small', 'big'])
  })

  it('comes home with both rather than the bigger one alone', () => {
    const plan = planAdventuringDay({ party: twoLeft, slate: bigAndSmall })
    expect(plan.gained).toBe(390)
    expect(plan.spent).toBe(390)
  })

  it('records the trivial one trivial and the hard one hard', () => {
    const plan = planAdventuringDay({ party: twoLeft, slate: bigAndSmall })
    expect(plan.entries.map((entry) => entry.difficulty)).toEqual(['trivial', 'hard'])
  })

  it('ends with everybody spent', () => {
    const plan = planAdventuringDay({ party: twoLeft, slate: bigAndSmall })
    expect(tiredness(plan)).toEqual([3, 3, 3, 3])
    expect(totals(plan)).toEqual([98, 98, 97, 97])
  })
})
