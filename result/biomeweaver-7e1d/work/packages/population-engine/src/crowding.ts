import { cohortKey, type CompiledBiome, type SpeciesRecord } from "@biomeweaver/biome-model";
import {
  assignRemainders,
  clampNonNegative,
  div,
  min,
  mul,
  proportionalShares,
  type Fixed,
} from "@biomeweaver/fixed-point";
import type { CohortState } from "./cohorts.js";

export type SeatCount = {
  readonly species: string;
  readonly region: string;
  readonly seats: Fixed;
  readonly occupied: Fixed;
  readonly pressure: Fixed;
};

export type CrowdingRemoval = {
  readonly species: string;
  readonly stage: string;
  readonly region: string;
  readonly quantity: Fixed;
  readonly rule: string;
};

export type ConditionChange = {
  readonly species: string;
  readonly stage: string;
  readonly region: string;
  readonly before: Fixed;
  readonly after: Fixed;
  readonly rule: string;
};

export type CrowdingResult = {
  readonly cohorts: readonly CohortState[];
  readonly removals: readonly CrowdingRemoval[];
  readonly conditionChanges: readonly ConditionChange[];
  readonly seats: readonly SeatCount[];
};

export function crowdingRule(species: string, region: string): string {
  return `${species}.capacity.${region}`;
}

export function stageSpace(spec: SpeciesRecord | undefined, stage: string, scale: bigint): Fixed {
  if (!spec) {
    return scale;
  }
  const authored = spec.space[stage];
  return authored === undefined ? scale : authored;
}

export function regionSeats(
  model: CompiledBiome,
  species: string,
  region: string,
  season: string,
): Fixed | undefined {
  const scale = model.precision.scale;
  let total: Fixed | undefined;
  for (const habitat of Object.values(model.habitats)) {
    if (habitat.region !== region) {
      continue;
    }
    const authored = habitat.capacity[species];
    if (authored === undefined) {
      continue;
    }
    const factor = habitat.modifiers[season]?.[`${species}-capacity`];
    const seats = factor === undefined ? authored : mul(authored, factor, scale, "half-even");
    total = (total ?? 0n) + seats;
  }
  return total;
}

export function cohortRoom(
  model: CompiledBiome,
  cohort: CohortState,
  spec: SpeciesRecord | undefined,
): Fixed {
  const scale = model.precision.scale;
  return mul(cohort.count, stageSpace(spec, cohort.stage, scale), scale, "half-even");
}

export function regionOccupancy(
  model: CompiledBiome,
  cohorts: readonly CohortState[],
  species: string,
  region: string,
): Fixed {
  const spec = model.species[species];
  let occupied = 0n;
  for (const cohort of cohorts) {
    if (cohort.species !== species || cohort.region !== region) {
      continue;
    }
    occupied += cohortRoom(model, cohort, spec);
  }
  return occupied;
}

