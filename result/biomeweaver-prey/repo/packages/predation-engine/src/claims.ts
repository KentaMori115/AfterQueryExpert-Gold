import { cohortKey, type CompiledBiome, type SpeciesRecord } from "@biomeweaver/biome-model";
import { mul, type Fixed } from "@biomeweaver/fixed-point";
import type { CohortState } from "@biomeweaver/population-engine";
import { saturatedAsk } from "./response.js";
import { claimKey, compareKeys, type ClaimSlate, type PredationClaim } from "./types.js";

function cohortOrder(left: CohortState, right: CohortState): number {
  return (
    left.species.localeCompare(right.species) ||
    left.stage.localeCompare(right.stage) ||
    left.region.localeCompare(right.region)
  );
}

/**
 * What one predator cohort may take in a tick, or nothing at all when its
 * species authors no cap. A species that authors `maxIntakePerTick` holds every
 * cohort of that species to `count x maxIntakePerTick` prey across all of its
 * rules together.
 */
export function intakeBudget(
  model: CompiledBiome,
  spec: SpeciesRecord,
  count: Fixed,
): Fixed | undefined {
  if (spec.maxIntakePerTick === undefined) {
    return undefined;
  }
  const limit = mul(count, spec.maxIntakePerTick, model.precision.scale, model.precision.rounding);
  return limit < 0n ? 0n : limit;
}

/**
 * Every claim a tick has to settle, read off the cohorts as the phase began.
 *
 * One claim per predator cohort and prey cohort that share a region, keyed so
 * that the settlement never depends on the order the cohorts arrived in. Prey
 * counts and budgets are captured here, once, so nothing measured later in the
 * settlement can move them.
 */
export function buildClaims(model: CompiledBiome, cohorts: readonly CohortState[]): ClaimSlate {
  const claims = new Map<string, PredationClaim>();
  const availability = new Map<string, Fixed>();
  const budgets = new Map<string, Fixed>();
  const predators = [...cohorts].sort(cohortOrder);

  for (const predator of predators) {
    const spec = model.species[predator.species];
    if (!spec || spec.predation.length === 0) {
      continue;
    }
    const predatorKey = cohortKey(predator.species, predator.stage, predator.region);
    let claimed = false;
    for (const rule of spec.predation) {
      const prey = cohorts.find(
        (cohort) =>
          cohort.species === rule.prey &&
          cohort.stage === rule.preyStage &&
          cohort.region === predator.region,
      );
      if (!prey) {
        continue;
      }
      const ask = saturatedAsk(model.precision, rule, predator.count, prey.count);
      if (ask <= 0n) {
        continue;
      }
      const key = claimKey(
        predator.species,
        predator.stage,
        predator.region,
        rule.prey,
        rule.preyStage,
      );
      const preyKey = cohortKey(prey.species, prey.stage, prey.region);
      const existing = claims.get(key);
      claims.set(key, {
        key,
        predatorKey,
        preyKey,
        predator: predator.species,
        predatorStage: predator.stage,
        prey: rule.prey,
        preyStage: rule.preyStage,
        region: predator.region,
        rule: `${predator.species}.predation.${rule.prey}`,
        ask: existing ? existing.ask + ask : ask,
      });
      availability.set(preyKey, prey.count < 0n ? 0n : prey.count);
      claimed = true;
    }
    if (claimed) {
      const budget = intakeBudget(model, spec, predator.count);
      if (budget !== undefined) {
        budgets.set(predatorKey, budget);
      }
    }
  }

  return {
    claims: [...claims.values()].sort((left, right) => compareKeys(left.key, right.key)),
    availability,
    budgets,
  };
}
