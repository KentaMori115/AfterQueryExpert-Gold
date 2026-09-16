import { hasErrorDiagnostics } from "@biomeweaver/capsule-source";
import {
  DEFAULT_SCALE,
  describeBiome,
  explainFlows,
  formatFixed,
  isModifierEffect,
  isQuantityEffect,
  loadBiome,
  populationSeries,
  renderCsvReport,
  renderJsonReport,
  renderMarkdownReport,
  resourceSeries,
  runScenario,
  verifyRun,
  type EventEffect,
} from "biomeweaver";
import { ExitCode } from "./exit-codes.js";
import { parseArgs, UsageError, type GlobalOptions } from "./options.js";

export type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

function result(exitCode: number, stdout = "", stderr = ""): CommandResult {
  return { exitCode, stdout, stderr };
}

function usage(): string {
  return [
    "BiomeWeaver — compile an authored biome and explain every population change",
    "",
    "Usage: biomeweaver <command> [--root <path>] [--format text|json|csv|markdown]",
    "",
    "Commands:",
    "  check",
    "  describe",
    "  species list",
    "  species show <id>",
    "  scenario list",
    "  event list",
    "  event show <id>",
    "  simulate <scenario> [--ticks n]",
    "  run show <run-id>",
    "  population <run-id> <species>",
    "  resource <run-id> <resource>",
    "  explain <run-id> --species <id> --tick <n>",
    "  snapshot verify <run-id>",
    "  report <run-id> --format json|csv|markdown",
    "",
  ].join("\n");
}

function requireModel(options: GlobalOptions) {
  const compiled = loadBiome(options.root);
  if (!compiled.model || hasErrorDiagnostics(compiled.diagnostics)) {
    return {
      error: result(
        ExitCode.INVALID_INPUT,
        "",
        compiled.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n") + "\n",
      ),
    };
  }
  return { compiled };
}

function effectLine(effect: EventEffect, scale: bigint): string {
  const where = effect.region ?? "everywhere";
  const window = `${effect.forTicks} tick${effect.forTicks === 1 ? "" : "s"}`;
  if (isQuantityEffect(effect)) {
    return `resource ${effect.resource} ${formatFixed(effect.quantity, scale)} in ${where} for ${window}`;
  }
  if (isModifierEffect(effect)) {
    return `modifier ${effect.modifier} x${formatFixed(effect.factor, scale)} in ${where} for ${window}`;
  }
  return `effect in ${where} for ${window}`;
}

const cache = new Map<string, ReturnType<typeof runScenario>>();

function cachedRun(options: GlobalOptions, runId: string) {
  const existing = cache.get(runId);
  if (existing) {
    return existing;
  }
  const compiled = loadBiome(options.root);
  const scenarioId = compiled.model?.defaultScenario ?? "baseline";
  const outcome = runScenario(
    options.root,
    scenarioId,
    compiled.model?.scenarios[scenarioId]?.durationTicks,
  );
  cache.set(outcome.runId, outcome);
  cache.set(runId, outcome);
  return outcome;
}

