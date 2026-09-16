import { describe, expect, it } from "vitest";
import { generateShow } from "../bench/generate.js";
import { compile } from "../src/compile.js";
import { firingTableCsv } from "../src/export/firingTable.js";
import { cueSheet, wiringSheet } from "../src/export/sheets.js";
import { chainCandidates } from "../src/timeline/chain.js";
import { densityReport } from "../src/timeline/density.js";
import { diffSchedules } from "../src/timeline/diff.js";
import { loadReport } from "../src/timeline/load.js";
import { parseCsv } from "../src/core/csv.js";

/**
 * A show far larger than anybody types, run through the whole pipeline.
 *
 * The budgets are deliberately loose. They exist to catch something going
 * quadratic, not to police milliseconds on a build machine that might be
 * running six other jobs.
 */

const show = generateShow({ shots: 3000, seed: "large" });
const result = compile(show.script, "large.pf", {
  catalog: show.catalog,
  rig: show.rig,
});

describe("a very large show", () => {
  it("compiles without errors", () => {
    expect(result.diagnostics.errorCount).toBe(0);
  });

  it("holds the shots it was asked for", () => {
    expect(result.schedule.events.length).toBeGreaterThan(2900);
  });

  it("gives every cue a distinct pin", () => {
    const pins = new Set(
      result.schedule.events.map(
        (event) => `${event.address.module}:${event.address.pin}`,
      ),
    );
    expect(pins.size).toBe(result.schedule.events.length);
  });

  it("puts every ignition on a frame boundary", () => {
    for (const event of result.schedule.events.slice(0, 200)) {
      expect(Math.abs(Math.round(event.ignitionAt) % 40)).toBe(0);
    }
  });

  it("orders the schedule by ignition", () => {
    let last = Number.NEGATIVE_INFINITY;
    for (const event of result.schedule.events) {
      expect(event.ignitionAt).toBeGreaterThanOrEqual(last);
      last = event.ignitionAt;
    }
  });

  it("compiles the same show twice to the same table", () => {
    const again = compile(show.script, "large.pf", {
      catalog: show.catalog,
      rig: show.rig,
    });
    expect(diffSchedules(result.schedule, again.schedule)).toEqual([]);
  });

  it("writes a firing table with a row per cue", () => {
    const rows = parseCsv(firingTableCsv(result.schedule));
    expect(rows).toHaveLength(result.schedule.events.length + 1);
  });

  it("writes a cue sheet and a wiring sheet", () => {
    expect(cueSheet(result.schedule).split("\n").length).toBeGreaterThan(2900);
    expect(wiringSheet(result.schedule, show.rig)).toContain("module 1");
  });

  it("reports density and load without falling over", () => {
    expect(densityReport(result.schedule).peak).toBeGreaterThan(0);
    expect(loadReport(result.schedule, show.rig).length).toBeGreaterThan(0);
  });

  it("finds chains worth cutting fuse for", () => {
    expect(chainCandidates(result.schedule).length).toBeGreaterThan(0);
  });
});

describe("it does not go quadratic", () => {
  function timeCompile(shots: number): number {
    const built = generateShow({ shots, seed: "timing" });
    const started = performance.now();
    compile(built.script, "t.pf", {
      catalog: built.catalog,
      rig: built.rig,
    });
    return performance.now() - started;
  }

  it("grows roughly with the show rather than with its square", () => {
    const small = Math.max(1, timeCompile(500));
    const large = Math.max(1, timeCompile(4000));
    // Eight times the shots. Linear would be about eight, quadratic sixty
    // four. Twenty five leaves plenty of room for a noisy machine.
    expect(large / small).toBeLessThan(25);
  });
});
