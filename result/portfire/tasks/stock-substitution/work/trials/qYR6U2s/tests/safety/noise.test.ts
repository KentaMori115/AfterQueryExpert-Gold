import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { GroundPiece } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  checkNoise,
  combineLevels,
  describeNoise,
  fitsBeforeCurfew,
  largestQuietCalibre,
  levelAt,
  levelAtTenFor,
  loudestMoment,
  noiseFindings,
  peakLevel,
  usableLimit,
} from "../../src/safety/noise.js";
import type { NoiseContext } from "../../src/safety/noise.js";
import { boundary, point } from "../../src/safety/site.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";
import { standardCalibres } from "../../src/catalog/calibre.js";

const gerb: GroundPiece = {
  kind: "ground",
  id: effectId("gerb.silver"),
  name: "gerb",
  style: "gerb",
  duration: ms(20000),
  height: metres(4),
};
const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
  shell({
    id: effectId("shell.150.salute"),
    name: "six salute",
    calibre: calibre(mm(150)),
    breakStyle: "salute",
  }),
  gerb,
]);

const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 0, 100),
  ],
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-32")!, positionId("pad.b")),
  ],
);

const cottage = boundary("cottage", [point(-500, 200), point(500, 200)]);

function contextOf(over: Partial<NoiseContext> = {}): NoiseContext {
  return { rig, sensitive: cottage, ...over };
}

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

describe("levelAtTenFor", () => {
  it("gets louder with the bore", () => {
    const three = catalog.get("shell.75")!;
    const six = catalog.get("shell.150")!;
    expect(levelAtTenFor(six)).toBeGreaterThan(levelAtTenFor(three));
  });

  it("makes a salute the loudest thing on the field", () => {
    expect(levelAtTenFor(catalog.get("shell.150.salute")!)).toBeGreaterThan(
      levelAtTenFor(catalog.get("shell.150")!) + 10,
    );
  });

  it("keeps a ground piece well below a shell", () => {
    expect(levelAtTenFor(gerb)).toBeLessThan(
      levelAtTenFor(catalog.get("shell.75")!),
    );
  });
});

describe("levelAt", () => {
  it("is the reference level at ten metres", () => {
    expect(levelAt(120, metres(10))).toBeCloseTo(120, 6);
  });

  it("drops six decibels for every doubling", () => {
    expect(levelAt(120, metres(20))).toBeCloseTo(120 - 6.02, 1);
    expect(levelAt(120, metres(40))).toBeCloseTo(120 - 12.04, 1);
  });

  it("does not divide by zero at the source", () => {
    expect(Number.isFinite(levelAt(120, metres(0)))).toBe(true);
  });
});

describe("combineLevels", () => {
  it("adds three decibels for two equal sources", () => {
    expect(combineLevels([100, 100])).toBeCloseTo(103.01, 1);
  });

  it("barely moves for one much quieter source", () => {
    expect(combineLevels([100, 70])).toBeCloseTo(100, 1);
  });

  it("is nothing for no sources", () => {
    expect(combineLevels([])).toBe(0);
  });
});

describe("noiseFindings", () => {
  it("measures each effect from its own position", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.150 from pad.a",
        "at 12 fire shell.150 from pad.b",
      ].join("\n"),
    );
    const findings = noiseFindings(built, contextOf());
    expect(findings).toHaveLength(2);
    const near = findings.find((f) => f.position === "pad.b");
    const far = findings.find((f) => f.position === "pad.a");
    expect(near!.level).toBeGreaterThan(far!.level);
  });

  it("orders findings loudest first", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.75 from pad.a",
        "at 12 fire shell.150.salute from pad.a",
      ].join("\n"),
    );
    expect(noiseFindings(built, contextOf())[0]?.effectId).toBe(
      "shell.150.salute",
    );
  });

  it("reports one finding per effect and position", () => {
    const built = scheduleOf(
      "at 10 ripple 8 of shell.150 from pad.a every 500ms",
    );
    expect(noiseFindings(built, contextOf())).toHaveLength(1);
  });

  it("finds nothing in an empty show", () => {
    expect(noiseFindings(scheduleOf(""), contextOf())).toEqual([]);
  });
});

