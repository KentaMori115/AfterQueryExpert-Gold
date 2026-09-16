import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  checkBalance,
  describeBalance,
  lateralLean,
  positionShares,
  timeBalance,
} from "../../src/timeline/balance.js";
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
const rig = Rig.from(
  [
    firingPosition(positionId("pad.left"), -80, 0),
    firingPosition(positionId("pad.mid"), 0, 0),
    firingPosition(positionId("pad.right"), 80, 0),
  ],
  [
    firingModule(1, modelNamed("slat-50")!, positionId("pad.left")),
    firingModule(2, modelNamed("slat-50")!, positionId("pad.mid")),
    firingModule(3, modelNamed("slat-50")!, positionId("pad.right")),
  ],
);

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  return buildSchedule(allocatePins(resolved.shots, rig).assignments);
}

const even = scheduleOf(
  [
    "at 10 ripple 4 of s from pad.left every 1s",
    "at 20 ripple 4 of s from pad.mid every 1s",
    "at 30 ripple 4 of s from pad.right every 1s",
  ].join("\n"),
);
const lopsided = scheduleOf(
  [
    "at 10 ripple 20 of s from pad.right every 1s",
    "at 40 fire s from pad.left",
  ].join("\n"),
);

describe("positionShares", () => {
  it("counts the shots and the share at each position", () => {
    const shares = positionShares(even, rig);
    expect(shares).toHaveLength(3);
    expect(shares[0]?.shots).toBe(4);
    expect(shares[0]?.share).toBeCloseTo(1 / 3, 5);
  });

  it("orders positions across the field", () => {
    expect(positionShares(even, rig).map((share) => share.position)).toEqual([
      "pad.left",
      "pad.mid",
      "pad.right",
    ]);
  });

  it("gives nothing for an empty show", () => {
    expect(positionShares(scheduleOf(""), rig)).toEqual([]);
  });
});

describe("lateralLean", () => {
  it("is near zero for an even show", () => {
    expect(Math.abs(lateralLean(even, rig))).toBeLessThan(0.01);
  });

  it("leans right when the work is on the right", () => {
    expect(lateralLean(lopsided, rig)).toBeGreaterThan(0.5);
  });

  it("leans left the other way round", () => {
    const other = scheduleOf(
      [
        "at 10 ripple 20 of s from pad.left every 1s",
        "at 40 fire s from pad.right",
      ].join("\n"),
    );
    expect(lateralLean(other, rig)).toBeLessThan(-0.5);
  });

  it("is zero for a show from one position", () => {
    expect(lateralLean(scheduleOf("at 10 fire s from pad.mid"), rig)).toBe(0);
  });

  it("is zero for an empty show", () => {
    expect(lateralLean(scheduleOf(""), rig)).toBe(0);
  });
});

describe("timeBalance", () => {
  it("splits the show into quarters", () => {
    const balance = timeBalance(even);
    expect(balance.quarters.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it("puts the last shot in the last quarter", () => {
    const balance = timeBalance(even);
    expect(balance.quarters[3]).toBeGreaterThan(0);
  });

  it("reports the span", () => {
    const balance = timeBalance(even);
    expect(raw(balance.start)).toBe(10000);
    expect(raw(balance.end)).toBe(33000);
  });

  it("reports zeroes for an empty show", () => {
    const balance = timeBalance(scheduleOf(""));
    expect(balance.quarters).toEqual([0, 0, 0, 0]);
    expect(balance.finaleShare).toBe(0);
  });

  it("gives a front loaded show a small finale share", () => {
    const front = scheduleOf(
      [
        "at 10 ripple 20 of s from pad.mid every 200ms",
        "at 120 fire s from pad.mid",
      ].join("\n"),
    );
    expect(timeBalance(front).finaleShare).toBeLessThan(0.1);
  });
});

describe("checkBalance", () => {
  it("says nothing about an even show", () => {
    expect(checkBalance(even, rig).size).toBe(0);
  });

  it("warns about a lopsided show and says which way", () => {
    const diagnostic = checkBalance(lopsided, rig).byCode("PF3600")[0];
    expect(diagnostic?.message).toContain("right");
    expect(diagnostic?.help).toContain("rehearsal");
  });

  it("takes its own lean limit", () => {
    expect(checkBalance(even, rig, { maxLean: 0 }).byCode("PF3600")).toEqual(
      [],
    );
    expect(
      checkBalance(lopsided, rig, { maxLean: 0.99 }).byCode("PF3600"),
    ).toEqual([]);
  });

  it("notes a show that front loads", () => {
    const front = scheduleOf(
      [
        "at 10 ripple 20 of s from pad.mid every 200ms",
        "at 120 fire s from pad.mid",
      ].join("\n"),
    );
    expect(checkBalance(front, rig).byCode("PF3601")[0]?.help).toContain(
      "that was it",
    );
  });

  it("notes positions carrying very different amounts", () => {
    const uneven = scheduleOf(
      [
        "at 10 ripple 30 of s from pad.mid every 500ms",
        "at 40 fire s from pad.left",
        "at 41 fire s from pad.right",
      ].join("\n"),
    );
    const diagnostic = checkBalance(uneven, rig).byCode("PF3602")[0];
    expect(diagnostic?.help).toContain("pad.mid 30");
  });

  it("says nothing about that with only two positions", () => {
    expect(checkBalance(lopsided, rig).byCode("PF3602")).toEqual([]);
  });

  it("says nothing about an empty show", () => {
    expect(checkBalance(scheduleOf(""), rig).size).toBe(0);
  });
});

describe("describeBalance", () => {
  it("reads as a table with a lean line", () => {
    const text = describeBalance(even, rig);
    expect(text).toContain("pad.left");
    expect(text).toContain("lean");
    expect(text).toContain("quarters");
  });

  it("signs a positive lean", () => {
    expect(describeBalance(lopsided, rig)).toContain("lean +");
  });
});
