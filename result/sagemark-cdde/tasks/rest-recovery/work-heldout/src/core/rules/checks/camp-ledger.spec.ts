import { describe, expect, it } from 'vitest'

import { buildSeededRng, rollExpression, type RandomSource } from '../../dice/roll'
import {
  bumpExhaustion,
  emptyConditionState,
  withCondition,
  type ConditionState,
} from '../conditions'
import { parseHitDicePool } from '../hit-dice'
import { resolveRest } from '../rest'
import { SPELL_LEVELS, spellSlotStateFor, spend, type SpellSlotState } from '../spell-slots'

// Shapes come off the documented call rather than off a name this file went
// looking for, so a build that arranges its own types differently still reads
// the same way here.
type RestPlan = Parameters<typeof resolveRest>[0]
type Rester = RestPlan['party'][number]
type HitDicePool = Rester['hitDice']

// The faces a rest should draw, read from the reader the repository already
// rolls with, so a case says what the engine ought to draw rather than what
// one run happened to produce.
function facesFor(seed: number, sides: ReadonlyArray<number>): number[] {
  const rng = buildSeededRng(seed)
  return sides.map((s) => rollExpression(`1d${s}`, rng).total)
}

function spentIn(pool: HitDicePool): number {
  return pool.reduce((acc, group) => acc + group.spent, 0)
}

function heldIn(pool: HitDicePool, sides: number): { total: number; spent: number } {
  const group = pool.find((g) => g.sides === sides)
  return { total: group?.total ?? 0, spent: group?.spent ?? 0 }
}

function drained(state: SpellSlotState, level: 1 | 2 | 3, times: number): SpellSlotState {
  let next = state
  for (let i = 0; i < times; i += 1) next = spend(next, level)
  return next
}

function slotsLeft(state: SpellSlotState): number {
  return SPELL_LEVELS.reduce((acc, lvl) => acc + state[lvl].remaining, 0)
}

function member(over: Partial<Rester> = {}): Rester {
  return {
    id: 'rowan',
    level: 6,
    hp: 12,
    hpMax: 44,
    conModifier: 2,
    hitDice: parseHitDicePool('6d8'),
    slots: spellSlotStateFor(6),
    conditions: emptyConditionState(),
    fed: true,
    spendDice: 0,
    ...over,
  }
}

function plan(over: Partial<RestPlan> = {}): RestPlan {
  return { kind: 'short', hours: 1, breakMinutes: 0, party: [member()], ...over }
}

function rng(seed = 11): RandomSource {
  return buildSeededRng(seed)
}

describe('a rest that never happened', () => {
  it('leaves a short rest under an hour uncompleted', () => {
    const result = resolveRest(plan({ hours: 0.5, party: [member({ hp: 4, spendDice: 2 })] }), rng())
    expect(result.completed).toBe(false)
    expect(result.party[0]!.hp).toBe(4)
    expect(result.entries[0]!.rolls).toHaveLength(0)
  })

  it('leaves a long rest under eight hours uncompleted', () => {
    const result = resolveRest(plan({ kind: 'long', hours: 7.5, party: [member({ hp: 4 })] }), rng())
    expect(result.completed).toBe(false)
    expect(result.kind).toBe('long')
    expect(result.party[0]!.hp).toBe(4)
  })

  it('still writes one entry per member, all of it unchanged', () => {
    const party = [
      member({ id: 'ash', hp: 5, conditions: bumpExhaustion(emptyConditionState(), 2) }),
      member({ id: 'brann', hp: 9 }),
    ]
    const result = resolveRest(plan({ hours: 0, party }), rng())
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]!.id).toBe('ash')
    expect(result.entries[0]!.hpAfter).toBe(5)
    expect(result.party[0]!.conditions.exhaustion).toBe(2)
    expect(result.entries[1]!.id).toBe('brann')
    expect(result.entries[1]!.hpAfter).toBe(9)
  })

  it('leaves the slots alone when the hours fall short', () => {
    const drainedSlots = drained(spellSlotStateFor(6), 1, 2)
    const party = [member({ slots: drainedSlots })]
    const result = resolveRest(plan({ kind: 'long', hours: 3, party }), rng())
    expect(slotsLeft(result.party[0]!.slots)).toBe(slotsLeft(drainedSlots))
    expect(result.party[0]!.slots[1]!.remaining).toBe(drainedSlots[1]!.remaining)
  })

  it('takes an hour exactly as enough for a short rest', () => {
    const result = resolveRest(plan({ hours: 1, party: [member({ hp: 40 })] }), rng())
    expect(result.completed).toBe(true)
  })

  it('takes eight hours exactly as enough for a long rest', () => {
    const result = resolveRest(plan({ kind: 'long', hours: 8, party: [member({ hp: 3 })] }), rng())
    expect(result.completed).toBe(true)
    expect(result.party[0]!.hp).toBe(44)
  })
})

