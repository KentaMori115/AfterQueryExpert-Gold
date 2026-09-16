import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { GroundPiece } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { allocatePins } from "../../src/rig/allocate.js";
import {
  checkLayout,
  describeLayout,
  mixedBorePositions,
  rackNeeds,
  rackTotals,
  tubeOrder,
  tubesPerRack,
  unusedPositions,
} from "../../src/rig/layout.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { metres, mm, ms } from "../../src/core/units.js";

const gerb: GroundPiece = {
  kind: "ground",
  id: effectId("gerb"),
  name: "gerb",
  style: "gerb",
  duration: ms(20000),
  height: metres(4),
};
const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
  gerb,
]);
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 0),
    firingPosition(positionId("pad.c"), 80, 0),
  ],
  [
    firingModule(1, modelNamed("slat-50")!, positionId("pad.a")),
    firingModule(2, modelNamed("slat-50")!, positionId("pad.b")),
    firingModule(3, modelNamed("slat-50")!, positionId("pad.c")),
  ],
);

function assignmentsFor(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  return allocatePins(resolved.shots, rig, { packTight: true }).assignments;
}

describe("tubesPerRack", () => {
  it("fits fewer tubes as the bore grows", () => {
    expect(tubesPerRack(75)).toBeGreaterThan(tubesPerRack(150));
    expect(tubesPerRack(150)).toBeGreaterThan(tubesPerRack(200));
    expect(tubesPerRack(300)).toBe(1);
  });

  it("gives a ground piece a rack of one", () => {
    expect(tubesPerRack(0)).toBe(1);
  });
});

describe("rackNeeds", () => {
  it("counts the racks a run of tubes needs", () => {
    const needs = rackNeeds(
      assignmentsFor("at 10 ripple 13 of shell.75 from pad.a every 1s"),
    );
    expect(needs[0]?.tubes).toBe(13);
    expect(needs[0]?.racks).toBe(2);
  });

  it("keeps bores apart at one position", () => {
    const needs = rackNeeds(
      assignmentsFor(
        [
          "at 10 ripple 4 of shell.75 from pad.a every 1s",
          "at 20 ripple 4 of shell.150 from pad.a every 1s",
        ].join("\n"),
      ),
    );
    expect(needs).toHaveLength(2);
    expect(needs.map((need) => need.boreMm)).toEqual([150, 75]);
  });

  it("keeps positions apart", () => {
    const needs = rackNeeds(
      assignmentsFor(
        [
          "at 10 fire shell.75 from pad.a",
          "at 20 fire shell.75 from pad.b",
        ].join("\n"),
      ),
    );
    expect(needs.map((need) => need.position)).toEqual(["pad.a", "pad.b"]);
  });

  it("lists the pins in wiring order", () => {
    const needs = rackNeeds(
      assignmentsFor("at 10 ripple 4 of shell.75 from pad.a every 1s"),
    );
    const pins = needs[0]!.pins;
    expect(pins.map((pin) => pin.pin)).toEqual([1, 2, 3, 4]);
  });

  it("treats a ground piece as having no bore", () => {
    const needs = rackNeeds(assignmentsFor("at 10 fire gerb from pad.a"));
    expect(needs[0]?.boreMm).toBe(0);
  });

  it("gives nothing for a show with no cues", () => {
    expect(rackNeeds([])).toEqual([]);
  });
});

describe("rackTotals and tubeOrder", () => {
  const assignments = assignmentsFor(
    [
      "at 10 ripple 13 of shell.75 from pad.a every 1s",
      "at 40 ripple 7 of shell.150 from pad.b every 1s",
      "at 60 fire gerb from pad.c",
    ].join("\n"),
  );

  it("totals racks by bore across the show", () => {
    const totals = rackTotals(rackNeeds(assignments));
    expect(totals.get("75mm")).toBe(2);
    expect(totals.get("150mm")).toBe(2);
  });

  it("leaves ground pieces out of the rack order", () => {
    expect(rackTotals(rackNeeds(assignments)).has("0mm")).toBe(false);
  });

  it("counts tubes for the hire order", () => {
    const order = tubeOrder(assignments);
    expect(order.get("75mm")).toBe(13);
    expect(order.get("150mm")).toBe(7);
  });
});

describe("checkLayout", () => {
  it("notes a bore with a lot of spare tubes", () => {
    const needs = rackNeeds(
      assignmentsFor("at 10 ripple 13 of shell.75 from pad.a every 1s"),
    );
    expect(checkLayout(needs).byCode("PF1800")).toHaveLength(1);
  });

  it("says nothing when the racks are nearly full", () => {
    const needs = rackNeeds(
      assignmentsFor("at 10 ripple 24 of shell.75 from pad.a every 1s"),
    );
    expect(checkLayout(needs).byCode("PF1800")).toEqual([]);
  });

  it("warns when a position needs more racks than a crew stands", () => {
    const needs = rackNeeds(
      assignmentsFor("at 10 ripple 49 of shell.150 from pad.a every 1s"),
    );
    const diagnostic = checkLayout(needs).byCode("PF1801")[0];
    expect(diagnostic?.message).toContain("pad.a needs 9 racks");
    expect(diagnostic?.help).toContain("split it");
  });

  it("takes its own cap", () => {
    const needs = rackNeeds(
      assignmentsFor("at 10 ripple 13 of shell.75 from pad.a every 1s"),
    );
    expect(
      checkLayout(needs, { maxRacksPerPosition: 1 }).byCode("PF1801"),
    ).toHaveLength(1);
  });
});

describe("mixedBorePositions", () => {
  it("finds a position carrying two bores", () => {
    const needs = rackNeeds(
      assignmentsFor(
        [
          "at 10 fire shell.75 from pad.a",
          "at 20 fire shell.150 from pad.a",
        ].join("\n"),
      ),
    );
    expect(mixedBorePositions(needs).get("pad.a")).toEqual([150, 75]);
  });

  it("finds none where each position carries one bore", () => {
    const needs = rackNeeds(
      assignmentsFor(
        [
          "at 10 fire shell.75 from pad.a",
          "at 20 fire shell.150 from pad.b",
        ].join("\n"),
      ),
    );
    expect(mixedBorePositions(needs).size).toBe(0);
  });
});

describe("reports", () => {
  it("describes the layout with the pin range", () => {
    const needs = rackNeeds(
      assignmentsFor("at 10 ripple 4 of shell.75 from pad.a every 1s"),
    );
    const table = describeLayout(needs);
    expect(table).toContain("75mm");
    expect(table).toContain("01.01");
    expect(table).toContain("01.04");
  });

  it("names the positions nothing fires from", () => {
    const assignments = assignmentsFor("at 10 fire shell.75 from pad.a");
    expect(unusedPositions(assignments, rig)).toEqual(["pad.b", "pad.c"]);
  });
});
