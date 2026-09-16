import { describe, expect, it } from "vitest";
import { verifyAssertions } from "../support/frozenExpect.js";
import { calibre } from "../../src/catalog/calibre.js";
import type { Mine } from "../../src/catalog/effect.js";
import { shell } from "../../src/catalog/effect.js";
import { hazardTotals, netExplosiveGrams } from "../../src/catalog/hazard.js";
import { Catalog } from "../../src/catalog/registry.js";
import { compile } from "../../src/compile.js";
import type { CompileOptions } from "../../src/compile.js";
import { countBy } from "../../src/core/collect.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";
import { findEvent } from "../../src/export/explain.js";
import { firingTableRows, rowCount } from "../../src/export/firingTable.js";
import { permitFacts } from "../../src/export/permit.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { formatPin } from "../../src/rig/pin.js";
import { planRedundancy, redundancyCost } from "../../src/rig/redundancy.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { point, site, straightLine } from "../../src/safety/site.js";
import { chainCandidates } from "../../src/timeline/chain.js";
import { densityReport } from "../../src/timeline/density.js";
import {
  diffSchedules,
  needsRewiring,
  summariseDiff,
} from "../../src/timeline/diff.js";
import { checkLoad, loadReport } from "../../src/timeline/load.js";
import { checkQuantisation } from "../../src/timeline/quantise.js";
import { rehearsalSteps } from "../../src/timeline/rehearsal.js";

/**
 * What the rest of the compiler makes of a run fired from one output: the
 * panel sees one cue, the sky and the paperwork see every shell.
 */

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
  mine,
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
]);

const fc32 = modelNamed("fc-32")!;

function rigOf(modules: number): Rig {
  return Rig.from(
    [firingPosition(positionId("pad.a"), 0, 0)],
    Array.from({ length: modules }, (_, i) =>
      firingModule(i + 1, fc32, positionId("pad.a")),
    ),
  );
}

const oneModule = rigOf(1);
const twoModules = rigOf(2);

function build(source: string, rig: Rig, extra: Partial<CompileOptions> = {}) {
  return compile(source, "show.pf", {
    catalog,
    rig,
    allocation: { packTight: true },
    density: { lullThreshold: ms(120000) },
    ...extra,
  });
}

const CHAINED = "at 10 ripple 6 of mine.100 from pad.a every 250ms chained";
const LOOSE = "at 10 ripple 6 of mine.100 from pad.a every 250ms";

describe("landing on the panel's clock", () => {
  it("snaps the head onto a frame", () => {
    verifyAssertions();
    const result = build(CHAINED, oneModule);
    expect(result.ok).toBe(true);
    const head = result.schedule.events.find((event) => raw(event.fuse!) === 0);
    expect(head).toBeDefined();
    expect(raw(head!.ignitionAt) % 40).toBe(0);
  });

  it("times every follower off the head by its fuse, not off the clock", () => {
    const result = build(CHAINED, oneModule);
    const events = [...result.schedule.events].sort(
      (a, b) => raw(a.fuse!) - raw(b.fuse!),
    );
    const head = events[0]!;
    for (const event of events) {
      expect(raw(event.ignitionAt)).toBe(
        raw(head.ignitionAt) + raw(event.fuse!),
      );
    }
    // 250ms steps from a frame boundary miss the 40ms grid on all but one
    // shot in four; a run that lands every shot on a frame was snapped twice.
    const offGrid = events.filter((event) => raw(event.ignitionAt) % 40 !== 0);
    expect(offGrid.length).toBeGreaterThan(0);
  });

  it("gives a follower the head's drift as its own", () => {
    const result = build(
      "at 10.045 ripple 5 of mine.100 from pad.a every 250ms chained",
      oneModule,
    );
    const drifts = new Set(
      result.schedule.events.map((event) => raw(event.drift)),
    );
    expect(drifts.size).toBe(1);
    expect([...drifts][0]).not.toBe(0);
  });

  it("raises no frame warning for a run the fuse times", () => {
    const tight = "at 10 ripple 6 of mine.100 from pad.a every 10ms chained";
    const chained = build(tight, oneModule);
    expect(chained.ok).toBe(true);
    expect(checkQuantisation(chained.schedule).size).toBe(0);
    const loose = build(
      "at 10 ripple 6 of mine.100 from pad.a every 10ms",
      oneModule,
    );
    expect(checkQuantisation(loose.schedule).size).toBeGreaterThan(0);
  });

  it("keeps the fuse across a pre roll being absorbed", () => {
    const early = "at 0.5 ripple 4 of shell.150 from pad.a every 300ms chained";
    const result = build(early, oneModule, { absorbPreRoll: true });
    expect(raw(result.preRoll)).toBe(0);
    const events = [...result.schedule.events].sort(
      (a, b) => raw(a.fuse!) - raw(b.fuse!),
    );
    expect(raw(events[0]!.ignitionAt)).toBeGreaterThanOrEqual(0);
    expect(events.map((event) => raw(event.fuse!))).toEqual([0, 300, 600, 900]);
    for (const event of events) {
      expect(raw(event.ignitionAt)).toBe(
        raw(events[0]!.ignitionAt) + raw(event.fuse!),
      );
    }
  });
});

