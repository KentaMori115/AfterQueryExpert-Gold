import { describe, expect, it } from "vitest";
import { completeBiome } from "../../../ecosystem-lab/helpers/paths.js";
import { runCommand } from "./router.js";

const root = completeBiome("crystal-tundra");

describe("public command catalog", () => {
  it("checks a valid capsule", () => {
    expect(runCommand(["check", "--root", root]).exitCode).toBe(0);
  });

  it("lists species in stable order", () => {
    const listed = runCommand(["species", "list", "--root", root]).stdout.trim().split("\n");
    expect(listed).toEqual([...listed].sort((left, right) => left.localeCompare(right)));
  });

  it("shows glass lynx", () => {
    expect(runCommand(["species", "show", "glass-lynx", "--root", root]).stdout).toContain(
      "Glass Lynx",
    );
  });

  it("shows marsh bird", () => {
    expect(runCommand(["species", "show", "marsh-bird", "--root", root]).stdout).toContain(
      "Marsh Bird",
    );
  });

  it("shows dune beetle", () => {
    expect(runCommand(["species", "show", "dune-beetle", "--root", root]).stdout).toContain(
      "Dune Beetle",
    );
  });

  it("rejects an unknown species", () => {
    expect(runCommand(["species", "show", "missing", "--root", root]).exitCode).toBe(3);
  });

  it("simulates habitat-loss", () => {
    expect([0, 2]).toContain(
      runCommand(["simulate", "habitat-loss", "--ticks", "5", "--root", root]).exitCode,
    );
  });

  it("simulates long-winter", () => {
    expect([0, 2]).toContain(
      runCommand(["simulate", "long-winter", "--ticks", "5", "--root", root]).exitCode,
    );
  });

  it("renders a CSV report", () => {
    const simulated = runCommand(["simulate", "baseline", "--ticks", "2", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const report = runCommand(["report", runId, "--root", root, "--format", "csv"]);
    expect(report.stdout).toContain("tick,kind,species");
  });

  it("renders a Markdown report", () => {
    const simulated = runCommand(["simulate", "baseline", "--ticks", "2", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const report = runCommand(["report", runId, "--root", root, "--format", "markdown"]);
    expect(report.stdout).toContain("# Crystal Tundra");
  });

  it("explains snow hare at tick 1", () => {
    const simulated = runCommand(["simulate", "baseline", "--ticks", "2", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const explained = runCommand([
      "explain",
      runId,
      "--species",
      "snow-hare",
      "--tick",
      "1",
      "--root",
      root,
    ]);
    expect(explained.exitCode).toBe(0);
  });

  it("queries a population series", () => {
    const simulated = runCommand(["simulate", "baseline", "--ticks", "2", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const series = runCommand(["population", runId, "snow-hare", "--root", root]);
    expect(series.stdout).toMatch(/0 /);
  });

  it("queries a resource series", () => {
    const simulated = runCommand(["simulate", "baseline", "--ticks", "2", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const series = runCommand(["resource", runId, "silver-grass-biomass", "--root", root]);
    expect(series.stdout).toMatch(/0 /);
  });

  it("verifies a stored snapshot", () => {
    const simulated = runCommand(["simulate", "baseline", "--ticks", "2", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    expect(runCommand(["snapshot", "verify", runId, "--root", root]).exitCode).toBe(0);
  });
});
