import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  WATCH_WINDOW_MS,
  ambiguousSteps,
  checkRehearsal,
  describeRehearsal,
  rehearsalPlan,
  rehearsalSteps,
  watchersNeeded,
} from "../../src/timeline/rehearsal.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm, raw } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({ id: effectId("s"), name: "s", calibre: calibre(mm(75)) }),
]);

function rigOf(modules: number): Rig {
  return Rig.from(
    [firingPosition(positionId("pad.a"), 0, 0)],
    Array.from({ length: modules }, (_, i) =>
      firingModule(i + 1, modelNamed("slat-50")!, positionId("pad.a")),
    ),
  );
}

function scheduleOf(source: string, rig: Rig, packTight = true) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  return buildSchedule(
    allocatePins(resolved.shots, rig, { packTight }).assignments,
  );
}

describe("rehearsalSteps", () => {
  const rig = rigOf(2);

  it("gives a step per module per moment", () => {
    const built = scheduleOf(
      ["at 10 fire s from pad.a", "at 40 fire s from pad.a"].join("\n"),
      rig,
    );
    const steps = rehearsalSteps(built);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.outputs).toBe(1);
  });

  it("groups cues that a watcher cannot tell apart", () => {
    const built = scheduleOf("at 10 fan 4 of s from pad.a spread 100ms", rig);
    const steps = rehearsalSteps(built);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.outputs).toBe(4);
  });

  it("splits modules within one moment", () => {
    const spread = rigOf(2);
    const built = scheduleOf(
      "at 10 fan 4 of s from pad.a spread 100ms",
      spread,
      false,
    );
    const steps = rehearsalSteps(built);
    expect(steps.map((step) => step.module)).toEqual([1, 2]);
  });

  it("takes its own window", () => {
    const built = scheduleOf("at 10 ripple 4 of s from pad.a every 300ms", rig);
    expect(rehearsalSteps(built, 1000)).toHaveLength(1);
    expect(rehearsalSteps(built, 100)).toHaveLength(4);
  });

  it("names the pins in each step", () => {
    const built = scheduleOf("at 10 fan 3 of s from pad.a spread 50ms", rig);
    expect(rehearsalSteps(built)[0]?.pins).toHaveLength(3);
  });

  it("phrases one light differently from several", () => {
    const one = scheduleOf("at 10 fire s from pad.a", rig);
    const many = scheduleOf("at 10 fan 3 of s from pad.a spread 50ms", rig);
    expect(rehearsalSteps(one)[0]?.expect).toContain("one light");
    expect(rehearsalSteps(many)[0]?.expect).toContain("3 lights");
  });

  it("gives nothing for an empty show", () => {
    expect(rehearsalSteps(scheduleOf("", rig))).toEqual([]);
  });

  it("groups within a quarter second by default", () => {
    expect(WATCH_WINDOW_MS).toBe(250);
  });
});

describe("rehearsalPlan", () => {
  it("counts the watchers needed", () => {
    const rig = rigOf(3);
    const built = scheduleOf(
      "at 10 ripple 6 of s from pad.a every 1s",
      rig,
      false,
    );
    expect(watchersNeeded(built)).toBe(3);
    expect(rehearsalPlan(built, rig).watchers).toBe(3);
  });

  it("names the modules nothing fires from", () => {
    const rig = rigOf(3);
    const built = scheduleOf("at 10 fire s from pad.a", rig);
    expect(rehearsalPlan(built, rig).idleModules).toEqual([2, 3]);
  });

  it("runs to the last step", () => {
    const rig = rigOf(1);
    const built = scheduleOf(
      ["at 10 fire s from pad.a", "at 40 fire s from pad.a"].join("\n"),
      rig,
    );
    expect(raw(rehearsalPlan(built, rig).duration)).toBeGreaterThan(30000);
  });

  it("has no duration for an empty show", () => {
    const rig = rigOf(1);
    expect(raw(rehearsalPlan(scheduleOf("", rig), rig).duration)).toBe(0);
  });
});

describe("checkRehearsal", () => {
  it("notes moments a watcher cannot count", () => {
    const rig = rigOf(1);
    const built = scheduleOf("at 10 fan 5 of s from pad.a spread 100ms", rig);
    const plan = rehearsalPlan(built, rig);
    expect(ambiguousSteps(plan)).toHaveLength(1);
    expect(checkRehearsal(plan).byCode("PF3700")[0]?.help).toContain(
      "panel's own log",
    );
  });

  it("notes idle modules", () => {
    const rig = rigOf(3);
    const built = scheduleOf("at 10 fire s from pad.a", rig);
    expect(
      checkRehearsal(rehearsalPlan(built, rig)).byCode("PF3701"),
    ).toHaveLength(1);
  });

  it("warns when more modules are live than a crew can watch", () => {
    const rig = rigOf(9);
    const built = scheduleOf(
      "at 10 ripple 18 of s from pad.a every 1s",
      rig,
      false,
    );
    const diagnostic = checkRehearsal(rehearsalPlan(built, rig)).byCode(
      "PF3702",
    )[0];
    expect(diagnostic?.help).toContain("in passes");
  });

  it("says nothing about a simple show", () => {
    const rig = rigOf(1);
    const built = scheduleOf(
      ["at 10 fire s from pad.a", "at 40 fire s from pad.a"].join("\n"),
      rig,
    );
    expect(checkRehearsal(rehearsalPlan(built, rig)).size).toBe(0);
  });
});

describe("describeRehearsal", () => {
  it("reads as a table of moments", () => {
    const rig = rigOf(1);
    const built = scheduleOf("at 10 fire s from pad.a", rig);
    const text = describeRehearsal(rehearsalPlan(built, rig));
    expect(text).toContain("watch for");
    expect(text).toContain("one light on module 1");
  });

  it("says so for an empty show", () => {
    const rig = rigOf(1);
    expect(describeRehearsal(rehearsalPlan(scheduleOf("", rig), rig))).toBe(
      "nothing to rehearse",
    );
  });
});
