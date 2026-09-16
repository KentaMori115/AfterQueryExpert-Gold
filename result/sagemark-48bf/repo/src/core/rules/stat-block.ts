import { z } from 'zod'

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'

export const ABILITY_KEYS: ReadonlyArray<AbilityKey> = ['str', 'dex', 'con', 'int', 'wis', 'cha']

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

export interface AbilityScores {
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

export interface StatBlock {
  hp: number
  hpMax: number
  ac: number
  speed: number
  abilities: AbilityScores
  proficiencyBonus: number
  hitDice: string
}

const abilitySchema = z.number().int().min(1).max(30)

export const statBlockSchema = z.object({
  hp: z.number().int().min(0),
  hpMax: z.number().int().min(0),
  ac: z.number().int().min(0).max(40),
  speed: z.number().int().min(0).max(200),
  abilities: z.object({
    str: abilitySchema,
    dex: abilitySchema,
    con: abilitySchema,
    int: abilitySchema,
    wis: abilitySchema,
    cha: abilitySchema,
  }),
  proficiencyBonus: z.number().int().min(0).max(10),
  hitDice: z.string().max(40),
})

export function emptyStatBlock(): StatBlock {
  return {
    hp: 10,
    hpMax: 10,
    ac: 10,
    speed: 30,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    hitDice: '1d8',
  }
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function formatModifier(mod: number): string {
  if (mod >= 0) return `+${mod}`
  return String(mod)
}

export function proficiencyForLevel(level: number): number {
  if (level <= 0) return 2
  if (level >= 17) return 6
  if (level >= 13) return 5
  if (level >= 9) return 4
  if (level >= 5) return 3
  return 2
}

export function passivePerception(stats: StatBlock, perceptionProficient: boolean): number {
  const base = 10 + abilityModifier(stats.abilities.wis)
  return perceptionProficient ? base + stats.proficiencyBonus : base
}

export function carryingCapacity(stats: StatBlock): number {
  return stats.abilities.str * 15
}

export function hpStatus(stats: StatBlock): 'fresh' | 'bloodied' | 'critical' | 'down' {
  if (stats.hpMax <= 0) return 'fresh'
  const ratio = stats.hp / stats.hpMax
  if (stats.hp <= 0) return 'down'
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'bloodied'
  return 'fresh'
}

export function takeDamage(stats: StatBlock, amount: number): StatBlock {
  if (amount <= 0) return stats
  return { ...stats, hp: Math.max(0, stats.hp - Math.floor(amount)) }
}

export function heal(stats: StatBlock, amount: number): StatBlock {
  if (amount <= 0) return stats
  return { ...stats, hp: Math.min(stats.hpMax, stats.hp + Math.floor(amount)) }
}

export function setMaxHp(stats: StatBlock, max: number): StatBlock {
  if (max < 0) max = 0
  return { ...stats, hpMax: max, hp: Math.min(stats.hp, max) }
}