export function runCommand(argv: readonly string[]): CommandResult {
  try {
    const parsed = parseArgs(argv);
    const [head, ...rest] = parsed.command;
    if (head === undefined || head === "help") {
      return result(head === undefined ? ExitCode.INVALID_INVOCATION : ExitCode.OK, usage());
    }
    if (head === "check") {
      const loaded = requireModel(parsed.options);
      if (loaded.error) {
        return loaded.error;
      }
      return result(ExitCode.OK, `ok ${loaded.compiled.model?.fingerprint}\n`);
    }
    if (head === "describe") {
      const description = describeBiome(parsed.options.root);
      if (description.diagnostics.some((item) => item.severity === "error")) {
        return result(
          ExitCode.INVALID_INPUT,
          "",
          description.diagnostics.map((item) => item.message).join("\n") + "\n",
        );
      }
      return result(
        ExitCode.OK,
        `${description.displayName}\n${description.species.join(", ")}\n${description.scenarios.join(", ")}\n`,
      );
    }
    if (head === "species" && rest[0] === "list") {
      const loaded = requireModel(parsed.options);
      if (loaded.error) {
        return loaded.error;
      }
      return result(
        ExitCode.OK,
        `${Object.keys(loaded.compiled.model?.species ?? {})
          .sort()
          .join("\n")}\n`,
      );
    }
    if (head === "species" && rest[0] === "show" && rest[1]) {
      const loaded = requireModel(parsed.options);
      if (loaded.error) {
        return loaded.error;
      }
      const spec = loaded.compiled.model?.species[rest[1]];
      if (!spec) {
        return result(ExitCode.INVALID_INPUT, "", `unknown species ${rest[1]}\n`);
      }
      return result(ExitCode.OK, `${spec.name}\nstages: ${spec.stages.join(", ")}\n`);
    }
    if (head === "scenario" && rest[0] === "list") {
      const loaded = requireModel(parsed.options);
      if (loaded.error) {
        return loaded.error;
      }
      return result(
        ExitCode.OK,
        `${Object.keys(loaded.compiled.model?.scenarios ?? {})
          .sort()
          .join("\n")}\n`,
      );
    }
    if (head === "event" && rest[0] === "list") {
      const loaded = requireModel(parsed.options);
      if (loaded.error) {
        return loaded.error;
      }
      return result(
        ExitCode.OK,
        `${Object.keys(loaded.compiled.model?.events ?? {})
          .sort()
          .join("\n")}\n`,
      );
    }
    if (head === "event" && rest[0] === "show" && rest[1]) {
      const loaded = requireModel(parsed.options);
      if (loaded.error) {
        return loaded.error;
      }
      const event = loaded.compiled.model?.events[rest[1]];
      if (!event) {
        return result(ExitCode.INVALID_INPUT, "", `unknown event ${rest[1]}\n`);
      }
      const scale = loaded.compiled.model?.precision.scale ?? DEFAULT_SCALE;
      return result(
        ExitCode.OK,
        `${event.effects.map((effect) => effectLine(effect, scale)).join("\n")}\n`,
      );
    }
    if (head === "simulate" && rest[0]) {
      const ticksFlag = rest.indexOf("--ticks");
      const ticks = ticksFlag >= 0 ? Number(rest[ticksFlag + 1]) : undefined;
      const outcome = runScenario(
        parsed.options.root,
        rest[0],
        Number.isFinite(ticks) ? ticks : undefined,
      );
      cache.set(outcome.runId, outcome);
      const code = outcome.alerts.length > 0 ? ExitCode.ECOLOGICAL_ALERTS : ExitCode.OK;
      return result(code, `run ${outcome.runId}\nflows ${outcome.flows.length}\n`);
    }
    if (head === "run" && rest[0] === "show" && rest[1]) {
      const outcome = cachedRun(parsed.options, rest[1]);
      return result(ExitCode.OK, `run ${outcome.runId}\nscenario ${outcome.scenario.id}\n`);
    }
    if (head === "population" && rest[0] && rest[1]) {
      const outcome = cachedRun(parsed.options, rest[0]);
      const series = populationSeries(outcome.states, rest[1]);
      return result(ExitCode.OK, series.map((row) => `${row.tick} ${row.count}`).join("\n") + "\n");
    }
    if (head === "resource" && rest[0] && rest[1]) {
      const outcome = cachedRun(parsed.options, rest[0]);
      const series = resourceSeries(outcome.states, rest[1]);
      return result(
        ExitCode.OK,
        series.map((row) => `${row.tick} ${row.quantity}`).join("\n") + "\n",
      );
    }
    if (head === "explain" && rest[0]) {
      const speciesFlag = rest.indexOf("--species");
      const tickFlag = rest.indexOf("--tick");
      const species = speciesFlag >= 0 ? rest[speciesFlag + 1] : undefined;
      const tick = tickFlag >= 0 ? Number(rest[tickFlag + 1]) : undefined;
      if (!species || !Number.isFinite(tick)) {
        return result(ExitCode.INVALID_INVOCATION, "", "explain requires --species and --tick\n");
      }
      const outcome = cachedRun(parsed.options, rest[0]);
      const rows = explainFlows(outcome.flows, species, tick as number);
      return result(
        ExitCode.OK,
        rows.map((flow) => `${flow.cause} ${flow.quantity} ${flow.rule}`).join("\n") + "\n",
      );
    }
    if (head === "snapshot" && rest[0] === "verify" && rest[1]) {
      const verified = verifyRun(parsed.options.root, rest[1]);
      return result(
        verified.ok ? ExitCode.OK : ExitCode.INTEGRITY_FAILURE,
        verified.ok ? "ok\n" : "digest mismatch\n",
      );
    }
    if (head === "report" && rest[0]) {
      const outcome = cachedRun(parsed.options, rest[0]);
      if (parsed.options.format === "csv") {
        return result(ExitCode.OK, renderCsvReport(outcome.flows));
      }
      if (parsed.options.format === "markdown") {
        return result(
          ExitCode.OK,
          renderMarkdownReport(outcome.model.displayName, outcome.states, outcome.flows),
        );
      }
      return result(ExitCode.OK, renderJsonReport(outcome.states, outcome.flows));
    }
    return result(ExitCode.INVALID_INVOCATION, "", usage());
  } catch (error) {
    if (error instanceof UsageError) {
      return result(ExitCode.INVALID_INVOCATION, "", `${error.message}\n`);
    }
    return result(
      ExitCode.INTERNAL_FAILURE,
      "",
      error instanceof Error ? `${error.message}\n` : "internal failure\n",
    );
  }
}
