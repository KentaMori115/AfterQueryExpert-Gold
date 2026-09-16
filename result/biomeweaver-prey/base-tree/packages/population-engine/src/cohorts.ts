import type { CompiledBiome, ScenarioRecord } from "@biomeweaver/biome-model";
import { clampNonNegative, mul, type Fixed } from "@biomeweaver/fixed-point";

export type CohortState = {
  readonly species: string;
  readonly stage: string;
  readonly region: string;
  readonly count: Fixed;
  readonly condition: Fixed;
  readonly ageTicks: number;
};

export function initialCohorts(model: CompiledBiome, scenario: ScenarioRecord): CohortState[] {
  return scenario.initialPopulations.map((row) => ({
    species: row.species,
    stage: row.stage,
    region: row.region,
    count: row.count,
    condition: model.precision.scale,
    ageTicks: 0,
  }));
}

export function applyCondition(
  cohort: CohortState,
  requested: Fixed,
  allocated: Fixed,
  scale: bigint,
): CohortState {
  if (requested === 0n) {
    return cohort;
  }
  const ratio = (allocated * scale) / requested;
  const next = (cohort.condition * 3n + ratio) / 4n;
  return { ...cohort, condition: next > scale ? scale : next };
}

export function applyMortality(
  cohort: CohortState,
  rate: Fixed,
  scale: bigint,
): {
  readonly cohort: CohortState;
  readonly deaths: Fixed;
} {
  const deaths = clampNonNegative(mul(cohort.count, rate, scale, "half-even"));
  return { cohort: { ...cohort, count: clampNonNegative(cohort.count - deaths) }, deaths };
}

export function applyReproduction(
  cohort: CohortState,
  rate: Fixed,
  threshold: Fixed,
  offspringStage: string,
  scale: bigint,
): { readonly births: Fixed; readonly offspring: CohortState } | undefined {
  if (cohort.condition < threshold) {
    return undefined;
  }
  const births = clampNonNegative(mul(cohort.count, rate, scale, "half-even"));
  if (births === 0n) {
    return undefined;
  }
  return {
    births,
    offspring: {
      species: cohort.species,
      stage: offspringStage,
      region: cohort.region,
      count: births,
      condition: scale,
      ageTicks: 0,
    },
  };
}

export function advanceStage(
  cohort: CohortState,
  afterTicks: number,
  nextStage: string,
): CohortState {
  const age = cohort.ageTicks + 1;
  if (age >= afterTicks) {
    return { ...cohort, stage: nextStage, ageTicks: 0 };
  }
  return { ...cohort, ageTicks: age };
}

export function mergeCohorts(cohorts: readonly CohortState[]): CohortState[] {
  const merged = new Map<string, CohortState>();
  for (const cohort of cohorts) {
    const key = `${cohort.species}:${cohort.stage}:${cohort.region}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, cohort);
      continue;
    }
    const total = existing.count + cohort.count;
    const condition =
      total === 0n
        ? existing.condition
        : (existing.condition * existing.count + cohort.condition * cohort.count) / total;
    merged.set(key, {
      ...existing,
      count: total,
      condition,
      ageTicks: Math.min(existing.ageTicks, cohort.ageTicks),
    });
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.species.localeCompare(right.species) ||
      left.stage.localeCompare(right.stage) ||
      left.region.localeCompare(right.region),
  );
}
