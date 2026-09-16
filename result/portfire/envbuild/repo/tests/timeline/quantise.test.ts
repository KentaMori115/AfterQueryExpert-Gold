import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import type { Mine } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import {
  checkQuantisation,
  collapsedPairs,
  driftReport,
  frameRateSuits,
  quantiseSchedule,
  tightestGap,
} from "../../src/timeline/quantise.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { SMPTE_25, SMPTE_30 } from "../../src/core/timecode.js";
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
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-32")!, positionId("pad.a")),
  ],
);

function quantised(source: string, format = SMPTE_25) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig);
  return quantiseSchedule(buildSchedule(allocated.assignments), format);
}

describe("snapping", () => {
  it("puts every ignition on a frame boundary", () => {
    const built = quantised("at 1 ripple 8 of mine.100 from pad.a every 133ms");
    for (const event of built.events) {
      expect(raw(event.ignitionAt) % 40).toBe(0);
    }
  });

  it("moves the visible time by the same amount", () => {
    const built = quantised("at 12.345 fire mine.100 from pad.a");
    const event = built.events[0]!;
    expect(raw(event.visibleAt) - raw(event.ignitionAt)).toBe(30);
  });

  it("moves the occupancy window with it", () => {
    const built = quantised("at 12.345 fire mine.100 from pad.a");
    const event = built.events[0]!;
    expect(raw(event.occupancy.start)).toBe(raw(event.ignitionAt));
  });

  it("records how far each event moved", () => {
    const built = quantised("at 12.345 fire mine.100 from pad.a");
    expect(Math.abs(raw(built.events[0]!.drift))).toBeLessThanOrEqual(20);
  });

  it("leaves an event already on a frame alone", () => {
    const built = quantised("at 12.030 fire mine.100 from pad.a");
    expect(raw(built.events[0]!.drift)).toBe(0);
  });

  it("keeps the pre roll and duration of the schedule it came from", () => {
    const built = quantised("at 12.345 fire mine.100 from pad.a");
    expect(raw(built.preRoll)).toBe(0);
    expect(raw(built.duration)).toBe(1830);
  });

  it("quantises an empty show into nothing", () => {
    expect(quantised("").events).toEqual([]);
  });
});

describe("driftReport", () => {
  it("finds the worst mover and names it", () => {
    const built = quantised("at 1 ripple 6 of mine.100 from pad.a every 133ms");
    const report = driftReport(built);
    expect(report.worst).toBeGreaterThan(0);
    expect(report.worstEvent).toBeDefined();
  });

  it("reports the frame length it snapped to", () => {
    expect(raw(driftReport(quantised("")).frame)).toBe(40);
    expect(raw(driftReport(quantised("", SMPTE_30)).frame)).toBeCloseTo(
      33.333,
      2,
    );
  });

  it("never moves anything by more than half a frame", () => {
    const built = quantised("at 1 ripple 20 of mine.100 from pad.a every 47ms");
    expect(driftReport(built).worst).toBeLessThanOrEqual(20.001);
  });

  it("reports zeroes for an empty show", () => {
    const report = driftReport(quantised(""));
    expect(report.worst).toBe(0);
    expect(report.average).toBe(0);
    expect(report.worstEvent).toBeUndefined();
  });
});

describe("collapsed runs", () => {
  it("finds two cues that land on the same frame", () => {
    const built = quantised("at 1 ripple 4 of mine.100 from pad.a every 10ms");
    expect(collapsedPairs(built).length).toBeGreaterThan(0);
    expect(frameRateSuits(built)).toBe(false);
  });

  it("finds none in a run the frame rate can hold", () => {
    const built = quantised("at 1 ripple 4 of mine.100 from pad.a every 200ms");
    expect(collapsedPairs(built)).toEqual([]);
    expect(frameRateSuits(built)).toBe(true);
  });

  it("warns about a collapsed run and names the first pair", () => {
    const built = quantised("at 1 ripple 4 of mine.100 from pad.a every 10ms");
    const diagnostic = checkQuantisation(built).byCode("PF3001")[0];
    expect(diagnostic?.help).toContain("read as one report");
  });

  it("raises nothing for a comfortable show", () => {
    const built = quantised("at 1 ripple 4 of mine.100 from pad.a every 200ms");
    expect(checkQuantisation(built).size).toBe(0);
  });
});

describe("tightestGap", () => {
  it("finds the closest pair of ignitions", () => {
    const built = quantised(
      ["at 1 fire mine.100 from pad.a", "at 1.2 fire mine.100 from pad.a"].join(
        "\n",
      ),
    );
    expect(raw(tightestGap(built))).toBe(200);
  });

  it("reports nothing for a show with one cue", () => {
    expect(raw(tightestGap(quantised("at 1 fire mine.100 from pad.a")))).toBe(
      0,
    );
  });
});