describe("what the module is asked to do", () => {
  it("closes one output for a chained run", () => {
    const fast = "at 9.99 ripple 12 of mine.100 from pad.a every 1ms chained";
    const result = build(fast, oneModule);
    expect(result.ok).toBe(true);
    const report = loadReport(result.schedule, oneModule);
    expect(report).toHaveLength(1);
    expect(report[0]?.peakSimultaneous).toBe(1);
    expect(checkLoad(result.schedule, oneModule).size).toBe(0);
  });

  it("still refuses the same run when it is not chained", () => {
    const fast = "at 9.99 ripple 12 of mine.100 from pad.a every 1ms";
    const result = build(fast, oneModule);
    expect(result.ok).toBe(false);
    expect(loadReport(result.schedule, oneModule)[0]?.peakSimultaneous).toBe(
      12,
    );
    // the same script with the clause is the one output the module can do
    expect(build(`${fast} chained`, oneModule).ok).toBe(true);
  });

  it("shows a watcher one light for the run", () => {
    const result = build(
      [CHAINED, "at 20 fire mine.100 from pad.a"].join("\n"),
      oneModule,
    );
    const steps = rehearsalSteps(result.schedule);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.outputs).toBe(1);
    expect(steps[0]?.pins).toHaveLength(1);
    expect(steps[1]?.outputs).toBe(1);
  });
});

describe("what goes on the panel's card", () => {
  const source = [
    "at 5 fire mine.100 from pad.a label opener",
    CHAINED,
    "at 20 fire shell.75 from pad.a label closer",
  ].join("\n");

  it("writes one row for the run", () => {
    const result = build(source, twoModules);
    expect(result.ok).toBe(true);
    const rows = firingTableRows(result.schedule);
    expect(rows).toHaveLength(3);
    expect(rowCount(result.schedule)).toBe(3);
    expect(rows.map((row) => row[0])).toEqual(["1", "2", "3"]);
  });

  it("puts the head's time and address on that row", () => {
    const result = build(source, twoModules);
    const head = result.schedule.events.find(
      (event) => raw(event.fuse!) === 0,
    )!;
    const row = firingTableRows(result.schedule, {
      timeStyle: "milliseconds",
    })[1]!;
    expect(row[1]).toBe(String(Math.round(raw(head.ignitionAt))));
    expect(row[2]).toBe(formatPin(head.address));
    expect(row[3]).toBe("mine.100");
  });

  it("numbers cues the way the table does when explaining one", () => {
    const result = build(source, twoModules);
    expect(findEvent(result.schedule, "1")?.label).toBe("opener");
    expect(findEvent(result.schedule, "2")?.effectId).toBe("mine.100");
    expect(raw(findEvent(result.schedule, "2")!.fuse!)).toBe(0);
    expect(findEvent(result.schedule, "3")?.label).toBe("closer");
    expect(findEvent(result.schedule, "4")).toBeUndefined();
  });
});

describe("what goes up and what is on paper", () => {
  const field = site(
    "meadow",
    straightLine("spectator line", point(-500, -400), point(500, -400)),
  );

  it("lights every shell of the run", () => {
    const result = build(CHAINED, oneModule);
    expect(densityReport(result.schedule).peak).toBe(6);
  });

  it("consumes a shell per shot", () => {
    const result = build(
      [CHAINED, "at 20 fire shell.75 from pad.a"].join("\n"),
      oneModule,
    );
    const needed = countBy(result.schedule.events, (event) => event.effectId);
    expect(needed.get("mine.100")).toBe(6);
    expect(needed.get("shell.75")).toBe(1);
    expect(
      result.assignments.filter((a) => a.shot.effect === "mine.100"),
    ).toHaveLength(6);
  });

  it("weighs every shell of the run for transport", () => {
    const result = build(CHAINED, oneModule);
    const counts = countBy(result.schedule.events, (event) => event.effectId);
    const totals = hazardTotals([mine], counts);
    expect(totals.totalGrams).toBe(6 * netExplosiveGrams(mine));
  });

  it("tells the permit its cues from its shots", () => {
    const result = build(
      [CHAINED, "at 20 fire shell.75 from pad.a"].join("\n"),
      oneModule,
    );
    const facts = permitFacts(result.schedule, oneModule, field, {
      showName: "autumn",
      siteName: "meadow",
    });
    expect(facts.cueCount).toBe(2);
    expect(facts.shotCount).toBe(7);
    expect(facts.effectCounts.get("mine.100")).toBe(6);
  });
});

