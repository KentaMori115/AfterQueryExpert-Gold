import type { CompiledBiome, ScenarioRecord } from "@biomeweaver/biome-model";
import { seasonAtWrapped } from "@biomeweaver/calendar-engine";
import {
  conditionFlow,
  populationFlow,
  resourceFlow,
  type AttributedFlow,
} from "@biomeweaver/flow-explanations";
import { applyPredation } from "@biomeweaver/predation-engine";
import {
  advanceStage,
  applyCondition,
  applyCrowding,
  applyMortality,
  applyReproduction,
  mergeCohorts,
  type CohortState,
} from "@biomeweaver/population-engine";
import {
  allocateResource,
  calculateDemand,
  renewPool,
  type AllocationRow,
} from "@biomeweaver/resource-engine";
import { clampNonNegative } from "@biomeweaver/fixed-point";
import { initialState, type PoolState, type TickState } from "./state.js";

export const PHASES = [
  "apply-fixed-events",
  "renew-resources",
  "calculate-demand",
  "allocate-resources",
  "apply-condition",
  "apply-mortality",
  "apply-predation",
  "apply-reproduction",
  "advance-stages",
  "enforce-invariants",
  "write-flows",
] as const;

export function advanceTick(
  model: CompiledBiome,
  scenario: ScenarioRecord,
  input: TickState,
): TickState {
  const tick = input.tick + 1;
  const calendar = model.calendars[model.calendarId];
  const season = calendar ? seasonAtWrapped(calendar, tick - 1) : input.season;
  const scale = model.precision.scale;
  const flows: AttributedFlow[] = [];
  let pools: PoolState[] = input.pools.map((pool) => ({ ...pool }));
  let cohorts: CohortState[] = input.cohorts.map((cohort) => ({ ...cohort }));

  for (const hook of scenario.events.filter((item) => item.atTick === tick)) {
    const event = model.events[hook.event];
    if (!event) {
      continue;
    }
    for (const effect of event.effects) {
      if (effect.resource && effect.quantity !== undefined) {
        pools = pools.map((pool) =>
          pool.resource === effect.resource
            ? { ...pool, quantity: clampNonNegative(pool.quantity + effect.quantity!) }
            : pool,
        );
        flows.push(
          resourceFlow(
            tick,
            effect.quantity >= 0n ? "resource-increase" : "resource-decrease",
            effect.resource,
            pools[0]?.region ?? "unknown",
            effect.quantity,
            scale,
            "fixed-event",
            `events.${event.id}`,
          ),
        );
      }
    }
  }

  pools = pools.map((pool) => {
    const next = renewPool(model, pool.resource, pool.region, pool.quantity, season);
    const delta = next - pool.quantity;
    if (delta !== 0n) {
      flows.push(
        resourceFlow(
          tick,
          delta > 0n ? "resource-increase" : "resource-decrease",
          pool.resource,
          pool.region,
          delta,
          scale,
          "resource-renewal",
          `${pool.resource}.renewalPerTick`,
        ),
      );
    }
    return { ...pool, quantity: next };
  });

  const demand = calculateDemand(model, cohorts);
  const allocations: AllocationRow[] = [];
  const nextPools: PoolState[] = [];
  for (const pool of pools) {
    const rows = demand.filter(
      (row) => row.resource === pool.resource && row.region === pool.region,
    );
    const allocated = allocateResource(rows, pool.quantity);
    allocations.push(...allocated);
    const used = allocated.reduce((sum, row) => sum + row.allocated, 0n);
    const remaining = clampNonNegative(pool.quantity - used);
    if (used > 0n) {
      flows.push(
        resourceFlow(
          tick,
          "resource-decrease",
          pool.resource,
          pool.region,
          used,
          scale,
          "resource-allocation",
          `${pool.resource}.allocation`,
        ),
      );
    }
    nextPools.push({ ...pool, quantity: remaining });
  }
  pools = nextPools;

  cohorts = cohorts.map((cohort) => {
    const rows = allocations.filter(
      (row) =>
        row.species === cohort.species &&
        row.stage === cohort.stage &&
        row.region === cohort.region,
    );
    const requested = rows.reduce((sum, row) => sum + row.requested, 0n);
    const allocated = rows.reduce((sum, row) => sum + row.allocated, 0n);
    return applyCondition(cohort, requested, allocated, scale);
  });

  const afterMortality: CohortState[] = [];
  for (const cohort of cohorts) {
    const spec = model.species[cohort.species];
    const rate = spec?.mortality[cohort.stage] ?? 0n;
    const result = applyMortality(cohort, rate, scale);
    if (result.deaths > 0n) {
      flows.push(
        populationFlow(
          tick,
          "population-decrease",
          cohort.species,
          cohort.stage,
          cohort.region,
          result.deaths,
          scale,
          "baseline-mortality",
          `${cohort.species}.mortality.${cohort.stage}`,
        ),
      );
    }
    const deficit = allocations.some(
      (row) =>
        row.species === cohort.species &&
        row.stage === cohort.stage &&
        row.region === cohort.region &&
        row.allocated < row.requested,
    );
    if (deficit && result.cohort.condition < scale / 2n) {
      const extra = applyMortality(result.cohort, rate, scale);
      if (extra.deaths > 0n) {
        flows.push(
          populationFlow(
            tick,
            "population-decrease",
            cohort.species,
            cohort.stage,
            cohort.region,
            extra.deaths,
            scale,
            "resource-deficit-mortality",
            `${cohort.species}.needs`,
          ),
        );
      }
      afterMortality.push(extra.cohort);
    } else {
      afterMortality.push(result.cohort);
    }
  }
  cohorts = afterMortality;

  const predation = applyPredation(model, cohorts);
  cohorts = [...predation.cohorts];
  for (const removal of predation.removals) {
    if (removal.quantity === 0n) {
      continue;
    }
    flows.push(
      populationFlow(
        tick,
        "population-decrease",
        removal.prey,
        removal.stage,
        removal.region,
        removal.quantity,
        scale,
        "authored-predation",
        removal.rule,
      ),
    );
  }

  const offspring: CohortState[] = [];
  cohorts = cohorts.map((cohort) => {
    const spec = model.species[cohort.species];
    if (!spec?.reproduction || spec.reproduction.stage !== cohort.stage) {
      return cohort;
    }
    const born = applyReproduction(
      cohort,
      spec.reproduction.baseRatePerTick,
      spec.reproduction.requiresConditionAtLeast,
      spec.reproduction.offspringStage,
      scale,
    );
    if (!born) {
      return cohort;
    }
    offspring.push(born.offspring);
    flows.push(
      populationFlow(
        tick,
        "population-increase",
        cohort.species,
        spec.reproduction.offspringStage,
        cohort.region,
        born.births,
        scale,
        "reproduction",
        `${cohort.species}.reproduction`,
      ),
    );
    return cohort;
  });
  cohorts = mergeCohorts([...cohorts, ...offspring]);

  cohorts = cohorts.map((cohort) => {
    const spec = model.species[cohort.species];
    const transition = spec?.transitions.find((item) => item.from === cohort.stage);
    if (!transition) {
      return { ...cohort, ageTicks: cohort.ageTicks + 1 };
    }
    return advanceStage(cohort, transition.afterTicks, transition.to);
  });

  const crowding = applyCrowding(model, cohorts, season);
  cohorts = [...crowding.cohorts];
  for (const removal of crowding.removals) {
    flows.push(
      populationFlow(
        tick,
        "population-decrease",
        removal.species,
        removal.stage,
        removal.region,
        removal.quantity,
        scale,
        "habitat-crowding",
        removal.rule,
      ),
    );
  }
  for (const change of crowding.conditionChanges) {
    flows.push(
      conditionFlow(
        tick,
        change.species,
        change.stage,
        change.region,
        change.before,
        change.after,
        scale,
        "habitat-crowding",
        change.rule,
      ),
    );
  }

  cohorts = cohorts.map((cohort) => ({ ...cohort, count: clampNonNegative(cohort.count) }));
  pools = pools.map((pool) => ({ ...pool, quantity: clampNonNegative(pool.quantity) }));

  const alerts: string[] = [];
  for (const cohort of cohorts) {
    if (cohort.count === 0n) {
      alerts.push(`${cohort.species} in ${cohort.region} reached zero`);
    }
  }
  for (const seat of crowding.seats) {
    if (seat.occupied > seat.seats) {
      alerts.push(`${seat.species} in ${seat.region} is over its seats`);
    }
  }

  return {
    tick,
    season,
    cohorts,
    pools,
    flows,
    alerts,
  };
}

export function simulate(
  model: CompiledBiome,
  scenario: ScenarioRecord,
  ticks: number,
): { readonly states: readonly TickState[]; readonly flows: readonly AttributedFlow[] } {
  const states: TickState[] = [initialState(model, scenario)];
  const flows: AttributedFlow[] = [];
  for (const population of scenario.initialPopulations) {
    flows.push(
      populationFlow(
        0,
        "population-increase",
        population.species,
        population.stage,
        population.region,
        population.count,
        model.precision.scale,
        "initial-state",
        `scenario.${scenario.id}`,
      ),
    );
  }
  for (let index = 0; index < ticks; index += 1) {
    const current = states[states.length - 1];
    if (!current) {
      break;
    }
    const next = advanceTick(model, scenario, current);
    states.push(next);
    flows.push(...next.flows);
  }
  return { states, flows };
}

export { initialState };
