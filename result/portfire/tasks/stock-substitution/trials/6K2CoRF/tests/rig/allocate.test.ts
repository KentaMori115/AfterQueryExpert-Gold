import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  allocatePins,
  byPin,
  byTime,
  describeAllocation,
  moduleLoads,
  unusedPins,
} from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { formatPin } from "../../src/rig/pin.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm } from "../../src/core/units.js";

const fc16 = modelNamed("fc-16")!;
const catalog = Catalog.from([
  shell({ id: effectId("s"), name: "s", calibre: calibre(mm(75)) }),
  shell({ id: effectId("t"), name: "t", calibre: calibre(mm(150)) }),
]);

function rigWith(modules: number, position = "pad.a"): Rig {
  return Rig.from(
    [
      firingPosition(positionId("pad.a"), 0, 0),
      firingPosition(positionId("pad.b"), 40, 0),
    ],
    Array.from({ length: modules }, (_, i) =>
      firingModule(i + 1, fc16, positionId(position)),
    ),
  );
}

function allocate(source: string, rig: Rig, packTight = false) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  return allocatePins(resolved.shots, rig, { packTight });
}

describe("simple allocation", () => {
  const rig = rigWith(1);

  it("gives the first shot the first pin", () => {
    const { assignments } = allocate("at 1 fire s from pad.a", rig);
    expect(formatPin(assignments[0]!.address)).toBe("01.01");
  });

  it("never gives two shots the same pin", () => {
    const { assignments } = allocate(
      "at 1 ripple 10 of s from pad.a every 100ms",
      rig,
    );
    const keys = assignments.map((a) => formatPin(a.address));
    expect(new Set(keys).size).toBe(10);
  });

  it("assigns every shot", () => {
    const { assignments, diagnostics } = allocate(
      "at 1 ripple 10 of s from pad.a every 100ms",
      rig,
    );
    expect(assignments).toHaveLength(10);
    expect(diagnostics.size).toBe(0);
  });
});

describe("spreading across modules", () => {
  const rig = rigWith(3);

  it("puts consecutive shots of a ripple on different modules", () => {
    const { assignments } = allocate(
      "at 1 ripple 6 of s from pad.a every 40ms",
      rig,
    );
    const modules = byTime(assignments).map((a) => a.address.module);
    expect(modules).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("packs one module at a time when asked to", () => {
    const { assignments } = allocate(
      "at 1 ripple 6 of s from pad.a every 40ms",
      rig,
      true,
    );
    expect(byTime(assignments).map((a) => a.address.module)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("falls back to a full module's neighbours when one fills", () => {
    const { assignments, diagnostics } = allocate(
      "at 1 ripple 48 of s from pad.a every 20ms",
      rig,
    );
    expect(assignments).toHaveLength(48);
    expect(diagnostics.size).toBe(0);
  });
});

describe("fixed pins", () => {
  const rig = rigWith(2);

  it("honours a pin the script named", () => {
    const { assignments } = allocate("at 1 fire s from pad.a pin 2.05", rig);
    expect(formatPin(assignments[0]!.address)).toBe("02.05");
  });

  it("does not let an earlier auto shot steal a later fixed pin", () => {
    const { assignments } = allocate(
      ["at 1 fire s from pad.a", "at 2 fire t from pad.a pin 1.01"].join("\n"),
      rig,
    );
    const fixed = assignments.find((a) => a.shot.effect === "t");
    const auto = assignments.find((a) => a.shot.effect === "s");
    expect(formatPin(fixed!.address)).toBe("01.01");
    expect(formatPin(auto!.address)).not.toBe("01.01");
  });
});

describe("running out", () => {
  it("reports a position with no module", () => {
    const rig = rigWith(1);
    const { assignments, diagnostics } = allocate(
      "at 1 fire s from pad.b",
      rig,
    );
    expect(assignments).toEqual([]);
    expect(diagnostics.byCode("PF2400")).toHaveLength(1);
  });

  it("reports a position that runs out of pins, once", () => {
    const rig = rigWith(1);
    const { assignments, diagnostics } = allocate(
      "at 1 ripple 20 of s from pad.a every 10ms",
      rig,
    );
    expect(assignments).toHaveLength(16);
    expect(diagnostics.byCode("PF2401")).toHaveLength(1);
    expect(diagnostics.byCode("PF2401")[0]?.message).toContain("all 16");
  });

  it("says what to do about it", () => {
    const rig = rigWith(1);
    const { diagnostics } = allocate(
      "at 1 ripple 20 of s from pad.a every 10ms",
      rig,
    );
    expect(diagnostics.byCode("PF2401")[0]?.help).toContain("add a module");
  });
});

describe("orderings", () => {
  const rig = rigWith(2);
  const source = [
    "at 5 fire s from pad.a pin 2.01",
    "at 1 fire t from pad.a pin 1.09",
  ].join("\n");

  it("sorts by pin for the wiring sheet", () => {
    const { assignments } = allocate(source, rig);
    expect(byPin(assignments).map((a) => formatPin(a.address))).toEqual([
      "01.09",
      "02.01",
    ]);
  });

  it("sorts by time for the panel", () => {
    const { assignments } = allocate(source, rig);
    expect(byTime(assignments).map((a) => a.shot.effect)).toEqual(["t", "s"]);
  });
});

describe("reports", () => {
  const rig = rigWith(2);

  it("counts the load on each module", () => {
    const { assignments } = allocate(
      "at 1 ripple 4 of s from pad.a every 40ms",
      rig,
    );
    const loads = moduleLoads(assignments, rig);
    expect(loads).toEqual([
      { module: 1, used: 2, capacity: 16 },
      { module: 2, used: 2, capacity: 16 },
    ]);
  });

  it("lists the pins nothing is wired to", () => {
    const { assignments } = allocate("at 1 fire s from pad.a", rig);
    expect(unusedPins(assignments, rig)).toHaveLength(31);
  });

  it("describes the allocation in pin order", () => {
    const { assignments } = allocate(
      "at 1 ripple 2 of s from pad.a every 40ms",
      rig,
    );
    expect(describeAllocation(assignments).split("\n")).toEqual([
      "01.01  s",
      "02.01  s",
    ]);
  });
});