function crowdedGroups(cohorts: readonly CohortState[]): { species: string; region: string }[] {
  const seen = new Set<string>();
  const groups: { species: string; region: string }[] = [];
  for (const cohort of cohorts) {
    const key = `${cohort.species}:${cohort.region}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    groups.push({ species: cohort.species, region: cohort.region });
  }
  return groups.sort(
    (left, right) =>
      left.species.localeCompare(right.species) || left.region.localeCompare(right.region),
  );
}

export function applyCrowding(
  model: CompiledBiome,
  cohorts: readonly CohortState[],
  season: string,
): CrowdingResult {
  const scale = model.precision.scale;
  const next = cohorts.map((cohort) => ({ ...cohort }));
  const removals: CrowdingRemoval[] = [];
  const conditionChanges: ConditionChange[] = [];
  const seatCounts: SeatCount[] = [];

  for (const group of crowdedGroups(next)) {
    const seats = regionSeats(model, group.species, group.region, season);
    if (seats === undefined) {
      continue;
    }
    const occupied = regionOccupancy(model, next, group.species, group.region);
    const pressure = seats === 0n ? 0n : div(occupied, seats, scale, "half-even");
    seatCounts.push({
      species: group.species,
      region: group.region,
      seats,
      occupied,
      pressure,
    });
    if (occupied <= seats) {
      continue;
    }

    const spec = model.species[group.species];
    const members = next
      .map((cohort, index) => ({ cohort, index }))
      .filter(
        (entry) =>
          entry.cohort.species === group.species &&
          entry.cohort.region === group.region &&
          cohortRoom(model, entry.cohort, spec) > 0n,
      )
      .sort((left, right) =>
        cohortKey(left.cohort.species, left.cohort.stage, left.cohort.region).localeCompare(
          cohortKey(right.cohort.species, right.cohort.stage, right.cohort.region),
        ),
      );
    if (members.length === 0) {
      continue;
    }

    const weights = members.map((entry) => ({
      key: cohortKey(entry.cohort.species, entry.cohort.stage, entry.cohort.region),
      amount: cohortRoom(model, entry.cohort, spec),
    }));
    const shares = proportionalShares(weights, occupied - seats);
    const order = weights.map((weight) => weight.key);
    const assigned = assignRemainders(shares.assigned, shares.remainder, order);
    const byKey = new Map(assigned.map((share) => [share.key, share.amount]));

    for (const entry of members) {
      const key = cohortKey(entry.cohort.species, entry.cohort.stage, entry.cohort.region);
      const room = byKey.get(key) ?? 0n;
      const space = stageSpace(spec, entry.cohort.stage, scale);
      const wanted = space === 0n ? 0n : div(room, space, scale, "half-even");
      const removed = clampNonNegative(min(wanted, entry.cohort.count));
      if (removed > 0n) {
        removals.push({
          species: entry.cohort.species,
          stage: entry.cohort.stage,
          region: entry.cohort.region,
          quantity: removed,
          rule: crowdingRule(entry.cohort.species, entry.cohort.region),
        });
      }
      const condition =
        pressure <= 0n
          ? entry.cohort.condition
          : div(entry.cohort.condition, pressure, scale, "half-even");
      if (condition !== entry.cohort.condition) {
        conditionChanges.push({
          species: entry.cohort.species,
          stage: entry.cohort.stage,
          region: entry.cohort.region,
          before: entry.cohort.condition,
          after: condition,
          rule: crowdingRule(entry.cohort.species, entry.cohort.region),
        });
      }
      next[entry.index] = {
        ...entry.cohort,
        count: clampNonNegative(entry.cohort.count - removed),
        condition,
      };
    }
  }

  return { cohorts: next, removals, conditionChanges, seats: seatCounts };
}

export type SeatOffer = {
  readonly species: string;
  readonly region: string;
  readonly habitat: string;
  readonly seats: Fixed;
};

export function seasonSeats(model: CompiledBiome, season: string): SeatOffer[] {
  const scale = model.precision.scale;
  const offers: SeatOffer[] = [];
  for (const habitat of Object.values(model.habitats)) {
    for (const [species, authored] of Object.entries(habitat.capacity)) {
      const factor = habitat.modifiers[season]?.[`${species}-capacity`];
      offers.push({
        species,
        region: habitat.region,
        habitat: habitat.id,
        seats: factor === undefined ? authored : mul(authored, factor, scale, "half-even"),
      });
    }
  }
  return offers.sort(
    (left, right) =>
      left.species.localeCompare(right.species) ||
      left.region.localeCompare(right.region) ||
      left.habitat.localeCompare(right.habitat),
  );
}

export function seatPlan(
  model: CompiledBiome,
  cohorts: readonly CohortState[],
  season: string,
): SeatCount[] {
  const scale = model.precision.scale;
  const rows: SeatCount[] = [];
  for (const group of crowdedGroups(cohorts)) {
    const seats = regionSeats(model, group.species, group.region, season);
    if (seats === undefined) {
      continue;
    }
    const occupied = regionOccupancy(model, cohorts, group.species, group.region);
    rows.push({
      species: group.species,
      region: group.region,
      seats,
      occupied,
      pressure: seats === 0n ? 0n : div(occupied, seats, scale, "half-even"),
    });
  }
  return rows;
}