describe('a night broken into', () => {
  it('keeps a long rest that was interrupted for an hour', () => {
    const result = resolveRest(
      plan({ kind: 'long', hours: 8, breakMinutes: 60, party: [member({ hp: 3 })] }),
      rng(),
    )
    expect(result.kind).toBe('long')
    expect(result.party[0]!.hp).toBe(44)
  })

  it('drops a long rest broken for longer than an hour to a short one', () => {
    const result = resolveRest(
      plan({ kind: 'long', hours: 8, breakMinutes: 61, party: [member({ hp: 3, spendDice: 1 })] }),
      rng(),
    )
    expect(result.kind).toBe('short')
    expect(result.party[0]!.hp).toBeLessThan(44)
    expect(result.entries[0]!.rolls).toHaveLength(1)
  })

  it('settles a night that broke early into a short rest that counts', () => {
    const drainedSlots = drained(spellSlotStateFor(6), 1, 2)
    const party = [member({ hp: 3, spendDice: 1, slots: drainedSlots })]
    const result = resolveRest(plan({ kind: 'long', hours: 7, breakMinutes: 120, party }), rng())
    expect(result.kind).toBe('short')
    expect(result.completed).toBe(true)
    expect(result.entries[0]!.rolls).toHaveLength(1)
    expect(result.party[0]!.hp).toBe(3 + result.entries[0]!.rolls[0]!.healed)
    expect(slotsLeft(result.party[0]!.slots)).toBe(slotsLeft(drainedSlots))
  })

  it('takes an hour as enough for a night that broke early', () => {
    const result = resolveRest(
      plan({ kind: 'long', hours: 1, breakMinutes: 90, party: [member({ hp: 8, spendDice: 1 })] }),
      rng(),
    )
    expect(result.kind).toBe('short')
    expect(result.completed).toBe(true)
    expect(result.entries[0]!.rolls).toHaveLength(1)
  })

  it('leaves a night that broke before the hour was out with nothing', () => {
    const result = resolveRest(
      plan({ kind: 'long', hours: 0.5, breakMinutes: 120, party: [member({ hp: 4, spendDice: 2 })] }),
      rng(),
    )
    expect(result.completed).toBe(false)
    expect(result.party[0]!.hp).toBe(4)
    expect(result.entries[0]!.rolls).toHaveLength(0)
  })

  it('gives a downgraded rest none of its slots back', () => {
    const drainedSlots = drained(spellSlotStateFor(6), 1, 2)
    const party = [member({ hp: 3, slots: drainedSlots })]
    const result = resolveRest(plan({ kind: 'long', hours: 9, breakMinutes: 120, party }), rng())
    expect(slotsLeft(result.party[0]!.slots)).toBe(slotsLeft(drainedSlots))
    expect(result.party[0]!.hp).toBe(3)
  })

  it('leaves a downgraded rest with the exhaustion it started with', () => {
    const party = [member({ fed: true, conditions: bumpExhaustion(emptyConditionState(), 4) })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, breakMinutes: 90, party }), rng())
    expect(result.party[0]!.conditions.exhaustion).toBe(4)
  })

  it('ignores a break on a rest that was short to begin with', () => {
    const result = resolveRest(
      plan({ kind: 'short', hours: 1, breakMinutes: 300, party: [member({ hp: 10, spendDice: 1 })] }),
      rng(),
    )
    expect(result.kind).toBe('short')
    expect(result.completed).toBe(true)
    expect(result.entries[0]!.rolls).toHaveLength(1)
  })
})

