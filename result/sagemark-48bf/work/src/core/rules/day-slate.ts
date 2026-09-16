// The encounters a session has prepared and not yet run. A pick is a bag of
// monsters with a name on it; what it is worth and how dangerous it is are not
// properties of the pick at all, they are answers about a particular party at a
// particular moment, so nothing here is cached and every rating is asked for
// again from the encounter tables.

import { ValidationError } from '../lib/errors'
import {
  DIFFICULTY_ORDER,
  assessEncounter,
  type EncounterAssessment,
  type EncounterDifficulty,
} from './encounter-difficulty'
import { ableMembers, partyShape, type PartyMember } from './party-progress'

/** How many prepared encounters one day may carry. */
export const MAX_SLATE_PICKS = 8

export interface SlatePick {
  id: string
  monsterXps: ReadonlyArray<number>
}

export interface PickRating {
  pickId: string
  rawXp: number
  effectiveXp: number
  multiplier: number
  monsterCount: number
  difficulty: EncounterDifficulty
}

export function assertSlate(picks: ReadonlyArray<SlatePick>): void {
  if (picks.length > MAX_SLATE_PICKS) {
    throw new ValidationError({
      slate: `a day carries at most ${MAX_SLATE_PICKS} prepared encounters`,
    })
  }
  const seen = new Set<string>()
  for (const pick of picks) {
    if (typeof pick.id !== 'string' || pick.id.length === 0) {
      throw new ValidationError({ slate: 'every prepared encounter needs an id' })
    }
    if (seen.has(pick.id)) {
      throw new ValidationError({ slate: `two encounters share the id ${pick.id}` })
    }
    seen.add(pick.id)
    if (!Array.isArray(pick.monsterXps)) {
      throw new ValidationError({ [pick.id]: 'monsterXps must be a list' })
    }
    for (const xp of pick.monsterXps) {
      if (!Number.isFinite(xp)) {
        throw new ValidationError({ [pick.id]: 'every monster needs a finite xp value' })
      }
    }
  }
}

/**
 * Rate one pick against whoever is up to it.
 *
 * The tables answer three questions at once and they do not answer them with
 * the same number: what the fight is worth to the characters, what it counts
 * as against their thresholds, and how many monsters there turned out to be
 * once the ones worth nothing were dropped.
 */
export function ratePick(
  pick: SlatePick,
  members: ReadonlyArray<PartyMember>,
): PickRating {
  const assessment = assessPick(pick, members)
  return {
    pickId: pick.id,
    rawXp: assessment.rawXp,
    effectiveXp: assessment.effectiveXp,
    multiplier: assessment.multiplier,
    monsterCount: assessment.monsterCount,
    difficulty: assessment.difficulty,
  }
}

/** The tables' own answer, for callers that want the thresholds with it. */
export function assessPick(
  pick: SlatePick,
  members: ReadonlyArray<PartyMember>,
): EncounterAssessment {
  return assessEncounter({
    party: partyShape(members),
    monsterXps: pick.monsterXps,
  })
}

export function rateSlate(
  picks: ReadonlyArray<SlatePick>,
  members: ReadonlyArray<PartyMember>,
): PickRating[] {
  return picks.map((pick) => ratePick(pick, members))
}

/** Whether a fight at this rating takes something out of the characters in it. */
export function tiring(difficulty: EncounterDifficulty): boolean {
  return DIFFICULTY_ORDER.indexOf(difficulty) >= DIFFICULTY_ORDER.indexOf('medium')
}

/** A fight the party will take. Deadly is the line nobody walks over. */
export function isRunnable(rating: PickRating): boolean {
  return rating.difficulty !== 'deadly'
}

/** Nobody left standing, so nothing left to walk into. */
export function nobodyUpToIt(members: ReadonlyArray<PartyMember>): boolean {
  return ableMembers(members).length === 0
}

export function runnablePicks(
  picks: ReadonlyArray<SlatePick>,
  members: ReadonlyArray<PartyMember>,
): SlatePick[] {
  return picks.filter((pick) => isRunnable(ratePick(pick, members)))
}

export function pickById(
  picks: ReadonlyArray<SlatePick>,
  id: string,
): SlatePick | null {
  return picks.find((pick) => pick.id === id) ?? null
}

/** Where each pick sits on the slate, which is how ties are settled. */
export function slateOrder(picks: ReadonlyArray<SlatePick>): Map<string, number> {
  const order = new Map<string, number>()
  for (let i = 0; i < picks.length; i++) order.set(picks[i]!.id, i)
  return order
}

/** Slate ids in the order the picks were handed over. */
export function slateIds(picks: ReadonlyArray<SlatePick>): string[] {
  return picks.map((pick) => pick.id)
}