describe("advice and doubling", () => {
  it("does not suggest chaining a run that is chained", () => {
    const chained = build(
      "at 10 ripple 8 of shell.75 from pad.a every 400ms chained",
      oneModule,
      { advice: true },
    );
    expect(chained.ok).toBe(true);
    expect(chainCandidates(chained.schedule)).toEqual([]);
    const loose = build(
      "at 10 ripple 8 of shell.75 from pad.a every 400ms",
      oneModule,
      { advice: true },
    );
    expect(chainCandidates(loose.schedule)).toHaveLength(1);
    // the one note the loose run earns is the suggestion to chain it
    expect(loose.diagnostics.size - chained.diagnostics.size).toBe(1);
  });

  it("still suggests a loose run beside a chained one", () => {
    const result = build(
      [
        "at 10 ripple 8 of shell.75 from pad.a every 400ms chained",
        "at 20 ripple 8 of shell.75 from pad.a every 400ms",
      ].join("\n"),
      twoModules,
      { advice: true },
    );
    const found = chainCandidates(result.schedule);
    expect(found).toHaveLength(1);
    expect(found[0]?.events).toHaveLength(8);
    expect(found[0]?.events.every((event) => event.fuse === undefined)).toBe(
      true,
    );
  });

  it("backs a chained run up once, on its head", () => {
    verifyAssertions();
    const result = build(
      "at 10 ripple 6 of shell.150 from pad.a every 400ms chained",
      twoModules,
    );
    const plans = planRedundancy(result.assignments, twoModules);
    expect(redundancyCost(plans).extraPins).toBe(1);
    const backed = plans.filter((plan) => plan.backup !== undefined);
    expect(backed).toHaveLength(1);
    expect(raw(backed[0]!.assignment.shot.fuse!)).toBe(0);
  });
});

describe("what changed since the field was wired", () => {
  it("compares a chained run head to head", () => {
    const before = build(CHAINED, oneModule);
    const after = build(CHAINED, oneModule);
    const changes = diffSchedules(before.schedule, after.schedule);
    expect(changes).toEqual([]);
    const summary = summariseDiff(before.schedule, after.schedule);
    expect(summary.identical).toBe(true);
    expect(summary.unchanged).toBe(1);
  });

  it("reports a run that gained a shot as a swap on its pin", () => {
    const before = build(CHAINED, oneModule);
    const after = build(
      "at 10 ripple 7 of mine.100 from pad.a every 250ms chained",
      oneModule,
    );
    const changes = diffSchedules(before.schedule, after.schedule);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("swapped");
    expect(needsRewiring(changes)).toBe(true);
  });

  it("reports a run cut to another interval as a swap", () => {
    const before = build(CHAINED, oneModule);
    const after = build(
      "at 10 ripple 6 of mine.100 from pad.a every 300ms chained",
      oneModule,
    );
    const changes = diffSchedules(before.schedule, after.schedule);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("swapped");
  });

  it("reports a run that only moved as moved", () => {
    const before = build(CHAINED, oneModule);
    const after = build(
      "at 12 ripple 6 of mine.100 from pad.a every 250ms chained",
      oneModule,
    );
    const changes = diffSchedules(before.schedule, after.schedule);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("moved");
    expect(changes[0]?.shiftMs).toBe(2000);
    expect(needsRewiring(changes)).toBe(false);
  });

  it("reports chaining a loose run as the field changing", () => {
    const before = build(LOOSE, oneModule);
    const after = build(CHAINED, oneModule);
    const changes = diffSchedules(before.schedule, after.schedule);
    expect(needsRewiring(changes)).toBe(true);
    expect(changes.filter((change) => change.kind === "removed")).toHaveLength(
      5,
    );
  });
});
