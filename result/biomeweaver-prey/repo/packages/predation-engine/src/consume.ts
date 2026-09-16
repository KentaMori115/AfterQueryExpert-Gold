import { cohortKey, type CompiledBiome } from "@biomeweaver/biome-model";
import { clampNonNegative, type Fixed } from "@biomeweaver/fixed-point";
import type { CohortState } from "@biomeweaver/population-engine";
import { buildClaims } from "./claims.js";
import { settleHunger, type HuntTally } from "./hunger.js";
import { settleClaims } from "./settle.js";
import { compareKeys, type PredationPressure, type PredationRemoval } from "./types.js";

export type PredationResult = {
  readonly cohorts: readonly CohortState[];
  readonly removals: readonly PredationRemoval[];
  readonly pressure: readonly PredationPressure[];
};

/**
 * Run the predation phase over one tick's cohorts.
 *
 * Reports one removal per claim that took something and one pressure row per
 * prey cohort that was hunted, both in ascending key order, alongside the
 * cohorts as predation left them.
 */
export function applyPredation(
  model: CompiledBiome,
  cohorts: readonly CohortState[],
): PredationResult {
  const slate = buildClaims(model, cohorts);
  const settled = new Map<string, Fixed>(
    settleClaims(slate).map((claim) => [claim.key, claim.granted]),
  );
  const taken = new Map<string, Fixed>();
  const removals: PredationRemoval[] = [];

  for (const claim of slate.claims) {
    const quantity = settled.get(claim.key) ?? 0n;
    if (quantity <= 0n) {
      continue;
    }
    taken.set(claim.preyKey, (taken.get(claim.preyKey) ?? 0n) + quantity);
    removals.push({
      predator: claim.predator,
      prey: claim.prey,
      stage: claim.preyStage,
      region: claim.region,
      quantity,
      rule: claim.rule,
    });
  }

  const hunts = new Map<string, HuntTally>();
  for (const claim of slate.claims) {
    const tally = hunts.get(claim.predatorKey) ?? { asked: 0n, taken: 0n };
    hunts.set(claim.predatorKey, {
      asked: tally.asked + claim.ask,
      taken: tally.taken + (settled.get(claim.key) ?? 0n),
    });
  }

  const asked = new Map<string, Fixed>();
  for (const claim of slate.claims) {
    asked.set(claim.preyKey, (asked.get(claim.preyKey) ?? 0n) + claim.ask);
  }
  const pressure: PredationPressure[] = [...asked.keys()].sort(compareKeys).flatMap((preyKey) => {
    const claim = slate.claims.find((row) => row.preyKey === preyKey);
    if (!claim) {
      return [];
    }
    return [
      {
        prey: claim.prey,
        stage: claim.preyStage,
        region: claim.region,
        asked: asked.get(preyKey) ?? 0n,
        taken: taken.get(preyKey) ?? 0n,
      },
    ];
  });

  const next = cohorts.map((cohort) => {
    const key = cohortKey(cohort.species, cohort.stage, cohort.region);
    const loss = taken.get(key) ?? 0n;
    const fed = settleHunger(cohort, hunts.get(key), model.precision.scale);
    if (loss === 0n) {
      return { ...fed };
    }
    return { ...fed, count: clampNonNegative(fed.count - loss) };
  });

  return { cohorts: next, removals, pressure };
}
