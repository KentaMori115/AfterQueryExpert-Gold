// A party is a roster of characters, each with an experience total and a state
// of their own. Two things follow from that and both matter downstream.
//
// The encounter tables want one level for the whole group, which they then
// multiply by head count, so the party moves the instant a single character
// crosses a threshold. And the group the tables are asked about is not the
// roster: it is whoever is still up to a fight, which shrinks as the day goes
// on and takes the head count and the level with it.

import { ValidationError } from '../lib/errors'
import {
  bumpExhaustion,
  hasDisadvantageOnAttacks,
  type ConditionState,
} from './conditions'
import { awardXp, levelForXp, splitXp } from './leveling'
import type { PartyShape } from './encounter-difficulty'

export interface PartyMember {
  id: string
  xp: number
  state: ConditionState
}

/** A member with the level their total currently buys them. */
export interface MemberStanding {
  id: string
  xp: number
  level: number
  state: ConditionState
}

/** What one award did to the roster. */
export interface PartyAward {
  members: PartyMember[]
  perCharacter: number
  remainder: number
}

export function assertParty(members: ReadonlyArray<PartyMember>): void {
  if (members.length === 0) {
    throw new ValidationError({ party: 'a day needs at least one character' })
  }
  const seen = new Set<string>()
  for (const member of members) {
    if (typeof member.id !== 'string' || member.id.length === 0) {
      throw new ValidationError({ party: 'every character needs an id' })
    }
    if (seen.has(member.id)) {
      throw new ValidationError({ party: `two characters share the id ${member.id}` })
    }
    seen.add(member.id)
    if (!Number.isFinite(member.xp) || member.xp < 0) {
      throw new ValidationError({ [member.id]: 'xp must be a non negative number' })
    }
    if (!member.state || !Array.isArray(member.state.active)) {
      throw new ValidationError({ [member.id]: 'every character needs a condition state' })
    }
  }
}

/**
 * Whoever is still up to a fight.
 *
 * The rules already know who is swinging at a disadvantage, and this is the
 * only question asked of them: a character in that shape sits the fight out.
 * They stay on the roster, they keep what they have, and they are not counted
 * anywhere the fight is concerned.
 */
export function ableMembers(members: ReadonlyArray<PartyMember>): PartyMember[] {
  return members.filter((member) => !hasDisadvantageOnAttacks(member.state))
}

export function isAble(member: PartyMember): boolean {
  return !hasDisadvantageOnAttacks(member.state)
}

export function partySize(members: ReadonlyArray<PartyMember>): number {
  return members.length
}

export function memberLevel(member: PartyMember): number {
  return levelForXp(member.xp)
}

/** The roster with each character's current level attached, in roster order. */
export function standings(members: ReadonlyArray<PartyMember>): MemberStanding[] {
  return members.map((member) => ({
    id: member.id,
    xp: member.xp,
    level: memberLevel(member),
    state: member.state,
  }))
}

/**
 * The party's level as one number: the mean of the levels the characters hold.
 *
 * Averaging levels and averaging experience are not the same thing, and the
 * difference is the whole point of tracking characters separately. Three
 * novices and a veteran average a low level however much the veteran is
 * sitting on.
 */
export function meanLevel(members: ReadonlyArray<PartyMember>): number {
  if (members.length === 0) return 1
  let total = 0
  for (const member of members) total += memberLevel(member)
  return total / members.length
}

/**
 * The shape the encounter tables want, taken over whoever is up to the fight.
 *
 * The mean is handed over as it falls; the tables decide for themselves what
 * to do with the fraction.
 */
export function partyShape(members: ReadonlyArray<PartyMember>): PartyShape {
  const able = ableMembers(members)
  return { size: partySize(able), averageLevel: meanLevel(able) }
}

/**
 * Hand an encounter's experience to the characters who fought it.
 *
 * The even share goes to all of them. What the split hands back does not go to
 * waste and it does not go to everybody either: it is paid out a point at a
 * time to whoever of them is holding least, and where two are level on
 * experience the one earlier on the roster takes it. So a party that has been
 * out together for a while stops being four identical totals, and the
 * character who was one point short of a level is the one who gets it.
 */
export function awardToParty(
  members: ReadonlyArray<PartyMember>,
  rawXp: number,
): PartyAward {
  const able = ableMembers(members)
  if (able.length === 0) {
    return { members: members.map(copy), perCharacter: 0, remainder: 0 }
  }
  const share = splitXp(rawXp, able.length)
  const paid = new Map<string, number>()
  for (const member of able) paid.set(member.id, awardXp(member.xp, share.perCharacter))
  for (let left = share.remainder; left > 0; left--) {
    const poorest = lowestHolder(able, paid)
    if (!poorest) break
    paid.set(poorest, awardXp(paid.get(poorest) ?? 0, 1))
  }
  return {
    members: members.map((member) => ({
      id: member.id,
      xp: paid.has(member.id) ? (paid.get(member.id) as number) : member.xp,
      state: member.state,
    })),
    perCharacter: share.perCharacter,
    remainder: share.remainder,
  }
}

/** Id of the character holding least, earliest on the roster on a tie. */
function lowestHolder(
  able: ReadonlyArray<PartyMember>,
  paid: Map<string, number>,
): string | null {
  let best: string | null = null
  let least = 0
  for (const member of able) {
    const held = paid.get(member.id) ?? member.xp
    if (best === null || held < least) {
      best = member.id
      least = held
    }
  }
  return best
}

/**
 * A fight that took something out of the characters who were in it.
 *
 * The step is one, and the exhaustion track knows its own limits: it never
 * runs past the bottom of the ladder and never past the top.
 */
export function tireParty(members: ReadonlyArray<PartyMember>): PartyMember[] {
  return members.map((member) =>
    isAble(member)
      ? { id: member.id, xp: member.xp, state: bumpExhaustion(member.state, 1) }
      : copy(member),
  )
}

function copy(member: PartyMember): PartyMember {
  return { id: member.id, xp: member.xp, state: member.state }
}

/** Ids that hold a higher level than they did, in roster order. */
export function levelUps(
  before: ReadonlyArray<PartyMember>,
  after: ReadonlyArray<PartyMember>,
): string[] {
  const was = new Map<string, number>()
  for (const member of before) was.set(member.id, memberLevel(member))
  const risen: string[] = []
  for (const member of after) {
    const previous = was.get(member.id)
    if (previous === undefined) continue
    if (memberLevel(member) > previous) risen.push(member.id)
  }
  return risen
}

export function totalXp(members: ReadonlyArray<PartyMember>): number {
  return members.reduce((acc, member) => acc + member.xp, 0)
}

/** True when both rosters hold the same ids with the same totals, in order. */
export function sameRoster(
  a: ReadonlyArray<PartyMember>,
  b: ReadonlyArray<PartyMember>,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!
    const right = b[i]!
    if (left.id !== right.id || left.xp !== right.xp) return false
  }
  return true
}
