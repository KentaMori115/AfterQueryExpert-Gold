import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { Mine } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import {
  absorbPreRoll,
  buildSchedule,
  eventsAt,
  eventsFrom,
  eventsOn,
  ignitionsBetween,
  longestLead,
  shiftSchedule,
} from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";

const fc32 = modelNamed("fc-32")!;
const mine: Mine = {
  kind: "mine",
  id: effectId("mine.100"),
  name: "mine",
  calibre: calibre(mm(100)),
  spreadAngle: 40,
  height: metres(35),
  hangTime: ms(1800),
};

const catalog = Catalog.from([
  shell({
    id: effectId("shell.150"),
    name: "six",
    calibre: calibre(mm(150)),
    hangTime: ms(2400),
  }),
  shell({
    id: effectId("shell.300"),
    name: "twelve",
    calibre: calibre(mm(300)),
  }),
  mine,
]);

const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 0),
  ],
  [
    firingModule(1, fc32, positionId("pad.a")),
    firingModule(2, fc32, positionId("pad.b")),
  ],
);

function schedule(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  const allocated = allocatePins(resolved.shots, rig);
  expect(allocated.diagnostics.errorCount).toBe(0);
  return buildSchedule(allocated.assignments);
}

describe("compensation", () => {
  it("fires a shell early enough to break on its cue", () => {
    const built = schedule("at 20 fire shell.150 from pad.a");
    const event = built.events[0]!;
    expect(raw(event.visibleAt)).toBe(20000);
    expect(raw(event.ignitionAt)).toBe(20000 - 4030);
  });

  it("fires a mine almost on its cue", () => {
    const built = schedule("at 20 fire mine.100 from pad.a");
    expect(raw(built.events[0]!.ignitionAt)).toBe(20000 - 30);
  });

  it("applies a lowered break to the compensation", () => {
    const full = schedule("at 20 fire shell.150 from pad.a");
    const low = schedule("at 20 fire shell.150 from pad.a height 45");
    expect(raw(low.events[0]!.ignitionAt)).toBeGreaterThan(
      raw(full.events[0]!.ignitionAt),
    );
  });

  it("carries the lowered break onto the effect it schedules", () => {
    const low = schedule("at 20 fire shell.150 from pad.a height 45");
    const effect = low.events[0]!.effect;
    expect(effect.kind).toBe("shell");
    if (effect.kind === "shell") {
      expect(raw(effect.breakHeight!)).toBe(45);
    }
  });

  it("does not put a height on an effect that has no break", () => {
    const built = schedule("at 20 fire mine.100 from pad.a height 45");
    expect(built.events[0]!.effect.kind).toBe("mine");
  });
});

describe("ordering", () => {
  it("sorts by ignition rather than by cue time", () => {
    const built = schedule(
      [
        "at 20 fire mine.100 from pad.a",
        "at 18 fire shell.300 from pad.b",
      ].join("\n"),
    );
    expect(built.events.map((event) => event.effectId)).toEqual([
      "shell.300",
      "mine.100",
    ]);
  });

  it("breaks a tie by pin", () => {
    const built = schedule(
      ["at 20 fire mine.100 from pad.b", "at 20 fire mine.100 from pad.a"].join(
        "\n",
      ),
    );
    expect(built.events.map((event) => event.address.module)).toEqual([1, 2]);
  });
});

describe("pre roll", () => {
  it("is zero when nothing fires before the clock", () => {
    expect(raw(schedule("at 20 fire shell.150 from pad.a").preRoll)).toBe(0);
  });

  it("is the earliest ignition when a big shell opens the show", () => {
    const built = schedule("at 1 fire shell.300 from pad.a");
    expect(raw(built.preRoll)).toBeGreaterThan(5000);
    expect(raw(built.events[0]!.ignitionAt)).toBeLessThan(0);
  });

  it("can be absorbed by moving the whole show", () => {
    const built = absorbPreRoll(schedule("at 1 fire shell.300 from pad.a"));
    expect(raw(built.preRoll)).toBe(0);
    expect(raw(built.events[0]!.ignitionAt)).toBe(0);
  });

  it("leaves a show with no pre roll alone", () => {
    const built = schedule("at 20 fire shell.150 from pad.a");
    expect(absorbPreRoll(built)).toBe(built);
  });
});

describe("duration", () => {
  it("runs from the first ignition to the last light out", () => {
    const built = schedule("at 20 fire shell.150 from pad.a");
    expect(raw(built.duration)).toBe(4030 + 2400);
  });

  it("is nothing for an empty show", () => {
    expect(raw(schedule("").duration)).toBe(0);
    expect(raw(schedule("").preRoll)).toBe(0);
  });
});

describe("shifting", () => {
  it("moves every time by the same amount", () => {
    const built = shiftSchedule(
      schedule("at 20 fire mine.100 from pad.a"),
      ms(5000),
    );
    expect(raw(built.events[0]!.visibleAt)).toBe(25000);
    expect(raw(built.events[0]!.occupancy.start)).toBe(24970);
  });
});

describe("queries", () => {
  const built = schedule(
    [
      "at 20 fire shell.150 from pad.a",
      "at 21 fire mine.100 from pad.b",
      "at 40 fire mine.100 from pad.a",
    ].join("\n"),
  );

  it("finds what is live at an instant", () => {
    expect(eventsAt(built, ms(20500)).map((e) => e.effectId)).toEqual([
      "shell.150",
    ]);
    expect(eventsAt(built, ms(100000))).toEqual([]);
  });

  it("finds the ignitions in a window", () => {
    expect(ignitionsBetween(built, ms(0), ms(21000))).toHaveLength(2);
    expect(ignitionsBetween(built, ms(0), ms(16000))).toHaveLength(1);
  });

  it("finds the events on a module and at a position", () => {
    expect(eventsOn(built, 2)).toHaveLength(1);
    expect(eventsFrom(built, "pad.a")).toHaveLength(2);
  });

  it("finds the shell that has to go up first", () => {
    expect(longestLead(built)?.effectId).toBe("shell.150");
    expect(longestLead(schedule(""))).toBeUndefined();
  });
});
