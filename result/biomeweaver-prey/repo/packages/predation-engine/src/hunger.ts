import { applyCondition, type CohortState } from "@biomeweaver/population-engine";
import type { Fixed } from "@biomeweaver/fixed-point";

export type HuntTally = {
  readonly asked: Fixed;
  readonly taken: Fixed;
};

/**
 * A predator that took less than it asked for goes into the next tick in worse
 * condition, blended toward the share it got exactly as a cohort short of a
 * resource is. A cohort that was fed keeps the condition it arrived with.
 */
export function settleHunger(
  cohort: CohortState,
  tally: HuntTally | undefined,
  scale: bigint,
): CohortState {
  if (!tally || tally.asked <= 0n || tally.taken >= tally.asked) {
    return cohort;
  }
  return applyCondition(cohort, tally.asked, tally.taken, scale);
}