describe('hit dice at a short rest', () => {
  it('rolls the largest die first and heals the roll plus the constitution modifier', () => {
    const faces = facesFor(5, [10, 10, 6])
    const party = [
      member({ hp: 1, hpMax: 90, conModifier: 3, hitDice: parseHitDicePool('2d10+2d6'), spendDice: 3 }),
    ]
    const result = resolveRest(plan({ party }), buildSeededRng(5))
    const rolls = result.entries[0]!.rolls
    expect(rolls.map((r) => r.sides)).toEqual([10, 10, 6])
    expect(rolls.map((r) => r.rolled)).toEqual(faces)
    expect(rolls.map((r) => r.healed)).toEqual(faces.map((f) => f + 3))
    expect(result.party[0]!.hp).toBe(1 + faces.reduce((a, b) => a + b + 3, 0))
  })

  it('marks the dice it spent against the sizes it used', () => {
    const party = [
      member({ hp: 1, hpMax: 90, hitDice: parseHitDicePool('2d10+2d6'), spendDice: 3 }),
    ]
    const result = resolveRest(plan({ party }), rng())
    expect(heldIn(result.party[0]!.hitDice, 10)).toEqual({ total: 2, spent: 2 })
    expect(heldIn(result.party[0]!.hitDice, 6)).toEqual({ total: 2, spent: 1 })
  })

  it('never heals less than one from a die', () => {
    const faces = facesFor(3, [6])
    const party = [member({ hp: 10, hpMax: 60, conModifier: -9, hitDice: parseHitDicePool('3d6'), spendDice: 1 })]
    const result = resolveRest(plan({ party }), buildSeededRng(3))
    expect(faces[0]! - 9).toBeLessThanOrEqual(0)
    expect(result.entries[0]!.rolls[0]!.healed).toBe(1)
    expect(result.party[0]!.hp).toBe(11)
  })

  it('stops once hit points are full and leaves the rest of the pool alone', () => {
    const party = [member({ hp: 43, hpMax: 44, conModifier: 2, spendDice: 4 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(1)
    expect(result.party[0]!.hp).toBeGreaterThanOrEqual(44)
    expect(spentIn(result.party[0]!.hitDice)).toBe(1)
  })

  it('spends nothing for somebody already at full health', () => {
    const party = [member({ hp: 44, spendDice: 3 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(0)
    expect(spentIn(result.party[0]!.hitDice)).toBe(0)
  })

  it('spends only what the pool still holds', () => {
    const pool: HitDicePool = [{ sides: 8, total: 3, spent: 2 }]
    const party = [member({ hp: 2, hitDice: pool, spendDice: 3 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(1)
    expect(spentIn(result.party[0]!.hitDice)).toBe(3)
  })

  it('spends nothing when the sheet asked for no dice', () => {
    const party = [member({ hp: 2, spendDice: 0 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(0)
    expect(result.party[0]!.hp).toBe(2)
  })

  it('lets nobody who cannot act spend a die', () => {
    const stunned: ConditionState = withCondition(emptyConditionState(), 'stunned')
    const party = [member({ hp: 2, conditions: stunned, spendDice: 2 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(0)
    expect(result.party[0]!.hp).toBe(2)
  })

  it('keeps somebody worn to a standstill out of the dice as well', () => {
    const party = [member({ hp: 2, conditions: bumpExhaustion(emptyConditionState(), 6), spendDice: 2 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(0)
    expect(spentIn(result.party[0]!.hitDice)).toBe(0)
  })

  it('draws for each member in turn, in the order the party was given', () => {
    const faces = facesFor(21, [8, 6])
    const party = [
      member({ id: 'first', hp: 1, hpMax: 50, conModifier: 0, hitDice: parseHitDicePool('2d8'), spendDice: 1 }),
      member({ id: 'second', hp: 1, hpMax: 50, conModifier: 0, hitDice: parseHitDicePool('2d6'), spendDice: 1 }),
    ]
    const result = resolveRest(plan({ party }), buildSeededRng(21))
    expect(result.entries[0]!.rolls[0]!.rolled).toBe(faces[0])
    expect(result.entries[1]!.rolls[0]!.rolled).toBe(faces[1])
  })

  it('draws nothing for a member who spends nothing, so the next one gets the die', () => {
    const faces = facesFor(33, [8])
    const party = [
      member({ id: 'first', hp: 44, spendDice: 2 }),
      member({ id: 'second', hp: 1, hpMax: 50, conModifier: 0, hitDice: parseHitDicePool('2d8'), spendDice: 1 }),
    ]
    const result = resolveRest(plan({ party }), buildSeededRng(33))
    expect(result.entries[1]!.rolls[0]!.rolled).toBe(faces[0])
  })

  it('leaves ordinary slots where they were', () => {
    const drainedSlots = drained(spellSlotStateFor(6), 2, 1)
    const party = [member({ hp: 4, slots: drainedSlots, spendDice: 1 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.party[0]!.slots[2]!.remaining).toBe(drainedSlots[2]!.remaining)
    expect(slotsLeft(result.party[0]!.slots)).toBe(slotsLeft(drainedSlots))
  })
})

describe('a long rest', () => {
  it('fills hit points whatever they started at', () => {
    const result = resolveRest(
      plan({ kind: 'long', hours: 8, party: [member({ hp: 0, hpMax: 44 })] }),
      rng(),
    )
    expect(result.party[0]!.hp).toBe(44)
    expect(result.entries[0]!.hpAfter).toBe(44)
  })

  it('spends no hit dice and draws nothing, however many the sheet asked for', () => {
    const party = [member({ hp: 2, spendDice: 4 })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(0)
    expect(spentIn(result.party[0]!.hitDice)).toBe(0)
  })

  it('brings every ordinary slot back', () => {
    const drainedSlots = drained(drained(spellSlotStateFor(6), 1, 3), 3, 2)
    const party = [member({ slots: drainedSlots })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(slotsLeft(result.party[0]!.slots)).toBe(slotsLeft(spellSlotStateFor(6)))
    expect(result.party[0]!.slots[1]!.remaining).toBe(result.party[0]!.slots[1]!.max)
    expect(result.party[0]!.slots[3]!.remaining).toBe(result.party[0]!.slots[3]!.max)
  })

  it('hands back half the level in dice, rounded down', () => {
    const pool: HitDicePool = [{ sides: 8, total: 7, spent: 6 }]
    const party = [member({ level: 7, hitDice: pool })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(spentIn(result.party[0]!.hitDice)).toBe(3)
  })

  it('hands back one die at first level', () => {
    const pool: HitDicePool = [{ sides: 6, total: 2, spent: 2 }]
    const party = [member({ level: 1, hitDice: pool })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(spentIn(result.party[0]!.hitDice)).toBe(1)
  })

  it('hands back no more than was spent', () => {
    const pool: HitDicePool = [{ sides: 10, total: 9, spent: 1 }]
    const party = [member({ level: 9, hitDice: pool })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(spentIn(result.party[0]!.hitDice)).toBe(0)
  })

  it('unspends the largest dice first', () => {
    const pool: HitDicePool = [
      { sides: 10, total: 2, spent: 2 },
      { sides: 6, total: 2, spent: 2 },
    ]
    const party = [member({ level: 4, hitDice: pool })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(heldIn(result.party[0]!.hitDice, 10).spent).toBe(0)
    expect(heldIn(result.party[0]!.hitDice, 6).spent).toBe(2)
  })
})

describe('exhaustion and what a rest ends', () => {
  it('walks the track down one for somebody who ate', () => {
    const party = [member({ fed: true, conditions: bumpExhaustion(emptyConditionState(), 3) })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(result.party[0]!.conditions.exhaustion).toBe(2)
  })

  it('leaves the track alone for somebody who did not eat', () => {
    const party = [member({ fed: false, conditions: bumpExhaustion(emptyConditionState(), 3) })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(result.party[0]!.conditions.exhaustion).toBe(3)
  })

  it('leaves the track alone on a short rest, fed or not', () => {
    const party = [member({ fed: true, conditions: bumpExhaustion(emptyConditionState(), 2) })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.party[0]!.conditions.exhaustion).toBe(2)
  })

  it('never walks below rested', () => {
    const party = [member({ fed: true })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(result.party[0]!.conditions.exhaustion).toBe(0)
  })

  it('takes one level a night, no more', () => {
    const party = [member({ fed: true, conditions: bumpExhaustion(emptyConditionState(), 5) })]
    const first = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(first.party[0]!.conditions.exhaustion).toBe(4)
    const second = resolveRest(plan({ kind: 'long', hours: 8, party: first.party }), rng())
    expect(second.party[0]!.conditions.exhaustion).toBe(3)
  })

  it('ends fright and a stunning', () => {
    const rattled = withCondition(withCondition(emptyConditionState(), 'frightened'), 'stunned')
    const party = [member({ conditions: rattled })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.party[0]!.conditions.active).toHaveLength(0)
  })

  it('leaves the conditions a rest cannot touch', () => {
    const cursed = withCondition(withCondition(emptyConditionState(), 'poisoned'), 'petrified')
    const party = [member({ conditions: cursed })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(result.party[0]!.conditions.active).toContain('poisoned')
    expect(result.party[0]!.conditions.active).toContain('petrified')
  })

  it('wakes somebody whose hit points came back', () => {
    const down = withCondition(emptyConditionState(), 'unconscious')
    const party = [member({ hp: 0, conditions: down })]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(result.party[0]!.conditions.active).toHaveLength(0)
  })

  it('leaves somebody who is still on nought hit points where they lay', () => {
    const down = withCondition(emptyConditionState(), 'unconscious')
    const party = [member({ hp: 0, hpMax: 40, conditions: down, spendDice: 2 })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(0)
    expect(result.party[0]!.conditions.active).toContain('unconscious')
  })
})

describe('what the camp answers with', () => {
  it('reads one entry per member in party order', () => {
    const party = [member({ id: 'ash' }), member({ id: 'brann' }), member({ id: 'cait' })]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries.map((e) => e.id)).toEqual(['ash', 'brann', 'cait'])
    expect(result.party.map((m) => m.id)).toEqual(['ash', 'brann', 'cait'])
  })

  it('carries the hit points the member ended on', () => {
    const party = [member({ hp: 6, hpMax: 30, spendDice: 1, conModifier: 1 })]
    const result = resolveRest(plan({ party }), rng())
    const entry = result.entries[0]!
    expect(entry.hpAfter).toBe(6 + entry.rolls[0]!.healed)
    expect(result.party[0]!.hp).toBe(entry.hpAfter)
  })

  it('reads back the kind it was asked for when nothing broke it', () => {
    const short = resolveRest(plan({ party: [member()] }), rng())
    expect(short.kind).toBe('short')
    const long = resolveRest(plan({ kind: 'long', hours: 8, party: [member()] }), rng())
    expect(long.kind).toBe('long')
  })

  it('rests a mixed party in one go', () => {
    const party = [
      member({ id: 'ash', hp: 2, hpMax: 30, spendDice: 1 }),
      member({ id: 'brann', hp: 30, hpMax: 30, spendDice: 2 }),
      member({ id: 'cait', hp: 4, hpMax: 30, conditions: withCondition(emptyConditionState(), 'stunned'), spendDice: 2 }),
    ]
    const result = resolveRest(plan({ party }), rng())
    expect(result.entries[0]!.rolls).toHaveLength(1)
    expect(result.entries[1]!.rolls).toHaveLength(0)
    expect(result.entries[2]!.rolls).toHaveLength(0)
    expect(result.party[2]!.conditions.active).toHaveLength(0)
  })

  it('gives every member of a long rest their own dice back', () => {
    const party = [
      member({ id: 'ash', level: 6, hitDice: [{ sides: 8, total: 6, spent: 6 }] }),
      member({ id: 'brann', level: 2, hitDice: [{ sides: 6, total: 2, spent: 2 }] }),
    ]
    const result = resolveRest(plan({ kind: 'long', hours: 8, party }), rng())
    expect(spentIn(result.party[0]!.hitDice)).toBe(3)
    expect(spentIn(result.party[1]!.hitDice)).toBe(1)
  })

  it('answers with an empty ledger for an empty party', () => {
    const result = resolveRest(plan({ party: [] }), rng())
    expect(result.entries).toHaveLength(0)
    expect(result.completed).toBe(true)
  })
})
