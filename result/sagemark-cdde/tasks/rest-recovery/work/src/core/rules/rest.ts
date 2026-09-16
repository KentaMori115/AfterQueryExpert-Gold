// Resting. A camp turns a hit dice pool, a slot state and an exhaustion track
// into what the party wakes up with, and writes a ledger of what each rest
// actually did.

import type { RandomSource } from '../dice/roll'
import {
  RESTS_OFF,
  type ConditionState,
  easeExhaustion,
  isIncapacitated,
  withoutConditions,
} from './conditions'
import {
  type HitDicePool,
  type HitDieRoll,
  availableDice,
  largestAvailable,
  regainDice,
  rollHitDie,
  spendDie,
  spentDice,
} from './hit-dice'
import { type SpellSlotState, longRest as refillSlots } from './spell-slots'

export type RestKind = 'short' | 'long'

export const SHORT_REST_HOURS = 1
export const LONG_REST_HOURS = 8
export const LONG_REST_BREAK_MINUTES = 60

export interface Rester {
  id: string
  level: number
  hp: number
  hpMax: number
  conModifier: number
  hitDice: HitDicePool
  slots: SpellSlotState
  conditions: ConditionState
  fed: boolean
  spendDice: number
}

export interface RestPlan {
  kind: RestKind
  hours: number
  breakMinutes: number
  party: ReadonlyArray<Rester>
}

export interface RestEntry {
  id: string
  hpAfter: number
  rolls: ReadonlyArray<HitDieRoll>
}

export interface RestResult {
  kind: RestKind
  completed: boolean
  entries: ReadonlyArray<RestEntry>
  party: ReadonlyArray<Rester>
}

export function requiredHours(kind: RestKind): number {
  return kind === 'long' ? LONG_REST_HOURS : SHORT_REST_HOURS
}

export function resolvedKind(plan: RestPlan): RestKind {
  if (plan.kind === 'long' && plan.breakMinutes > LONG_REST_BREAK_MINUTES) return 'short'
  return plan.kind
}

export function diceBackFromLongRest(level: number): number {
  return Math.max(1, Math.floor(Math.max(0, level) / 2))
}

export function resolveRest(plan: RestPlan, rng: RandomSource): RestResult {
  // A broken night settles into a short rest before the clock is read, so the
  // hours are measured against the rest the camp ended up taking.
  const kind = resolvedKind(plan)
  if (plan.hours < requiredHours(kind)) {
    return {
      kind,
      completed: false,
      entries: plan.party.map(unchangedEntry),
      party: plan.party.map((member) => ({ ...member })),
    }
  }

  const entries: RestEntry[] = []
  const party: Rester[] = []

  for (const member of plan.party) {
    const rolls: HitDieRoll[] = []
    let hp = member.hp
    let pool = member.hitDice

    if (kind === 'short' && !isIncapacitated(member.conditions)) {
      let wanted = Math.max(0, Math.floor(member.spendDice))
      while (wanted > 0 && hp < member.hpMax && availableDice(pool) > 0) {
        const sides = largestAvailable(pool)
        if (sides === null) break
        const roll = rollHitDie(sides, member.conModifier, rng)
        rolls.push(roll)
        hp = Math.min(member.hpMax, hp + roll.healed)
        pool = spendDie(pool, sides)
        wanted -= 1
      }
    }

    let slots = member.slots
    let conditions = member.conditions

    if (kind === 'long') {
      hp = member.hpMax
      slots = refillSlots(slots)
      pool = regainDice(pool, Math.min(spentDice(pool), diceBackFromLongRest(member.level)))
      if (member.fed) conditions = easeExhaustion(conditions)
    }

    conditions = withoutConditions(conditions, RESTS_OFF)
    if (hp > 0) conditions = withoutConditions(conditions, ['unconscious'])

    entries.push({ id: member.id, hpAfter: hp, rolls })
    party.push({ ...member, hp, hitDice: pool, slots, conditions })
  }

  return { kind, completed: true, entries, party }
}

function unchangedEntry(member: Rester): RestEntry {
  return { id: member.id, hpAfter: member.hp, rolls: [] }
}
