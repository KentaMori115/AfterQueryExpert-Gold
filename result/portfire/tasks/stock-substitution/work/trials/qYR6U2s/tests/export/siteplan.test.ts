import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { firingPositionsUsed, sitePlan } from "../../src/export/siteplan.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { boundary, point, site, straightLine } from "../../src/safety/site.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
]);
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), -60, 0),
    firingPosition(positionId("pad.b"), 60, 0),
    firingPosition(positionId("pad.c"), 0, 80),
  ],
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-32")!, positionId("pad.b")),
    firingModule(3, modelNamed("fc-32")!, positionId("pad.c")),
  ],
);
const field = site(
  "meadow",
  straightLine("spectator line", point(-200, -160), point(200, -160)),
  [boundary("river", [point(-200, 140), point(200, 140)], true)],
);

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  return buildSchedule(allocatePins(resolved.shots, rig).assignments);
}

describe("sitePlan", () => {
  const plan = sitePlan(rig, field);

  it("draws a letter for every position", () => {
    expect(plan).toContain("A pad.a");
    expect(plan).toContain("B pad.b");
    expect(plan).toContain("C pad.c");
  });

  it("draws the audience line and the hard boundary", () => {
    expect(plan).toContain("=");
    expect(plan).toContain("#");
  });

  it("carries a key and a scale", () => {
    expect(plan).toContain("north is up");
    expect(plan).toContain("audience line");
  });

  it("puts north at the top", () => {
    const lines = plan.split("\n");
    const riverRow = lines.findIndex((line) => line.includes("#"));
    const audienceRow = lines.findIndex((line) => line.includes("="));
    expect(riverRow).toBeLessThan(audienceRow);
  });

  it("puts east on the right", () => {
    const lines = plan.split("\n");
    const rowWithA = lines.find(
      (line) => line.includes("A") && line.includes("B"),
    );
    expect(rowWithA).toBeDefined();
    expect(rowWithA!.indexOf("A")).toBeLessThan(rowWithA!.indexOf("B"));
  });

  it("takes a width and a height", () => {
    const small = sitePlan(rig, field, undefined, { width: 30, height: 10 });
    const rows = small.split("\n");
    expect(rows[0]!.length).toBeLessThanOrEqual(30);
  });

  it("clamps a nonsense size rather than throwing", () => {
    expect(() =>
      sitePlan(rig, field, undefined, { width: 2, height: 1 }),
    ).not.toThrow();
    expect(() =>
      sitePlan(rig, field, undefined, { width: 5000, height: 5000 }),
    ).not.toThrow();
  });

  function canvasOf(text: string): string {
    const lines = text.split("\n");
    const end = lines.findIndex((line) => line.startsWith("north is up"));
    return lines.slice(0, end === -1 ? lines.length : end).join("\n");
  }

  it("draws separation rings when asked and given a show", () => {
    const built = scheduleOf("at 20 fire shell.150 from pad.a");
    expect(canvasOf(sitePlan(rig, field, built, { rings: true }))).toContain(
      ".",
    );
  });

  it("draws no rings without a show", () => {
    expect(
      canvasOf(sitePlan(rig, field, undefined, { rings: true })),
    ).not.toContain(".");
  });

  it("draws no rings unless asked", () => {
    const built = scheduleOf("at 20 fire shell.150 from pad.a");
    expect(canvasOf(sitePlan(rig, field, built))).not.toContain(".");
  });

  it("copes with an empty rig", () => {
    const bare = sitePlan(new Rig(), field);
    expect(bare).toContain("north is up");
  });

  it("copes with a rig and a site sharing one point", () => {
    const tiny = Rig.from(
      [firingPosition(positionId("pad.a"), 0, 0)],
      [firingModule(1, modelNamed("fc-32")!, positionId("pad.a"))],
    );
    const spot = site(
      "spot",
      straightLine("spectator line", point(0, 0), point(0, 0)),
    );
    expect(() => sitePlan(tiny, spot)).not.toThrow();
  });
});

describe("firingPositionsUsed", () => {
  it("names only the positions a show fires from", () => {
    const built = scheduleOf(
      [
        "at 20 fire shell.150 from pad.a",
        "at 22 fire shell.150 from pad.b",
      ].join("\n"),
    );
    expect(firingPositionsUsed(built)).toEqual(["pad.a", "pad.b"]);
  });

  it("names nothing for an empty show", () => {
    expect(firingPositionsUsed(scheduleOf(""))).toEqual([]);
  });
});
