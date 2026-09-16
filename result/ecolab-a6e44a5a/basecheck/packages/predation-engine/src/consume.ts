import type { CompiledBiome } from "@biomeweaver/biome-model";
import { clampNonNegative, min, mul, type Fixed } from "@biomeweaver/fixed-point";
import type { CohortState } from "@biomeweaver/population-engine";

export type PredationResult = {
  readonly cohorts: readonly CohortState[];
  readonly removals: readonly {
    readonly predator: string;
    readonly prey: string;
    readonly stage: string;
    readonly region: string;
    readonly quantity: Fixed;
    readonly rule: string;
  }[];
};

export function applyPredation(
  model: CompiledBiome,
  cohorts: readonly CohortState[],
): PredationResult {
  const next = cohorts.map((cohort) => ({ ...cohort }));
  const removals: Array<{
    predator: string;
    prey: string;
    stage: string;
    region: string;
    quantity: Fixed;
    rule: string;
  }> = [];
  const predators = [...next].sort(
    (left, right) =>
      left.species.localeCompare(right.species) ||
      left.stage.localeCompare(right.stage) ||
      left.region.localeCompare(right.region),
  );
  for (const predator of predators) {
    const spec = model.species[predator.species];
    if (!spec) {
      continue;
    }
    for (const rule of spec.predation) {
      const preyIndex = next.findIndex(
        (cohort) =>
          cohort.species === rule.prey &&
          cohort.stage === rule.preyStage &&
          cohort.region === predator.region,
      );
      if (preyIndex < 0) {
        continue;
      }
      const prey = next[preyIndex];
      if (!prey) {
        continue;
      }
      const desired = mul(
        predator.count,
        rule.perPredatorPerTick,
        model.precision.scale,
        "half-even",
      );
      const taken = min(desired, prey.count);
      next[preyIndex] = { ...prey, count: clampNonNegative(prey.count - taken) };
      removals.push({
        predator: predator.species,
        prey: rule.prey,
        stage: rule.preyStage,
        region: predator.region,
        quantity: taken,
        rule: `${predator.species}.predation.${rule.prey}`,
      });
    }
  }
  return { cohorts: next, removals };
}
