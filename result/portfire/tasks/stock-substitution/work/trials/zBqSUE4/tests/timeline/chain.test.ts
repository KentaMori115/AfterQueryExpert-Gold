import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  FUSE_MS_PER_METRE,
  MAX_CHAIN_LENGTH,
  chainCandidates,
  chainDrift,
  describeChain,
  overlongChains,
  suggestChains,
  totalPinsSaved,
} from "../../src/timeline/chain.js";
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
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
]);
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 0),
  ],
  [
    firingModule(1, modelNamed("slat-50")!, positionId("pad.a")),
    firingModule(2, modelNamed("slat-50")!, positionId("pad.b")),
  ],
);

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

describe("chainCandidates", () => {
  it("finds an even run at one position", () => {
    const built = scheduleOf(
      "at 20 ripple 8 of shell.75 from pad.a every 200ms",
    );
    const found = chainCandidates(built);
    expect(found).toHaveLength(1);
    expect(found[0]?.events).toHaveLength(8);
    expect(raw(found[0]!.interval)).toBe(200);
  });

  it("saves one pin less than the run length", () => {
    const built = scheduleOf(
      "at 20 ripple 8 of shell.75 from pad.a every 200ms",
    );
    expect(chainCandidates(built)[0]?.pinsSaved).toBe(7);
    expect(totalPinsSaved(chainCandidates(built))).toBe(7);
  });

  it("cuts the fuse to match the interval", () => {
    const built = scheduleOf(
      "at 20 ripple 8 of shell.75 from pad.a every 400ms",
    );
    expect(chainCandidates(built)[0]?.fuseMetres).toBeCloseTo(
      400 / FUSE_MS_PER_METRE,
      2,
    );
  });

  it("does not chain a run of two", () => {
    const built = scheduleOf(
      "at 20 ripple 2 of shell.75 from pad.a every 200ms",
    );
    expect(chainCandidates(built)).toEqual([]);
  });

  it("does not chain across positions", () => {
    const built = scheduleOf(
      "at 20 chase shell.75 across pad.a pad.b every 200ms passes 4",
    );
    for (const candidate of chainCandidates(built)) {
      const positions = new Set(
        candidate.events.map((event) => event.position),
      );
      expect(positions.size).toBe(1);
    }
  });

  it("does not chain two different effects together", () => {
    const built = scheduleOf(
      [
        "at 20 ripple 4 of shell.75 from pad.a every 200ms",
        "at 20.1 ripple 4 of shell.150 from pad.a every 200ms",
      ].join("\n"),
    );
    for (const candidate of chainCandidates(built)) {
      const effects = new Set(candidate.events.map((event) => event.effectId));
      expect(effects.size).toBe(1);
    }
  });

  it("breaks a run where the interval changes", () => {
    const built = scheduleOf(
      [
        "at 20 ripple 4 of shell.75 from pad.a every 200ms",
        "at 30 ripple 4 of shell.75 from pad.a every 900ms",
      ].join("\n"),
    );
    const found = chainCandidates(built);
    expect(found.length).toBeGreaterThan(1);
  });

  it("caps a chain at the length it was given", () => {
    const built = scheduleOf(
      "at 20 ripple 20 of shell.75 from pad.a every 200ms",
    );
    for (const candidate of chainCandidates(built, 6)) {
      expect(candidate.events.length).toBeLessThanOrEqual(6);
    }
  });

  it("orders candidates by how many pins they save", () => {
    const built = scheduleOf(
      [
        "at 20 ripple 3 of shell.75 from pad.a every 200ms",
        "at 40 ripple 9 of shell.150 from pad.b every 200ms",
      ].join("\n"),
    );
    const found = chainCandidates(built);
    expect(found[0]?.pinsSaved).toBeGreaterThan(found[1]?.pinsSaved ?? 0);
  });

  it("finds nothing in a show of single shots", () => {
    const built = scheduleOf(
      [
        "at 20 fire shell.75 from pad.a",
        "at 40 fire shell.150 from pad.b",
      ].join("\n"),
    );
    expect(chainCandidates(built)).toEqual([]);
  });

  it("finds nothing in an empty show", () => {
    expect(chainCandidates(scheduleOf(""))).toEqual([]);
  });
});

describe("chainDrift", () => {
  it("is nothing for a run already evenly spaced", () => {
    const built = scheduleOf(
      "at 20 ripple 6 of shell.75 from pad.a every 200ms",
    );
    expect(chainDrift(chainCandidates(built)[0]!)).toBeLessThanOrEqual(1);
  });

  it("grows when the run was jittered", () => {
    const built = scheduleOf(
      "at 20 ripple 6 of shell.75 from pad.a every 200ms jitter 20ms",
    );
    const found = chainCandidates(built);
    if (found.length > 0) {
      expect(chainDrift(found[0]!)).toBeGreaterThan(0);
    }
  });
});

describe("suggestChains", () => {
  it("notes each run with the fuse to cut and the pins saved", () => {
    const built = scheduleOf(
      "at 20 ripple 8 of shell.75 from pad.a every 200ms",
    );
    const diagnostic = suggestChains(built).byCode("PF3500")[0];
    expect(diagnostic?.message).toContain("8 shots of shell.75");
    expect(diagnostic?.help).toContain("save 7 pins");
    expect(diagnostic?.help).toContain("m of quickmatch");
  });

  it("says nothing about a show with no runs", () => {
    expect(
      suggestChains(scheduleOf("at 20 fire shell.75 from pad.a")).size,
    ).toBe(0);
  });
});

describe("overlongChains", () => {
  it("warns about a run longer than a chain can carry", () => {
    const built = scheduleOf(
      `at 20 ripple ${MAX_CHAIN_LENGTH + 6} of shell.75 from pad.a every 200ms`,
    );
    const diagnostic = overlongChains(built).byCode("PF3501")[0];
    expect(diagnostic?.help).toContain("does not light");
  });

  it("says nothing about a run inside the limit", () => {
    const built = scheduleOf(
      "at 20 ripple 8 of shell.75 from pad.a every 200ms",
    );
    expect(overlongChains(built).size).toBe(0);
  });
});

describe("describeChain", () => {
  it("reads as one line with the pins at each end", () => {
    const built = scheduleOf(
      "at 20 ripple 5 of shell.75 from pad.a every 200ms",
    );
    const line = describeChain(chainCandidates(built)[0]!);
    expect(line).toContain("5 x shell.75 at pad.a");
    expect(line).toContain("saves 4");
  });
});
