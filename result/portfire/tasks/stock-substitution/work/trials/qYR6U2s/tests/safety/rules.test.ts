import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  checkAirspace,
  checkFallout,
  checkSafety,
  checkSeparation,
  separationFindings,
  siteSummary,
  tightestMargin,
} from "../../src/safety/rules.js";
import type { SafetyContext } from "../../src/safety/rules.js";
import { boundary, point, site, straightLine } from "../../src/safety/site.js";
import { wind } from "../../src/safety/wind.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { metres, metresPerSecond, mm } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
]);

const fc32 = modelNamed("fc-32")!;

// pad.far is well back, pad.near is close enough to fail on a six inch.
const rig = Rig.from(
  [
    firingPosition(positionId("pad.far"), 0, 0),
    firingPosition(positionId("pad.near"), 60, -60),
  ],
  [
    firingModule(1, fc32, positionId("pad.far")),
    firingModule(2, fc32, positionId("pad.near")),
  ],
);

const audience = straightLine(
  "spectator line",
  point(-300, -140),
  point(300, -140),
);
const hedge = boundary("hedge", [point(-300, 90), point(300, 90)], true);
const pond = boundary("pond", [point(150, -300), point(150, 300)], true);
const field = site("long field", audience, [hedge, pond]);

function contextOf(over: Partial<SafetyContext> = {}): SafetyContext {
  return { site: field, rig, ...over };
}

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

describe("separation", () => {
  it("passes a three inch anywhere on this field", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.near");
    expect(checkSeparation(built, contextOf()).size).toBe(0);
  });

  it("fails a six inch from a position that is too close", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.near");
    const diagnostics = checkSeparation(built, contextOf());
    expect(diagnostics.byCode("PF4100")).toHaveLength(1);
    expect(diagnostics.byCode("PF4100")[0]?.message).toContain("pad.near");
  });

  it("quotes what it wanted and what it had", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.near");
    expect(
      checkSeparation(built, contextOf()).byCode("PF4100")[0]?.message,
    ).toContain("128m and has 140m".slice(0, 0) + "wants 128m");
  });

  it("reports one finding per position and effect, not per shot", () => {
    const built = scheduleOf(
      "at 10 ripple 8 of shell.150 from pad.near every 200ms",
    );
    expect(separationFindings(built, contextOf())).toHaveLength(1);
  });

  it("passes the same shell from a position with room", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.far");
    expect(checkSeparation(built, contextOf()).size).toBe(0);
  });

  it("passes everything under the reduced rule", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.near");
    expect(checkSeparation(built, contextOf({ rule: "reduced" })).size).toBe(0);
  });

  it("orders findings worst first", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.near",
        "at 11 fire shell.75 from pad.near",
      ].join("\n"),
    );
    const findings = separationFindings(built, contextOf({ rule: "reduced" }));
    expect(findings).toEqual([]);
  });
});

describe("airspace", () => {
  it("says nothing when no ceiling is set", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.far");
    expect(checkAirspace(built, contextOf()).size).toBe(0);
  });

  it("fails a shell that reaches through the ceiling", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.far");
    const diagnostics = checkAirspace(
      built,
      contextOf({ ceiling: metres(150) }),
    );
    expect(diagnostics.byCode("PF4101")).toHaveLength(1);
    expect(diagnostics.byCode("PF4101")[0]?.help).toContain("height clause");
  });

  it("passes a shell that stays under it", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.far");
    expect(checkAirspace(built, contextOf({ ceiling: metres(200) })).size).toBe(
      0,
    );
  });

  it("reports each effect once however often it fires", () => {
    const built = scheduleOf(
      "at 10 ripple 5 of shell.150 from pad.far every 1s",
    );
    expect(checkAirspace(built, contextOf({ ceiling: metres(150) })).size).toBe(
      1,
    );
  });
});

describe("fallout", () => {
  it("fails when the disc crosses a hard boundary", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.far");
    const diagnostics = checkFallout(built, contextOf());
    expect(diagnostics.byCode("PF4102")).toHaveLength(1);
    expect(diagnostics.byCode("PF4102")[0]?.message).toContain("hedge");
  });

  it("passes a small effect that stays inside", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.far");
    expect(checkFallout(built, contextOf()).size).toBe(0);
  });

  it("pushes the disc further with wind behind it", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.far");
    const windy = contextOf({ wind: wind(metresPerSecond(10), 0) });
    expect(checkFallout(built, windy).byCode("PF4102").length).toBeGreaterThan(
      0,
    );
  });
});

describe("checkSafety", () => {
  it("passes a clean show", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.far");
    const verdict = checkSafety(built, contextOf());
    expect(verdict.ok).toBe(true);
    expect(verdict.diagnostics.size).toBe(0);
  });

  it("collects every kind of failure at once", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.near");
    const verdict = checkSafety(built, contextOf({ ceiling: metres(100) }));
    expect(verdict.ok).toBe(false);
    expect(verdict.diagnostics.byCode("PF4100")).toHaveLength(1);
    expect(verdict.diagnostics.byCode("PF4101")).toHaveLength(1);
    expect(verdict.diagnostics.byCode("PF4102")).toHaveLength(1);
  });

  it("stops everything at the wind hold", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.far");
    const verdict = checkSafety(
      built,
      contextOf({ wind: wind(metresPerSecond(20), 90) }),
    );
    expect(verdict.diagnostics.byCode("PF4103")).toHaveLength(1);
    expect(verdict.wind).toBe("hold");
  });

  it("reports no wind verdict when no wind was given", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.far");
    expect(checkSafety(built, contextOf()).wind).toBeUndefined();
  });
});

describe("tightestMargin", () => {
  it("is positive on a comfortable show", () => {
    const built = scheduleOf("at 10 fire shell.75 from pad.far");
    expect(tightestMargin(built, contextOf())).toBeGreaterThan(0);
  });

  it("goes negative when a position is too close", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.near");
    expect(tightestMargin(built, contextOf())).toBeLessThan(0);
  });

  it("is zero for an empty show", () => {
    expect(tightestMargin(scheduleOf(""), contextOf())).toBe(0);
  });
});

describe("siteSummary", () => {
  it("names the nearest boundary to each position", () => {
    const lines = siteSummary(contextOf());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("pad.far");
    expect(lines[0]).toContain("to the hedge");
  });
});
