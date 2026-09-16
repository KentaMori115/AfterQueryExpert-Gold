import { cohortKey, type CompiledBiome } from "@biomeweaver/biome-model";
import { assignRemainders, proportionalShares, type Fixed } from "@biomeweaver/fixed-point";

export type DemandRow = {
  readonly key: string;
  readonly species: string;
  readonly stage: string;
  readonly region: string;
  readonly resource: string;
  readonly priority: number;
  readonly requested: Fixed;
};

export type AllocationRow = DemandRow & {
  readonly allocated: Fixed;
};

export function calculateDemand(
  model: CompiledBiome,
  cohorts: readonly { species: string; stage: string; region: string; count: Fixed }[],
): DemandRow[] {
  const rows: DemandRow[] = [];
  for (const cohort of cohorts) {
    const spec = model.species[cohort.species];
    if (!spec) {
      continue;
    }
    for (const need of spec.needs) {
      rows.push({
        key: `${cohortKey(cohort.species, cohort.stage, cohort.region)}:${need.resource}`,
        species: cohort.species,
        stage: cohort.stage,
        region: cohort.region,
        resource: need.resource,
        priority: need.priority,
        requested: (cohort.count * need.perIndividualPerTick) / model.precision.scale,
      });
    }
  }
  return rows.sort(
    (left, right) =>
      left.resource.localeCompare(right.resource) ||
      left.region.localeCompare(right.region) ||
      right.priority - left.priority ||
      left.species.localeCompare(right.species) ||
      left.stage.localeCompare(right.stage),
  );
}

export function allocateResource(demands: readonly DemandRow[], available: Fixed): AllocationRow[] {
  if (available <= 0n) {
    return demands.map((row) => ({ ...row, allocated: 0n }));
  }
  const byPriority = new Map<number, DemandRow[]>();
  for (const row of demands) {
    const group = byPriority.get(row.priority) ?? [];
    group.push(row);
    byPriority.set(row.priority, group);
  }
  const priorities = [...byPriority.keys()].sort((left, right) => right - left);
  let remaining = available;
  const allocated = new Map<string, Fixed>();
  for (const priority of priorities) {
    const group = byPriority.get(priority) ?? [];
    const requested = group.reduce((sum, row) => sum + row.requested, 0n);
    if (requested <= remaining) {
      for (const row of group) {
        allocated.set(row.key, row.requested);
        remaining -= row.requested;
      }
      continue;
    }
    const shares = proportionalShares(
      group.map((row) => ({ key: row.key, amount: row.requested })),
      remaining,
    );
    const order = [...group.map((row) => row.key)].sort((left, right) => left.localeCompare(right));
    const withRemainders = assignRemainders(shares.assigned, shares.remainder, order);
    for (const share of withRemainders) {
      allocated.set(share.key, share.amount);
    }
    remaining = 0n;
    break;
  }
  return demands.map((row) => ({ ...row, allocated: allocated.get(row.key) ?? 0n }));
}
