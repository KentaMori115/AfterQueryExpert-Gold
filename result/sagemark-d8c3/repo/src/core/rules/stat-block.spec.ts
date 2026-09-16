import { describe, expect, it } from 'vitest'

import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  abilityModifier,
  carryingCapacity,
  emptyStatBlock,
  formatModifier,
  heal,
  hpStatus,
  passivePerception,
  proficiencyForLevel,
  setMaxHp,
  statBlockSchema,
  takeDamage,
} from './stat-block'

describe('constants', () => {
  it('lists every ability and labels them', () => {
    expect(ABILITY_KEYS).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha'])
    for (const k of ABILITY_KEYS) expect(ABILITY_LABELS[k].length).toBeGreaterThan(0)
  })
})

describe('emptyStatBlock', () => {
  it('returns a sensible default for a fresh PC', () => {
    const b = emptyStatBlock()
    expect(b.hp).toBe(10)
    expect(b.hpMax).toBe(10)
    expect(b.ac).toBe(10)
    expect(b.speed).toBe(30)
    expect(b.proficiencyBonus).toBe(2)
    expect(b.abilities.str).toBe(10)
  })
})

describe('abilityModifier and formatModifier', () => {
  it('maps scores to modifiers the usual way', () => {
    expect(abilityModifier(10)).toBe(0)
    expect(abilityModifier(11)).toBe(0)
    expect(abilityModifier(12)).toBe(1)
    expect(abilityModifier(20)).toBe(5)
    expect(abilityModifier(8)).toBe(-1)
  })

  it('formats with a sign', () => {
    expect(formatModifier(0)).toBe('+0')
    expect(formatModifier(3)).toBe('+3')
    expect(formatModifier(-2)).toBe('-2')
  })
})

describe('proficiencyForLevel', () => {
  it('matches the dmg progression', () => {
    expect(proficiencyForLevel(1)).toBe(2)
    expect(proficiencyForLevel(4)).toBe(2)
    expect(proficiencyForLevel(5)).toBe(3)
    expect(proficiencyForLevel(9)).toBe(4)
    expect(proficiencyForLevel(13)).toBe(5)
    expect(proficiencyForLevel(17)).toBe(6)
  })
})

describe('passivePerception', () => {
  it('uses wisdom and optional proficiency', () => {
    const b = { ...emptyStatBlock(), abilities: { ...emptyStatBlock().abilities, wis: 14 } }
    expect(passivePerception(b, false)).toBe(12)
    expect(passivePerception(b, true)).toBe(14)
  })
})

describe('carryingCapacity', () => {
  it('is str times fifteen', () => {
    expect(carryingCapacity(emptyStatBlock())).toBe(150)
  })
})

describe('hpStatus and damage helpers', () => {
  it('marks fresh, bloodied, critical and down by ratio', () => {
    const base = { ...emptyStatBlock(), hpMax: 100, hp: 100 }
    expect(hpStatus(base)).toBe('fresh')
    expect(hpStatus({ ...base, hp: 50 })).toBe('bloodied')
    expect(hpStatus({ ...base, hp: 20 })).toBe('critical')
    expect(hpStatus({ ...base, hp: 0 })).toBe('down')
  })

  it('takeDamage floors at zero', () => {
    const base = { ...emptyStatBlock(), hp: 10 }
    expect(takeDamage(base, 5).hp).toBe(5)
    expect(takeDamage(base, 999).hp).toBe(0)
    expect(takeDamage(base, 0)).toBe(base)
  })

  it('heal caps at max', () => {
    const base = { ...emptyStatBlock(), hp: 4, hpMax: 10 }
    expect(heal(base, 3).hp).toBe(7)
    expect(heal(base, 99).hp).toBe(10)
  })

  it('setMaxHp clamps the current pool', () => {
    const base = { ...emptyStatBlock(), hp: 8, hpMax: 12 }
    const next = setMaxHp(base, 6)
    expect(next.hpMax).toBe(6)
    expect(next.hp).toBe(6)
  })
})

describe('statBlockSchema', () => {
  it('rejects scores out of range', () => {
    const r = statBlockSchema.safeParse({
      ...emptyStatBlock(),
      abilities: { ...emptyStatBlock().abilities, str: 99 },
    })
    expect(r.success).toBe(false)
  })

  it('accepts a clean block', () => {
    const r = statBlockSchema.safeParse(emptyStatBlock())
    expect(r.success).toBe(true)
  })
})
