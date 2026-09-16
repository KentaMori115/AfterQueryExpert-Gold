import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  explainEvent,
  explainNeighbours,
  findEvent,
  neighboursOf,
} from "../../src/export/explain.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { quantiseSchedule } from "../../src/timeline/quantise.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { SMPTE_25 } from "../../src/core/timecode.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm, ms } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({
    id: effectId("shell.150"),
    name: "six",
    calibre: calibre(mm(150)),
    breakStyle: "palm",
    hangTime: ms(2400),
  }),
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
]);
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 20),
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
  expect(resolved.diagnostics.errorCount).toBe(0);
  const allocated = allocatePins(resolved.shots, rig);
  return quantiseSchedule(buildSchedule(allocated.assignments), SMPTE_25);
}

const built = scheduleOf(
  [
    "at 20 fire shell.150 from pad.a label opener",
    "at 20.4 fire shell.150 from pad.b",
    "at 90 fire shell.75 from pad.a",
  ].join("\n"),
);

describe("findEvent", () => {
  it("finds a cue by its number on the sheet", () => {
    expect(findEvent(built, "1")?.effectId).toBe("shell.150");
  });

  it("finds a cue by its pin", () => {
    const pin = built.events[0]!;
    expect(findEvent(built, "01.01")).toBe(pin);
    expect(findEvent(built, "M1/1")).toBe(pin);
  });

  it("finds a cue by its label", () => {
    expect(findEvent(built, "opener")?.label).toBe("opener");
  });

  it("finds nothing for a cue that is not there", () => {
    expect(findEvent(built, "99")).toBeUndefined();
    expect(findEvent(built, "nothing")).toBeUndefined();
    expect(findEvent(built, "0")).toBeUndefined();
  });
});

describe("explainEvent", () => {
  const text = explainEvent(findEvent(built, "opener")!, built, { rig });

  it("names the cue, effect, position and pin", () => {
    expect(text).toContain("shell.150 from pad.a");
    expect(text).toContain("01.01");
  });

  it("walks the timing from the break back to the panel", () => {
    expect(text).toContain("cue asks for a break at");
    expect(text).toContain("climb from the mortar");
    expect(text).toContain("so the panel fires at");
  });

  it("quotes the timecode of the ignition", () => {
    expect(text).toMatch(/\d\d:\d\d:\d\d:\d\d/);
  });

  it("gives the envelope, separation and hazard class", () => {
    expect(text).toContain("ball at");
    expect(text).toContain("nfpa-1123");
    expect(text).toContain("UN0335");
  });

  it("gives the module and its limits when it has a rig", () => {
    expect(text).toContain("fc-32");
    expect(text).toContain("outputs at once");
  });

  it("leaves the rig block out with no rig", () => {
    const bare = explainEvent(findEvent(built, "opener")!, built);
    expect(bare).not.toContain("outputs at once");
  });

  it("says so when a cue has no label", () => {
    const withoutLabel = built.events.find(
      (event) => event.label === undefined,
    );
    expect(explainEvent(withoutLabel!, built, { rig })).toContain("none");
  });

  it("takes another separation rule", () => {
    const relaxed = explainEvent(findEvent(built, "opener")!, built, {
      rig,
      rule: "cen-category-4",
    });
    expect(relaxed).toContain("cen-category-4");
  });

  it("skips the climb line for an effect that does not climb", () => {
    const rig2 = rig;
    const ground = scheduleOf("at 20 fire shell.75 from pad.a");
    expect(explainEvent(ground.events[0]!, ground, { rig: rig2 })).toContain(
      "climb from the mortar",
    );
  });
});

describe("neighbours", () => {
  it("finds what fires close to a cue", () => {
    const near = neighboursOf(findEvent(built, "opener")!, built);
    expect(near.length).toBeGreaterThan(0);
  });

  it("does not count the cue itself", () => {
    const cue = findEvent(built, "opener")!;
    expect(neighboursOf(cue, built)).not.toContain(cue);
  });

  it("finds nothing for a cue on its own", () => {
    expect(neighboursOf(built.events[2]!, built)).toEqual([]);
  });

  it("widens with the window", () => {
    const cue = built.events[2]!;
    expect(neighboursOf(cue, built, 200000)).toHaveLength(2);
  });

  it("says so in the table when nothing is near", () => {
    expect(explainNeighbours(built.events[2]!, built)).toContain(
      "nothing else fires",
    );
  });

  it("lists neighbours with their pins", () => {
    const table = explainNeighbours(findEvent(built, "opener")!, built);
    expect(table).toContain("02.01");
  });
});

describe("explaining a cue that is standing in", () => {
  function drawnEvent() {
    const parsed = parseScript(
      new SourceFile("show.pf", "at 20 fire shell.150 from pad.a label opener"),
    );
    const expanded = expandScript(parsed.script.statements, { seed: "t" });
    const resolved = resolveShots(expanded.shots, catalog, rig);
    const drawn = resolved.shots.map((shot) => ({
      ...shot,
      lot: "vn2405",
      substitutedFor: "shell.150.palm",
    }));
    const schedule = quantiseSchedule(
      buildSchedule(allocatePins(drawn, rig).assignments),
      SMPTE_25,
    );
    return { schedule, event: schedule.events[0]! };
  }

  it("says what it is standing in for and which lot it came from", () => {
    const { schedule, event } = drawnEvent();
    const text = explainEvent(event, schedule);
    expect(text).toContain("standing in for");
    expect(text).toContain("shell.150.palm");
    expect(text).toContain("vn2405");
  });

  it("says neither for a cue that was never drawn", () => {
    const schedule = scheduleOf("at 20 fire shell.150 from pad.a");
    const text = explainEvent(schedule.events[0]!, schedule);
    expect(text).not.toContain("standing in for");
    expect(text).not.toContain("lot ");
  });
});
