import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import {
  averageDensity,
  busiestSlice,
  checkDensity,
  densityCurve,
  densityReport,
  describeDensity,
  eventsAtPeak,
  visibleWindows,
} from "../../src/timeline/density.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm, ms, raw } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({
    id: effectId("shell.150"),
    name: "six",
    calibre: calibre(mm(150)),
    hangTime: ms(2000),
  }),
]);
const rig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  Array.from({ length: 4 }, (_, i) =>
    firingModule(i + 1, modelNamed("fc-32")!, positionId("pad.a")),
  ),
);

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

describe("visibleWindows", () => {
  it("starts at the break rather than the ignition", () => {
    const built = scheduleOf("at 20 fire shell.150 from pad.a");
    const window = visibleWindows(built)[0]!;
    expect(raw(window.start)).toBe(20000);
    expect(raw(window.end)).toBe(22000);
  });
});

describe("densityReport", () => {
  it("counts one effect at a time in a sparse show", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 30 fire shell.150 from pad.a",
      ].join("\n"),
    );
    expect(densityReport(built).peak).toBe(1);
  });

  it("counts the overlap in a tight run", () => {
    const built = scheduleOf(
      "at 10 ripple 5 of shell.150 from pad.a every 200ms",
    );
    expect(densityReport(built).peak).toBe(5);
  });

  it("measures lit time and span", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 30 fire shell.150 from pad.a",
      ].join("\n"),
    );
    const report = densityReport(built);
    expect(raw(report.litTime)).toBe(4000);
    expect(raw(report.span)).toBe(22000);
    expect(report.coverageFraction).toBeCloseTo(4 / 22, 5);
  });

  it("finds the lulls between effects", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 30 fire shell.150 from pad.a",
      ].join("\n"),
    );
    const report = densityReport(built);
    expect(report.lulls).toHaveLength(1);
    expect(raw(report.longestLull)).toBe(18000);
  });

  it("ignores a gap under the threshold", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 14 fire shell.150 from pad.a",
      ].join("\n"),
    );
    expect(densityReport(built).lulls).toEqual([]);
  });

  it("takes a threshold of its own", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 14 fire shell.150 from pad.a",
      ].join("\n"),
    );
    expect(densityReport(built, ms(1000)).lulls).toHaveLength(1);
  });

  it("reports zeroes for an empty show", () => {
    const report = densityReport(scheduleOf(""));
    expect(report.peak).toBe(0);
    expect(report.coverageFraction).toBe(0);
    expect(report.lulls).toEqual([]);
  });
});

describe("densityCurve", () => {
  it("buckets breaks into slices", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 10.5 fire shell.150 from pad.a",
        "at 30 fire shell.150 from pad.a",
      ].join("\n"),
    );
    const curve = densityCurve(built, 1000);
    expect(curve[0]).toEqual({ at: ms(10000), live: 2 });
    expect(curve[1]).toEqual({ at: ms(30000), live: 1 });
  });

  it("finds the busiest slice", () => {
    const built = scheduleOf(
      "at 10 ripple 6 of shell.150 from pad.a every 100ms",
    );
    expect(busiestSlice(built, 1000)?.live).toBe(6);
  });

  it("finds nothing in an empty show", () => {
    expect(busiestSlice(scheduleOf(""), 1000)).toBeUndefined();
    expect(densityCurve(scheduleOf(""), 1000)).toEqual([]);
    expect(averageDensity(scheduleOf(""))).toBe(0);
  });
});

describe("checkDensity", () => {
  it("warns when too much is lit at once", () => {
    const built = scheduleOf(
      "at 10 ripple 8 of shell.150 from pad.a every 100ms",
    );
    const diagnostics = checkDensity(built, { maxSimultaneous: 4 });
    expect(diagnostics.byCode("PF3200")).toHaveLength(1);
    expect(diagnostics.byCode("PF3200")[0]?.help).toContain("one flash");
  });

  it("says nothing about density when no cap was given", () => {
    const built = scheduleOf(
      "at 10 ripple 8 of shell.150 from pad.a every 100ms",
    );
    expect(checkDensity(built).byCode("PF3200")).toEqual([]);
  });

  it("warns about each lull with its length and start", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 30 fire shell.150 from pad.a",
      ].join("\n"),
    );
    const diagnostic = checkDensity(built).byCode("PF3201")[0];
    expect(diagnostic?.message).toContain("18.0s");
    expect(diagnostic?.message).toContain("0:12.000");
  });

  it("raises nothing for a steady show", () => {
    const built = scheduleOf(
      "at 10 ripple 10 of shell.150 from pad.a every 1s",
    );
    expect(checkDensity(built, { maxSimultaneous: 8 }).size).toBe(0);
  });
});

describe("eventsAtPeak", () => {
  it("names what is lit at the busiest instant", () => {
    const built = scheduleOf(
      "at 10 ripple 4 of shell.150 from pad.a every 200ms",
    );
    expect(eventsAtPeak(built)).toHaveLength(4);
  });

  it("names nothing in an empty show", () => {
    expect(eventsAtPeak(scheduleOf(""))).toEqual([]);
  });
});

describe("describeDensity", () => {
  it("reads as one line", () => {
    const built = scheduleOf("at 10 ripple 3 of shell.150 from pad.a every 1s");
    const line = describeDensity(densityReport(built));
    expect(line).toContain("peak");
    expect(line).toContain("lulls");
  });
});
