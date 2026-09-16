import { compileCapsule, type CompiledBiome, type ScenarioRecord } from "@biomeweaver/biome-model";
import {
  populationSeries,
  renderCsvReport,
  renderJsonReport,
  renderMarkdownReport,
  resourceSeries,
} from "@biomeweaver/biome-reports";
import { DEFAULT_SCALE, formatFixed, parseFixed } from "@biomeweaver/fixed-point";
import { explainFlows, type AttributedFlow } from "@biomeweaver/flow-explanations";
import { seasonSeats, seatPlan } from "@biomeweaver/population-engine";
import { runDigest, verifyRun, writeRun } from "@biomeweaver/run-store";
import { simulate, type TickState } from "@biomeweaver/tick-runtime";
import { createHash } from "node:crypto";

export type SimulationOutcome = {
  readonly model: CompiledBiome;
  readonly scenario: ScenarioRecord;
  readonly runId: string;
  readonly states: readonly TickState[];
  readonly flows: readonly AttributedFlow[];
  readonly alerts: readonly string[];
};

export type SeatPressureRow = {
  readonly tick: number;
  readonly season: string;
  readonly species: string;
  readonly region: string;
  readonly seats: string;
  readonly occupied: string;
  readonly pressure: string;
  readonly overSeats: boolean;
};

export function seatPressure(outcome: SimulationOutcome): readonly SeatPressureRow[] {
  const scale = outcome.model.precision.scale;
  const rows: SeatPressureRow[] = [];
  for (const state of outcome.states) {
    for (const seat of seatPlan(outcome.model, state.cohorts, state.season)) {
      rows.push({
        tick: state.tick,
        season: state.season,
        species: seat.species,
        region: seat.region,
        seats: formatFixed(seat.seats, scale),
        occupied: formatFixed(seat.occupied, scale),
        pressure: formatFixed(seat.pressure, scale),
        overSeats: seat.occupied > seat.seats,
      });
    }
  }
  return rows;
}

export type SeatTableRow = {
  readonly season: string;
  readonly species: string;
  readonly region: string;
  readonly habitat: string;
  readonly seats: string;
};

export function seatTable(root: string): readonly SeatTableRow[] {
  const compiled = compileCapsule({ root });
  const model = compiled.model;
  if (!model) {
    return [];
  }
  const scale = model.precision.scale;
  const calendar = model.calendars[model.calendarId];
  const seasons = calendar ? calendar.seasons.map((season) => season.id) : [];
  const rows: SeatTableRow[] = [];
  for (const season of seasons) {
    for (const offer of seasonSeats(model, season)) {
      rows.push({
        season,
        species: offer.species,
        region: offer.region,
        habitat: offer.habitat,
        seats: formatFixed(offer.seats, scale),
      });
    }
  }
  return rows;
}

export type PeakPressureRow = {
  readonly species: string;
  readonly region: string;
  readonly tick: number;
  readonly pressure: string;
  readonly overSeats: boolean;
};

export function peakPressure(rows: readonly SeatPressureRow[]): readonly PeakPressureRow[] {
  const peaks = new Map<string, PeakPressureRow>();
  for (const row of rows) {
    const key = `${row.species}:${row.region}`;
    const seen = peaks.get(key);
    if (
      seen &&
      parseFixed(seen.pressure, DEFAULT_SCALE) >= parseFixed(row.pressure, DEFAULT_SCALE)
    ) {
      continue;
    }
    peaks.set(key, {
      species: row.species,
      region: row.region,
      tick: row.tick,
      pressure: row.pressure,
      overSeats: row.overSeats,
    });
  }
  return [...peaks.values()].sort(
    (left, right) =>
      left.species.localeCompare(right.species) || left.region.localeCompare(right.region),
  );
}

export function loadBiome(root: string) {
  return compileCapsule({ root });
}

export function runScenario(root: string, scenarioId: string, ticks?: number): SimulationOutcome {
  const compiled = compileCapsule({ root });
  if (!compiled.model) {
    throw new Error(compiled.diagnostics.map((item) => item.message).join("\n"));
  }
  const scenario = compiled.model.scenarios[scenarioId];
  if (!scenario) {
    throw new Error(`unknown scenario ${scenarioId}`);
  }
  const duration = ticks ?? scenario.durationTicks;
  const result = simulate(compiled.model, scenario, duration);
  const runId = createHash("sha256")
    .update(`${compiled.model.fingerprint}:${scenario.id}:${duration}`)
    .digest("hex")
    .slice(0, 12);
  const alerts = result.states.flatMap((state) => state.alerts);
  writeRun(root, {
    manifest: {
      runId,
      scenario: scenario.id,
      fingerprint: compiled.model.fingerprint,
      ticks: duration,
      digest: runDigest(scenario.id, compiled.model.fingerprint, duration, result.flows),
    },
    states: result.states,
    flows: result.flows,
  });
  return {
    model: compiled.model,
    scenario,
    runId,
    states: result.states,
    flows: result.flows,
    alerts,
  };
}

export function describeBiome(root: string) {
  const compiled = compileCapsule({ root });
  return {
    diagnostics: compiled.diagnostics,
    biome: compiled.model?.biome,
    displayName: compiled.model?.displayName,
    fingerprint: compiled.model?.fingerprint,
    species: compiled.model ? Object.keys(compiled.model.species).sort() : [],
    scenarios: compiled.model ? Object.keys(compiled.model.scenarios).sort() : [],
    seats: compiled.model
      ? [
          ...new Set(
            Object.values(compiled.model.habitats).flatMap((habitat) =>
              Object.keys(habitat.capacity),
            ),
          ),
        ].sort()
      : [],
  };
}

export {
  explainFlows,
  populationSeries,
  renderCsvReport,
  renderJsonReport,
  renderMarkdownReport,
  resourceSeries,
  verifyRun,
};
