import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import type { Mine } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  TIGHT_MS,
  barPosition,
  beatGrid,
  beatLength,
  checkSync,
  describeSync,
  nearestBeat,
  offBeat,
  snapToBeat,
  steadyGrid,
  syncReport,
} from "../../src/timeline/sync.js";
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

const mine: Mine = {
  kind: "mine",
  id: effectId("mine.100"),
  name: "mine",
  calibre: calibre(mm(100)),
  spreadAngle: 40,
  height: metres(35),
  hangTime: ms(1800),
};
const catalog = Catalog.from([mine]);
const rig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  [firingModule(1, modelNamed("fc-32")!, positionId("pad.a"))],
);

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

const grid = steadyGrid(120);

describe("beatGrid", () => {
  it("refuses an empty grid", () => {
    expect(() => beatGrid([])).toThrow(/at least one/);
  });

  it("refuses a nonsense tempo", () => {
    expect(() => steadyGrid(0)).toThrow(/makes no sense/);
    expect(() => steadyGrid(Number.NaN)).toThrow(/makes no sense/);
  });

  it("refuses a nonsense bar length", () => {
    expect(() => steadyGrid(120, 0)).toThrow(/whole number/);
  });

  it("sorts sections by where they start", () => {
    const built = beatGrid([
      { from: ms(60000), bpm: 140, beatsPerBar: 4 },
      { from: ms(0), bpm: 120, beatsPerBar: 4 },
    ]);
    expect(built.sections[0]?.bpm).toBe(120);
  });
});

describe("beat length", () => {
  it("is half a second at 120", () => {
    expect(raw(beatLength(grid, ms(0)))).toBe(500);
  });

  it("changes with the tempo section", () => {
    const map = beatGrid([
      { from: ms(0), bpm: 120, beatsPerBar: 4 },
      { from: ms(60000), bpm: 60, beatsPerBar: 4 },
    ]);
    expect(raw(beatLength(map, ms(70000)))).toBe(1000);
  });
});

describe("nearestBeat and offBeat", () => {
  it("finds the beat a moment is closest to", () => {
    expect(raw(nearestBeat(grid, ms(1240)))).toBe(1000);
    expect(raw(nearestBeat(grid, ms(1260)))).toBe(1500);
  });

  it("reports a late break as positive", () => {
    expect(raw(offBeat(grid, ms(1060)))).toBe(60);
    expect(raw(offBeat(grid, ms(940)))).toBe(-60);
  });

  it("reports nothing off for a break on the beat", () => {
    expect(raw(offBeat(grid, ms(2000)))).toBe(0);
  });

  it("snaps a moment onto its beat", () => {
    expect(raw(snapToBeat(grid, ms(1060)))).toBe(1000);
  });

  it("uses the section a moment sits in", () => {
    const map = beatGrid([
      { from: ms(0), bpm: 120, beatsPerBar: 4 },
      { from: ms(10000), bpm: 60, beatsPerBar: 4 },
    ]);
    expect(raw(nearestBeat(map, ms(11400)))).toBe(11000);
  });
});

describe("barPosition", () => {
  it("counts bars and beats from one", () => {
    expect(barPosition(grid, ms(0))).toEqual({ bar: 1, beat: 1 });
    expect(barPosition(grid, ms(500))).toEqual({ bar: 1, beat: 2 });
    expect(barPosition(grid, ms(2000))).toEqual({ bar: 2, beat: 1 });
  });

  it("does not fall a beat short from floating point", () => {
    expect(barPosition(grid, ms(1500))).toEqual({ bar: 1, beat: 4 });
  });

  it("clamps before the section start", () => {
    expect(barPosition(grid, ms(-500))).toEqual({ bar: 1, beat: 1 });
  });

  it("counts within a three four bar", () => {
    expect(barPosition(steadyGrid(120, 3), ms(1500))).toEqual({
      bar: 2,
      beat: 1,
    });
  });
});

describe("syncReport", () => {
  it("says a show cut to the beat is on the beat", () => {
    const built = scheduleOf(
      [
        "at 10 fire mine.100 from pad.a",
        "at 10.5 fire mine.100 from pad.a",
      ].join("\n"),
    );
    const report = syncReport(built, grid);
    expect(report.worst).toBe(0);
    expect(report.onBeatFraction).toBe(1);
  });

  it("finds the worst offender and names it", () => {
    const built = scheduleOf(
      [
        "at 10 fire mine.100 from pad.a",
        "at 10.24 fire mine.100 from pad.a",
      ].join("\n"),
    );
    const report = syncReport(built, grid);
    expect(Math.abs(report.worst)).toBe(240);
    expect(report.worstEvent?.effectId).toBe("mine.100");
  });

  it("counts a break inside the tight window as on the beat", () => {
    const built = scheduleOf("at 10.05 fire mine.100 from pad.a");
    expect(syncReport(built, grid).onBeatFraction).toBe(1);
    expect(syncReport(built, grid, 20).onBeatFraction).toBe(0);
  });

  it("calls an empty show perfectly in time", () => {
    const report = syncReport(scheduleOf(""), grid);
    expect(report.onBeatFraction).toBe(1);
    expect(report.worstEvent).toBeUndefined();
  });

  it("uses a tight window of two frames by default", () => {
    expect(TIGHT_MS).toBe(80);
  });
});

describe("checkSync", () => {
  it("says nothing about a tight show", () => {
    const built = scheduleOf("at 10 fire mine.100 from pad.a");
    expect(checkSync(built, grid).size).toBe(0);
  });

  it("warns about a break well off the beat and says which way", () => {
    const built = scheduleOf("at 10.24 fire mine.100 from pad.a");
    const diagnostic = checkSync(built, grid).byCode("PF3300")[0];
    expect(diagnostic?.message).toContain("240ms off the beat");
    expect(diagnostic?.help).toBe("it reads late");
  });

  it("warns when most of the show misses the grid", () => {
    const built = scheduleOf(
      [
        "at 10.2 fire mine.100 from pad.a",
        "at 11.2 fire mine.100 from pad.a",
        "at 12.2 fire mine.100 from pad.a",
      ].join("\n"),
    );
    const diagnostic = checkSync(built, grid).byCode("PF3301")[0];
    expect(diagnostic?.help).toContain("tempo map");
  });

  it("says nothing about an empty show", () => {
    expect(checkSync(scheduleOf(""), grid).size).toBe(0);
  });
});

describe("describeSync", () => {
  it("reads as one line", () => {
    const built = scheduleOf("at 10 fire mine.100 from pad.a");
    expect(describeSync(syncReport(built, grid))).toContain("100% on the beat");
  });
});
