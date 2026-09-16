import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { matchNamed } from "../../src/rig/circuit.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import {
  END_SLACK_METRES,
  MORTAR_SPACING_METRES,
  SLACK_FACTOR,
  cableByPosition,
  checkWiring,
  describeWiring,
  maxRunMetres,
  runLength,
  runsFor,
  wiringReport,
} from "../../src/rig/wiring.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm, raw } from "../../src/core/units.js";

const standard = matchNamed("standard")!;
const catalog = Catalog.from([
  shell({ id: effectId("s"), name: "s", calibre: calibre(mm(75)) }),
]);

// Module 1 stands at pad.a. Cues from pad.far need a long lead across.
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.far"), 300, 0),
  ],
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-32")!, positionId("pad.far")),
  ],
);

function assignmentsFor(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  return allocatePins(resolved.shots, rig).assignments;
}

describe("runLength", () => {
  it("adds slack for the route and for both ends", () => {
    expect(runLength(0)).toBe(END_SLACK_METRES);
    expect(runLength(100)).toBe(100 * SLACK_FACTOR + END_SLACK_METRES);
  });

  it("walks along the rack for a mortar further down it", () => {
    expect(runLength(0, 10)).toBeGreaterThan(runLength(0, 0));
    expect(runLength(0, 10)).toBe(
      10 * MORTAR_SPACING_METRES * SLACK_FACTOR + END_SLACK_METRES,
    );
  });

  it("treats a negative index as the first tube", () => {
    expect(runLength(0, -5)).toBe(END_SLACK_METRES);
  });

  it("never gives a run of nothing", () => {
    expect(runLength(0)).toBeGreaterThan(0);
  });
});

describe("runsFor", () => {
  it("gives a run per cue", () => {
    const runs = runsFor(
      assignmentsFor("at 10 ripple 3 of s from pad.a every 1s"),
      rig,
    );
    expect(runs).toHaveLength(3);
  });

  it("gives a short run when the module is at the position", () => {
    const runs = runsFor(assignmentsFor("at 10 fire s from pad.a"), rig);
    expect(runs[0]?.metres).toBe(END_SLACK_METRES);
  });

  it("gives a longer run to each tube further down the rack", () => {
    const runs = runsFor(
      assignmentsFor("at 10 ripple 20 of s from pad.a every 1s"),
      rig,
    );
    expect(runs[19]!.metres).toBeGreaterThan(runs[0]!.metres);
  });

  it("counts the rack position separately at each position", () => {
    const runs = runsFor(
      assignmentsFor(
        ["at 10 fire s from pad.a", "at 11 fire s from pad.far"].join("\n"),
      ),
      rig,
    );
    expect(runs[0]?.metres).toBe(runs[1]?.metres);
  });

  it("computes the resistance of both legs", () => {
    const runs = runsFor(assignmentsFor("at 10 fire s from pad.a"), rig);
    expect(raw(runs[0]!.resistance)).toBeCloseTo(
      END_SLACK_METRES * 2 * 0.07,
      6,
    );
  });

  it("takes another wire gauge", () => {
    const thick = runsFor(assignmentsFor("at 10 fire s from pad.a"), rig, 0.02);
    const thin = runsFor(assignmentsFor("at 10 fire s from pad.a"), rig, 0.2);
    expect(raw(thick[0]!.resistance)).toBeLessThan(raw(thin[0]!.resistance));
  });
});

describe("wiringReport", () => {
  it("counts both legs in the total", () => {
    const report = wiringReport(assignmentsFor("at 10 fire s from pad.a"), rig);
    expect(report.totalMetres).toBe(END_SLACK_METRES * 2);
  });

  it("finds the longest run", () => {
    const report = wiringReport(
      assignmentsFor("at 10 ripple 30 of s from pad.a every 1s"),
      rig,
    );
    expect(report.longest?.metres).toBeGreaterThan(50);
    expect(raw(report.worstResistance)).toBeGreaterThan(0);
  });

  it("reports nothing for a show with no cues", () => {
    const report = wiringReport([], rig);
    expect(report.totalMetres).toBe(0);
    expect(report.longest).toBeUndefined();
    expect(raw(report.worstResistance)).toBe(0);
  });
});

describe("checkWiring", () => {
  it("passes a short run", () => {
    const report = wiringReport(assignmentsFor("at 10 fire s from pad.a"), rig);
    expect(checkWiring(report, standard, 24).size).toBe(0);
  });

  it("fails a run too long for the match to fire over", () => {
    const report = wiringReport(
      assignmentsFor("at 10 ripple 32 of s from pad.a every 1s"),
      rig,
    );
    const diagnostics = checkWiring(report, standard, 2);
    expect(diagnostics.byCode("PF1500").length).toBeGreaterThan(0);
    expect(diagnostics.byCode("PF1500")[0]?.help).toContain("shorten the run");
  });

  it("names the pin so a crew knows which lead to shorten", () => {
    const report = wiringReport(
      assignmentsFor("at 10 ripple 32 of s from pad.a every 1s"),
      rig,
    );
    const message =
      checkWiring(report, standard, 2).byCode("PF1500")[0]?.message ?? "";
    expect(message).toMatch(/^\d\d\.\d\d /);
  });

  it("warns about a run that sits between no fire and all fire", () => {
    const report = wiringReport(
      assignmentsFor("at 10 ripple 32 of s from pad.a every 1s"),
      rig,
    );
    const diagnostics = checkWiring(report, standard, 6);
    expect(diagnostics.byCode("PF1501").length).toBeGreaterThan(0);
    expect(diagnostics.hasErrors()).toBe(false);
    expect(diagnostics.byCode("PF1501")[0]?.help).toContain("in the cold");
  });

  it("passes the same run at a higher voltage", () => {
    const report = wiringReport(
      assignmentsFor("at 10 ripple 32 of s from pad.a every 1s"),
      rig,
    );
    expect(checkWiring(report, standard, 2).hasErrors()).toBe(true);
    expect(checkWiring(report, standard, 120).hasErrors()).toBe(false);
  });

  it("fails sooner with several matches in series", () => {
    const report = wiringReport(assignmentsFor("at 10 fire s from pad.a"), rig);
    expect(checkWiring(report, standard, 24, 1).size).toBe(0);
    expect(checkWiring(report, standard, 24, 200).hasErrors()).toBe(true);
  });
});

describe("maxRunMetres", () => {
  it("says how far a match will fire", () => {
    expect(maxRunMetres(standard, 24)).toBeGreaterThan(100);
  });

  it("goes further at a higher voltage and shorter with more matches", () => {
    expect(maxRunMetres(standard, 48)).toBeGreaterThan(
      maxRunMetres(standard, 24),
    );
    expect(maxRunMetres(standard, 24, 0.07, 5)).toBeLessThan(
      maxRunMetres(standard, 24),
    );
  });

  it("gives nothing when the matches alone use the whole budget", () => {
    expect(maxRunMetres(standard, 24, 0.07, 500)).toBe(0);
  });
});

describe("reports", () => {
  it("describes the wiring in one line", () => {
    const report = wiringReport(assignmentsFor("at 10 fire s from pad.a"), rig);
    expect(describeWiring(report)).toContain("1 runs");
    expect(describeWiring(wiringReport([], rig))).toBe("no runs");
  });

  it("totals cable by position", () => {
    const report = wiringReport(
      assignmentsFor(
        ["at 10 fire s from pad.a", "at 11 fire s from pad.far"].join("\n"),
      ),
      rig,
    );
    const table = cableByPosition(report);
    expect(table).toContain("pad.a");
    expect(table).toContain("pad.far");
  });
});
