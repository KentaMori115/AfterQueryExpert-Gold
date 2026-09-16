import { describe, expect, it } from "vitest";
import { runCommand } from "@biomeweaver/cli";
import { completeBiome } from "../helpers/paths.js";

const root = completeBiome("crystal-tundra");

describe("biomeweaver CLI", () => {
  it("exits 5 for an unknown command", () => {
    const result = runCommand(["dance"]);
    expect(result.exitCode).toBe(5);
  });

  it("describes the crystal-tundra capsule", () => {
    const result = runCommand(["describe", "--root", root]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Crystal Tundra");
  });

  it("shows one species record", () => {
    const result = runCommand(["species", "show", "snow-hare", "--root", root]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Snow Hare");
  });

  it("lists scenarios", () => {
    const result = runCommand(["scenario", "list", "--root", root]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("baseline");
    expect(result.stdout).toContain("long-winter");
  });

  it("simulates baseline for a short tick count", () => {
    const result = runCommand(["simulate", "baseline", "--ticks", "4", "--root", root]);
    expect([0, 2]).toContain(result.exitCode);
    expect(result.stdout).toMatch(/run [0-9a-f]+/);
  });

  it("renders a JSON report after simulate", () => {
    const simulated = runCommand(["simulate", "baseline", "--ticks", "3", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1];
    expect(runId).toBeDefined();
    const report = runCommand(["report", runId ?? "", "--root", root, "--format", "json"]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("flows");
  });
});
