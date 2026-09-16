// How much fighting a party can take before the day is over.
//
// The encounter tables rate one fight at a time and say nothing about a run of
// them, so the day needs a figure of its own. Six medium encounters is the day
// the tables are built around, and that is what the allowance is: six times the
// party's medium threshold. It is read once, when the day opens, and it does
// not move afterwards however much experience the characters pick up.

import { partyThresholds, type EncounterDifficulty } from './encounter-difficulty'
import { partyShape, type PartyMember } from './party-progress'

/** Medium encounters the allowance is worth. */
export const MEDIUM_ENCOUNTERS_PER_DAY = 6

/** Which threshold the allowance is built from. */
export const ALLOWANCE_THRESHOLD: EncounterDifficulty = 'medium'

export interface DayBudget {
  allowance: number
  spent: number
}

export function dayAllowance(members: ReadonlyArray<PartyMember>): number {
  const thresholds = partyThresholds(partyShape(members))
  return thresholds[ALLOWANCE_THRESHOLD] * MEDIUM_ENCOUNTERS_PER_DAY
}

export function openBudget(members: ReadonlyArray<PartyMember>): DayBudget {
  return { allowance: dayAllowance(members), spent: 0 }
}

export function remaining(budget: DayBudget): number {
  return Math.max(0, budget.allowance - budget.spent)
}

/**
 * Whether a fight fits in what is left.
 *
 * A fight that lands exactly on the allowance fits; the one after it does not,
 * whatever it costs.
 */
export function affords(budget: DayBudget, effectiveXp: number): boolean {
  return budget.spent + effectiveXp <= budget.allowance
}

export function charge(budget: DayBudget, effectiveXp: number): DayBudget {
  return { allowance: budget.allowance, spent: budget.spent + effectiveXp }
}

export function isSpent(budget: DayBudget): boolean {
  return budget.spent >= budget.allowance
}

/** How much of the day has gone, as a fraction between zero and one. */
export function budgetFraction(budget: DayBudget): number {
  if (budget.allowance <= 0) return 1
  return Math.min(1, budget.spent / budget.allowance)
}

export function budgetTone(
  budget: DayBudget,
): 'success' | 'info' | 'warning' | 'danger' {
  const used = budgetFraction(budget)
  if (used < 0.34) return 'success'
  if (used < 0.67) return 'info'
  if (used < 1) return 'warning'
  return 'danger'
}
