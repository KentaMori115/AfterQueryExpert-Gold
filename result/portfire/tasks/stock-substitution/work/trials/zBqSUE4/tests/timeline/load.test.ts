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
  checkLoad,
  crowdedEvents,
  describeLoad,
  loadReport,
  moduleLoad,
  showPeak,
} from "../../src/timeline/load.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { amperes, metres, mm, ms, raw } from "../../src/core/units.js";

const fc32 = modelNamed("fc-32")!;
const slat = modelNamed("slat-50")!;
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

function rigOf(modules: number, model = fc32): Rig {
  return Rig.from(
    [firingPosition(positionId("pad.a"), 0, 0)],
    Array.from({ length: modules }, (_, i) =>
      firingModule(i + 1, model, positionId("pad.a")),
    ),
  );
}

function scheduleOf(source: string, rig: Rig, packTight = true) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig, { packTight });
  return buildSchedule(allocated.assignments);
}

describe("moduleLoad", () => {
  const rig = rigOf(1);
  const unit = rig.module(1)!;

  it("counts one output for a single cue", () => {
    const built = scheduleOf("at 10 fire mine.100 from pad.a", rig);
    const report = moduleLoad(built.events, unit);
    expect(report.peakSimultaneous).toBe(1);
    expect(report.overSimultaneous).toBe(false);
  });

  it("counts outputs that overlap inside one pulse", () => {
    const built = scheduleOf(
      "at 10 ripple 4 of mine.100 from pad.a every 10ms",
      rig,
    );
    const report = moduleLoad(built.events, unit);
    expect(report.peakSimultaneous).toBe(4);
  });

  it("does not count cues further apart than the pulse", () => {
    const built = scheduleOf(
      "at 10 ripple 4 of mine.100 from pad.a every 200ms",
      rig,
    );
    expect(moduleLoad(built.events, unit).peakSimultaneous).toBe(1);
  });

  it("flags a module asked for more than it can do", () => {
    const built = scheduleOf(
      "at 10 ripple 12 of mine.100 from pad.a every 2ms",
      rig,
    );
    const report = moduleLoad(built.events, unit);
    expect(report.peakSimultaneous).toBeGreaterThan(report.limit);
    expect(report.overSimultaneous).toBe(true);
  });

  it("scales the peak current with the outputs live", () => {
    const built = scheduleOf(
      "at 10 ripple 4 of mine.100 from pad.a every 5ms",
      rig,
    );
    const report = moduleLoad(built.events, unit);
    expect(raw(report.peakCurrent)).toBeCloseTo(4 * 1.2, 5);
  });

  it("goes over the supply without going over the output limit", () => {
    const wide = rigOf(1, slat);
    const built = scheduleOf(
      "at 10 ripple 20 of mine.100 from pad.a every 1ms",
      wide,
    );
    const report = moduleLoad(built.events, wide.module(1)!, {
      perPin: amperes(2),
    });
    expect(report.overSimultaneous).toBe(false);
    expect(report.overCurrent).toBe(true);
  });

  it("uses the module's own share when no draw is given", () => {
    const wide = rigOf(1, slat);
    const built = scheduleOf(
      "at 10 ripple 20 of mine.100 from pad.a every 1ms",
      wide,
    );
    const report = moduleLoad(built.events, wide.module(1)!);
    expect(report.overCurrent).toBe(false);
  });

  it("reports the instant the peak happens", () => {
    const built = scheduleOf(
      "at 10 ripple 3 of mine.100 from pad.a every 5ms",
      rig,
    );
    expect(raw(moduleLoad(built.events, unit).peakAt)).toBe(
      10 * 1000 - 30 + 10,
    );
  });
});

describe("loadReport", () => {
  it("leaves out modules nothing fires from", () => {
    const rig = rigOf(3);
    const built = scheduleOf("at 10 fire mine.100 from pad.a", rig);
    expect(loadReport(built, rig)).toHaveLength(1);
  });

  it("reports every module in use", () => {
    const rig = rigOf(2);
    const built = scheduleOf(
      "at 10 ripple 4 of mine.100 from pad.a every 100ms",
      rig,
      false,
    );
    expect(loadReport(built, rig)).toHaveLength(2);
  });
});

describe("checkLoad", () => {
  it("errors when a module is over its simultaneous limit", () => {
    const rig = rigOf(1);
    const built = scheduleOf(
      "at 10 ripple 12 of mine.100 from pad.a every 2ms",
      rig,
    );
    const diagnostics = checkLoad(built, rig);
    expect(diagnostics.byCode("PF3100")).toHaveLength(1);
    expect(diagnostics.byCode("PF3100")[0]?.help).toContain("more modules");
  });

  it("warns about a supply that cannot hold the draw", () => {
    const wide = rigOf(1, slat);
    const built = scheduleOf(
      "at 10 ripple 20 of mine.100 from pad.a every 1ms",
      wide,
    );
    expect(
      checkLoad(built, wide, { perPin: amperes(2) }).byCode("PF3101"),
    ).toHaveLength(1);
  });

  it("raises nothing for a comfortable show", () => {
    const rig = rigOf(2);
    const built = scheduleOf(
      "at 10 ripple 6 of mine.100 from pad.a every 200ms",
      rig,
    );
    expect(checkLoad(built, rig).size).toBe(0);
  });

  it("names the module in the message", () => {
    const rig = rigOf(1);
    const built = scheduleOf(
      "at 10 ripple 12 of mine.100 from pad.a every 2ms",
      rig,
    );
    expect(checkLoad(built, rig).byCode("PF3100")[0]?.message).toContain(
      "module 1",
    );
  });
});

describe("showPeak", () => {
  it("counts across every module at once", () => {
    const rig = rigOf(3);
    const built = scheduleOf(
      "at 10 ripple 6 of mine.100 from pad.a every 5ms",
      rig,
      false,
    );
    expect(showPeak(built, rig).count).toBe(6);
  });

  it("is zero for an empty show", () => {
    const rig = rigOf(1);
    expect(showPeak(scheduleOf("", rig), rig).count).toBe(0);
  });
});

describe("crowdedEvents", () => {
  it("groups the cues that share a pulse", () => {
    const rig = rigOf(1);
    const built = scheduleOf(
      "at 10 ripple 3 of mine.100 from pad.a every 5ms",
      rig,
    );
    const groups = crowdedEvents(built, rig.module(1)!);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("finds nothing when the cues are spread out", () => {
    const rig = rigOf(1);
    const built = scheduleOf(
      "at 10 ripple 3 of mine.100 from pad.a every 500ms",
      rig,
    );
    expect(crowdedEvents(built, rig.module(1)!)).toEqual([]);
  });
});

describe("describeLoad", () => {
  it("reads as one line and flags an overload", () => {
    const rig = rigOf(1);
    const built = scheduleOf(
      "at 10 ripple 12 of mine.100 from pad.a every 2ms",
      rig,
    );
    const line = describeLoad(moduleLoad(built.events, rig.module(1)!));
    expect(line).toContain("module 1 peak");
    expect(line).toContain("OVER");
  });
});
