import type { CompiledBiome, ScenarioRecord } from "@biomeweaver/biome-model";
import { seasonAtWrapped } from "@biomeweaver/calendar-engine";
import type { AttributedFlow } from "@biomeweaver/flow-explanations";
import type { CohortState } from "@biomeweaver/population-engine";
import { initialCohorts } from "@biomeweaver/population-engine";
import type { Fixed } from "@biomeweaver/fixed-point";

export type PoolState = {
  readonly resource: string;
  readonly region: string;
  readonly quantity: Fixed;
};

export type TickState = {
  readonly tick: number;
  readonly season: string;
  readonly cohorts: readonly CohortState[];
  readonly pools: readonly PoolState[];
  readonly flows: readonly AttributedFlow[];
  readonly alerts: readonly string[];
};

export function initialPools(scenario: ScenarioRecord): PoolState[] {
  return scenario.initialResources
    .map((row) => ({
      resource: row.resource,
      region: row.region,
      quantity: row.quantity,
    }))
    .sort(
      (left, right) =>
        left.resource.localeCompare(right.resource) || left.region.localeCompare(right.region),
    );
}

export function initialState(model: CompiledBiome, scenario: ScenarioRecord): TickState {
  const calendar = model.calendars[model.calendarId];
  return {
    tick: 0,
    season: calendar ? seasonAtWrapped(calendar, 0) : "unknown",
    cohorts: initialCohorts(model, scenario),
    pools: initialPools(scenario),
    flows: [],
    alerts: [],
  };
}
