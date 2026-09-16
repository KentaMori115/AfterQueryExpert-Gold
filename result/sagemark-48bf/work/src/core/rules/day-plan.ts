// Planning a day of encounters out of a prepared slate.
//
// The awkward part is that nothing here holds still. A fight hands experience
// to the characters who were in it, they cross thresholds at their own pace,
// the party's level is the mean of theirs, and the encounter tables read that
// level, and their head count, to decide what the next fight counts as. Then
// the fight tires them, and a character tired enough is out of the party for
// the rest of the day, which moves the head count and the level again.
//
// So a bag of monsters that would end the party first thing in the morning can
// be a fair fight by the afternoon and out of reach again by dusk, and which
// fights the party can take at all depends on the order the earlier ones went
// in. Nothing below picks an order and hopes. Every run the party could take
// is walked, and the best one is the one that comes back.

import {
  awardToParty,
  assertParty,
  standings,
  tireParty,
  type MemberStanding,
  type PartyMember,
} from './party-progress'
import {
  assertSlate,
  isRunnable,
  nobodyUpToIt,
  ratePick,
  slateOrder,
  tiring,
  type SlatePick,
} from './day-slate'
import { affords, charge, openBudget, type DayBudget } from './day-budget'
import type { EncounterDifficulty } from './encounter-difficulty'

export interface DayRequest {
  party: ReadonlyArray<PartyMember>
  slate: ReadonlyArray<SlatePick>
}

/** One fight, as it stood when the party walked into it. */
export interface DayEntry {
  pickId: string
  difficulty: EncounterDifficulty
  rawXp: number
  effectiveXp: number
}

export interface DayPlan {
  entries: DayEntry[]
  allowance: number
  spent: number
  gained: number
  party: MemberStanding[]
}

interface Candidate {
  entries: DayEntry[]
  order: number[]
  members: PartyMember[]
  budget: DayBudget
  gained: number
}

/**
 * The day the party should run.
 *
 * Of every run of prepared encounters that holds, the one that leaves the
 * party with the most experience wins; between two of those the shorter day
 * wins; and between two of those the one that reaches for the earlier pick on
 * the slate wins, comparing fight by fight from the start of the day.
 */
export function planAdventuringDay(request: DayRequest): DayPlan {
  assertParty(request.party)
  assertSlate(request.slate)

  const slate = [...request.slate]
  const positions = slateOrder(slate)
  const start: Candidate = {
    entries: [],
    order: [],
    members: request.party.map((member) => ({
      id: member.id,
      xp: member.xp,
      state: member.state,
    })),
    budget: openBudget(request.party),
    gained: 0,
  }

  const best = search(start, slate, positions, new Set<string>())
  return {
    entries: best.entries,
    allowance: best.budget.allowance,
    spent: best.budget.spent,
    gained: best.gained,
    party: standings(best.members),
  }
}

/**
 * Walk every day that can still be extended, keeping the best one seen.
 *
 * A candidate is a finished day in its own right: stopping is always allowed,
 * so the plan that runs nothing is the answer when nothing can be run.
 */
function search(
  current: Candidate,
  slate: ReadonlyArray<SlatePick>,
  positions: Map<string, number>,
  taken: Set<string>,
): Candidate {
  let best = current
  for (const pick of slate) {
    if (taken.has(pick.id)) continue
    const next = extend(current, pick, positions)
    if (next === null) continue
    taken.add(pick.id)
    const deeper = search(next, slate, positions, taken)
    taken.delete(pick.id)
    if (isBetter(deeper, best)) best = deeper
  }
  return best
}

/**
 * Run one more fight, or answer null when the party cannot take it.
 *
 * Three things stop a fight. Nobody is up to it, it rates deadly against the
 * characters who are, or its cost does not fit in what is left of the
 * allowance. All three are asked of the party as it stands, which is not the
 * party that started the day.
 */
function extend(
  current: Candidate,
  pick: SlatePick,
  positions: Map<string, number>,
): Candidate | null {
  if (nobodyUpToIt(current.members)) return null
  const rating = ratePick(pick, current.members)
  if (!isRunnable(rating)) return null
  if (!affords(current.budget, rating.effectiveXp)) return null

  const award = awardToParty(current.members, rating.rawXp)
  const after = tiring(rating.difficulty) ? tireParty(award.members) : award.members
  const entry: DayEntry = {
    pickId: pick.id,
    difficulty: rating.difficulty,
    rawXp: rating.rawXp,
    effectiveXp: rating.effectiveXp,
  }
  return {
    entries: [...current.entries, entry],
    order: [...current.order, positions.get(pick.id) ?? 0],
    members: after,
    budget: charge(current.budget, rating.effectiveXp),
    gained: current.gained + gainOf(current.members, after),
  }
}

/** The ordering the plan is chosen by, and it is total. */
function isBetter(candidate: Candidate, incumbent: Candidate): boolean {
  if (candidate.gained !== incumbent.gained) {
    return candidate.gained > incumbent.gained
  }
  if (candidate.entries.length !== incumbent.entries.length) {
    return candidate.entries.length < incumbent.entries.length
  }
  for (let i = 0; i < candidate.order.length; i++) {
    const mine = candidate.order[i]!
    const theirs = incumbent.order[i]!
    if (mine !== theirs) return mine < theirs
  }
  return false
}

/** Experience the roster actually put on, summed over the whole party. */
function gainOf(
  before: ReadonlyArray<PartyMember>,
  after: ReadonlyArray<PartyMember>,
): number {
  let gained = 0
  for (let i = 0; i < after.length; i++) {
    gained += after[i]!.xp - (before[i]?.xp ?? 0)
  }
  return gained
}

/** The ids the plan runs, in order. */
export function plannedIds(plan: DayPlan): string[] {
  return plan.entries.map((entry) => entry.pickId)
}

/** Slate ids the plan leaves on the table, in slate order. */
export function unplanned(request: DayRequest, plan: DayPlan): string[] {
  const used = new Set(plannedIds(plan))
  return request.slate.filter((pick) => !used.has(pick.id)).map((pick) => pick.id)
}

/** What is left of the allowance once the plan has run. */
export function unspent(plan: DayPlan): number {
  return Math.max(0, plan.allowance - plan.spent)
}

export function hardestOf(plan: DayPlan): EncounterDifficulty | null {
  const order: ReadonlyArray<EncounterDifficulty> = [
    'trivial',
    'easy',
    'medium',
    'hard',
    'deadly',
  ]
  let best: EncounterDifficulty | null = null
  for (const entry of plan.entries) {
    if (best === null || order.indexOf(entry.difficulty) > order.indexOf(best)) {
      best = entry.difficulty
    }
  }
  return best
}
