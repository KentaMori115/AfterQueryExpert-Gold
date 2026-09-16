import { compileCapsule, type CompiledBiome, type ScenarioRecord } from "@biomeweaver/biome-model";
import {
  populationSeries,
  renderCsvReport,
  renderJsonReport,
  renderMarkdownReport,
  resourceSeries,
} from "@biomeweaver/biome-reports";
import { explainFlows, type AttributedFlow } from "@biomeweaver/flow-explanations";
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
