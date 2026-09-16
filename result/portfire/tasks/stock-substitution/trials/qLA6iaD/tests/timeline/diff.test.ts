import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  changesByPosition,
  describeDiff,
  diffSchedules,
  needsRewiring,
  pinsToVisit,
  positionSummary,
  summariseDiff,
  walkOrder,
} from "../../src/timeline/diff.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
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
  expect(resolved.diagnostics.errorCount).toBe(0);
  const allocated = allocatePins(resolved.shots, rig, { packTight: true });
  return buildSchedule(allocated.assignments);
}

const before = scheduleOf(
  [
    "at 20 fire shell.150 from pad.a pin 1.01",
    "at 22 fire shell.75 from pad.a pin 1.02",
    "at 24 fire shell.75 from pad.b pin 2.01",
  ].join("\n"),
);

describe("diffSchedules", () => {
  it("finds nothing between a show and itself", () => {
    expect(diffSchedules(before, before)).toEqual([]);
    expect(summariseDiff(before, before).identical).toBe(true);
  });

  it("finds a cue that moved in time and by how much", () => {
    const after = scheduleOf(
      [
        "at 21 fire shell.150 from pad.a pin 1.01",
        "at 22 fire shell.75 from pad.a pin 1.02",
        "at 24 fire shell.75 from pad.b pin 2.01",
      ].join("\n"),
    );
    const changes = diffSchedules(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("moved");
    expect(changes[0]?.shiftMs).toBe(1000);
  });

  it("does not call an insertion a renumbering", () => {
    const after = scheduleOf(
      [
        "at 19 fire shell.75 from pad.a pin 1.09",
        "at 20 fire shell.150 from pad.a pin 1.01",
        "at 22 fire shell.75 from pad.a pin 1.02",
        "at 24 fire shell.75 from pad.b pin 2.01",
      ].join("\n"),
    );
    const changes = diffSchedules(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("added");
    expect(changes[0]?.address).toBe("01.09");
  });

  it("finds a cue that went away", () => {
    const after = scheduleOf(
      [
        "at 20 fire shell.150 from pad.a pin 1.01",
        "at 24 fire shell.75 from pad.b pin 2.01",
      ].join("\n"),
    );
    const changes = diffSchedules(before, after);
    expect(changes[0]?.kind).toBe("removed");
    expect(changes[0]?.address).toBe("01.02");
  });

  it("finds an effect swapped onto the same pin", () => {
    const after = scheduleOf(
      [
        "at 20 fire shell.150 from pad.a pin 1.01",
        "at 22 fire shell.150 from pad.a pin 1.02",
        "at 24 fire shell.75 from pad.b pin 2.01",
      ].join("\n"),
    );
    const changes = diffSchedules(before, after);
    expect(changes[0]?.kind).toBe("swapped");
    expect(changes[0]?.wasEffectId).toBe("shell.75");
  });

  it("ignores a move of less than a millisecond", () => {
    expect(diffSchedules(before, before)).toEqual([]);
  });

  it("sorts changes by pin", () => {
    const after = scheduleOf(
      [
        "at 20 fire shell.150 from pad.a pin 1.01",
        "at 25 fire shell.75 from pad.b pin 2.01",
      ].join("\n"),
    );
    const changes = diffSchedules(before, after);
    expect(changes.map((change) => change.address)).toEqual(["01.02", "02.01"]);
  });
});

describe("summariseDiff", () => {
  it("counts each kind of change", () => {
    const after = scheduleOf(
      [
        "at 21 fire shell.150 from pad.a pin 1.01",
        "at 22 fire shell.150 from pad.a pin 1.02",
        "at 30 fire shell.75 from pad.a pin 1.09",
      ].join("\n"),
    );
    const summary = summariseDiff(before, after);
    expect(summary.moved).toBe(1);
    expect(summary.swapped).toBe(1);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.identical).toBe(false);
  });

  it("counts the cues nothing happened to", () => {
    const after = scheduleOf(
      [
        "at 21 fire shell.150 from pad.a pin 1.01",
        "at 22 fire shell.75 from pad.a pin 1.02",
        "at 24 fire shell.75 from pad.b pin 2.01",
      ].join("\n"),
    );
    expect(summariseDiff(before, after).unchanged).toBe(2);
  });
});

describe("rewiring", () => {
  it("says a show of moves needs no rewiring", () => {
    const after = scheduleOf(
      [
        "at 21 fire shell.150 from pad.a pin 1.01",
        "at 23 fire shell.75 from pad.a pin 1.02",
        "at 25 fire shell.75 from pad.b pin 2.01",
      ].join("\n"),
    );
    const changes = diffSchedules(before, after);
    expect(changes).toHaveLength(3);
    expect(needsRewiring(changes)).toBe(false);
    expect(pinsToVisit(changes)).toEqual([]);
  });

  it("says an added cue does need a visit", () => {
    const after = scheduleOf(
      [
        "at 20 fire shell.150 from pad.a pin 1.01",
        "at 22 fire shell.75 from pad.a pin 1.02",
        "at 24 fire shell.75 from pad.b pin 2.01",
        "at 30 fire shell.75 from pad.b pin 2.09",
      ].join("\n"),
    );
    const changes = diffSchedules(before, after);
    expect(needsRewiring(changes)).toBe(true);
    expect(pinsToVisit(changes)).toEqual(["02.09"]);
  });
});

describe("reports", () => {
  const after = scheduleOf(
    [
      "at 21 fire shell.150 from pad.a pin 1.01",
      "at 22 fire shell.150 from pad.a pin 1.02",
      "at 30 fire shell.75 from pad.b pin 2.09",
    ].join("\n"),
  );
  const changes = diffSchedules(before, after);

  it("says so when nothing changed", () => {
    expect(describeDiff([])).toBe("nothing changed");
  });

  it("shows the shift of a move with a sign", () => {
    expect(describeDiff(changes)).toContain("+1000ms");
  });

  it("shows what a swap replaced", () => {
    expect(describeDiff(changes)).toContain("was shell.75");
  });

  it("groups changes by position", () => {
    const groups = changesByPosition(changes, after);
    expect(groups.get("pad.a")?.length).toBeGreaterThan(0);
  });

  it("summarises per position", () => {
    const lines = positionSummary(changes, after);
    expect(lines.some((line) => line.startsWith("pad.a"))).toBe(true);
  });

  it("puts the rewiring list in pin order", () => {
    const walk = walkOrder(changes, after);
    expect([...walk].sort()).toEqual(walk);
  });

  it("leaves moves out of the walk", () => {
    expect(walkOrder(changes, after)).not.toContain("01.01");
  });
});
