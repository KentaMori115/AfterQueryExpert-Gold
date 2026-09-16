import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  beatsOf,
  litPerSlice,
  previewChart,
  previewStart,
  storyboard,
} from "../../src/sim/preview.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm, ms, raw } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({
    id: effectId("shell.150"),
    name: "six",
    calibre: calibre(mm(150)),
    breakStyle: "palm",
    hangTime: ms(2000),
  }),
  shell({
    id: effectId("shell.75"),
    name: "three",
    calibre: calibre(mm(75)),
    breakStyle: "peony",
    hangTime: ms(1500),
  }),
]);
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 0),
  ],
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-32")!, positionId("pad.b")),
  ],
);

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

const built = scheduleOf(
  [
    "at 10 fire shell.150 from pad.a",
    "at 10.2 fire shell.150 from pad.b",
    "at 20 ripple 4 of shell.75 from pad.a every 300ms",
  ].join("\n"),
);

describe("litPerSlice", () => {
  it("counts what is lit in each slice", () => {
    const counts = litPerSlice(built, 1000);
    expect(counts[0]).toBe(2);
  });

  it("has a slice for the gap in the middle", () => {
    const counts = litPerSlice(built, 1000);
    expect(counts.some((count) => count === 0)).toBe(true);
  });

  it("counts nothing for an empty show", () => {
    expect(litPerSlice(scheduleOf(""), 1000)).toEqual([]);
  });

  it("gives one slice for a very short show", () => {
    expect(
      litPerSlice(scheduleOf("at 10 fire shell.150 from pad.a"), 60000),
    ).toHaveLength(1);
  });
});

describe("previewStart", () => {
  it("is the first visible moment, not the first ignition", () => {
    expect(raw(previewStart(built))).toBe(10000);
  });

  it("is zero for an empty show", () => {
    expect(raw(previewStart(scheduleOf("")))).toBe(0);
  });
});

describe("previewChart", () => {
  it("draws a row per wrap with a time label", () => {
    const chart = previewChart(built, { sliceMs: 1000, width: 8 });
    const rows = chart.split("\n");
    expect(rows[0]).toContain("0:10.000");
    expect(rows.length).toBeGreaterThan(2);
  });

  it("marks the busiest slices with the heaviest block", () => {
    expect(previewChart(built, { sliceMs: 1000 })).toContain("#");
  });

  it("leaves an empty slice blank", () => {
    const chart = previewChart(built, { sliceMs: 1000, width: 40 });
    expect(chart.split("\n")[0]).toContain(" ");
  });

  it("says what a column is worth", () => {
    expect(previewChart(built, { sliceMs: 500 })).toContain(
      "one column is 0.5s",
    );
  });

  it("says so for an empty show", () => {
    expect(previewChart(scheduleOf(""))).toBe("nothing to preview");
  });
});

describe("beatsOf", () => {
  it("groups shots that happen together", () => {
    const beats = beatsOf(built);
    expect(beats[0]?.events).toHaveLength(2);
  });

  it("starts a new moment after a gap", () => {
    expect(beatsOf(built).length).toBeGreaterThan(1);
  });

  it("splits a ripple when the window is tight", () => {
    const ripple = scheduleOf(
      "at 20 ripple 4 of shell.75 from pad.a every 300ms",
    );
    expect(beatsOf(ripple, 100)).toHaveLength(4);
    expect(beatsOf(ripple, 2000)).toHaveLength(1);
  });

  it("anchors a moment at its first shot", () => {
    expect(raw(beatsOf(built)[0]!.at)).toBe(10000);
  });

  it("finds nothing in an empty show", () => {
    expect(beatsOf(scheduleOf(""))).toEqual([]);
  });
});

describe("storyboard", () => {
  it("gives a row per moment with the positions and the effects", () => {
    const board = storyboard(built);
    expect(board).toContain("pad.a pad.b");
    expect(board).toContain("6in palm");
  });

  it("counts repeats rather than listing them", () => {
    const board = storyboard(
      scheduleOf("at 20 fan 4 of shell.75 from pad.a spread 100ms"),
    );
    expect(board).toContain("4 x 3in peony");
  });

  it("says so for an empty show", () => {
    expect(storyboard(scheduleOf(""))).toBe("nothing to preview");
  });
});