describe("peakLevel", () => {
  it("is louder for several shells at once than for one", () => {
    const one = scheduleOf("at 10 fire shell.150 from pad.a");
    const many = scheduleOf("at 10 fan 6 of shell.150 from pad.a spread 50ms");
    expect(peakLevel(many, contextOf())).toBeGreaterThan(
      peakLevel(one, contextOf()),
    );
  });

  it("does not add shells that are seconds apart", () => {
    const one = scheduleOf("at 10 fire shell.150 from pad.a");
    const spread = scheduleOf(
      "at 10 ripple 6 of shell.150 from pad.a every 2s",
    );
    expect(peakLevel(spread, contextOf())).toBeCloseTo(
      peakLevel(one, contextOf()),
      6,
    );
  });

  it("is zero for an empty show", () => {
    expect(peakLevel(scheduleOf(""), contextOf())).toBe(0);
  });
});

describe("checkNoise", () => {
  const built = scheduleOf("at 10 fire shell.150.salute from pad.b");

  it("says nothing when no limit is set", () => {
    expect(checkNoise(built, contextOf()).size).toBe(0);
  });

  it("fails a show over the limit", () => {
    const diagnostics = checkNoise(built, contextOf({ limit: 80 }));
    expect(diagnostics.byCode("PF4200")).toHaveLength(1);
    expect(diagnostics.byCode("PF4200")[0]?.help).toContain("salutes");
  });

  it("warns when a show is close to the limit", () => {
    const peak = peakLevel(built, contextOf());
    const diagnostics = checkNoise(built, contextOf({ limit: peak + 2 }));
    expect(diagnostics.byCode("PF4201")).toHaveLength(1);
    expect(diagnostics.hasErrors()).toBe(false);
  });

  it("passes a show well inside the limit", () => {
    expect(checkNoise(built, contextOf({ limit: 140 })).size).toBe(0);
  });

  it("names the individual effects that break the limit", () => {
    expect(
      checkNoise(built, contextOf({ limit: 80 })).byCode("PF4202").length,
    ).toBeGreaterThan(0);
  });
});

describe("planning helpers", () => {
  it("finds the largest bore that stays quiet enough", () => {
    const loud = largestQuietCalibre(140, metres(100), standardCalibres());
    const quiet = largestQuietCalibre(95, metres(100), standardCalibres());
    expect(raw(loud!.size)).toBeGreaterThan(raw(quiet!.size));
  });

  it("finds nothing when even the smallest is too loud", () => {
    expect(
      largestQuietCalibre(20, metres(10), standardCalibres()),
    ).toBeUndefined();
  });

  it("says whether a show fits before a curfew", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.a");
    expect(fitsBeforeCurfew(built, 0, 60000)).toBe(true);
    expect(fitsBeforeCurfew(built, 0, 5000)).toBe(false);
  });

  it("clamps a licence figure into something a meter reads", () => {
    expect(usableLimit(10)).toBe(60);
    expect(usableLimit(500)).toBe(140);
    expect(usableLimit(95)).toBe(95);
  });
});

describe("reports", () => {
  it("describes the noise in one line", () => {
    const built = scheduleOf("at 10 fire shell.150 from pad.a");
    const line = describeNoise(built, contextOf());
    expect(line).toContain("peak");
    expect(line).toContain("loudest single effect shell.150");
  });

  it("says so for an empty show", () => {
    expect(describeNoise(scheduleOf(""), contextOf())).toContain(
      "nothing to measure",
    );
    expect(loudestMoment(scheduleOf(""), contextOf())).toBe("nothing");
  });

  it("names the moment of the loudest effect", () => {
    const built = scheduleOf(
      [
        "at 10 fire shell.75 from pad.a",
        "at 30 fire shell.150.salute from pad.b",
      ].join("\n"),
    );
    expect(loudestMoment(built, contextOf())).toBe("0:30.000");
  });
});
