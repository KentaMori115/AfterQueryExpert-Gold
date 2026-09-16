import { describe, expect, it } from "vitest";
import { calibre } from "../src/catalog/calibre.js";
import { shell } from "../src/catalog/effect.js";
import type { AerialShell } from "../src/catalog/effect.js";
import { Magazine } from "../src/catalog/inventory.js";
import type { Lot } from "../src/catalog/inventory.js";
import { Catalog } from "../src/catalog/registry.js";
import { compile, summariseCompile } from "../src/compile.js";
import type { CompileOptions } from "../src/compile.js";
import { SMPTE_30 } from "../src/core/timecode.js";
import { effectId, positionId } from "../src/core/ids.js";
import { metres, mm, ms, raw } from "../src/core/units.js";
import { firingModule, modelNamed } from "../src/rig/module.js";
import { Rig, firingPosition } from "../src/rig/rig.js";
import { point, site, straightLine } from "../src/safety/site.js";

const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
  shell({
    id: effectId("shell.300"),
    name: "twelve",
    calibre: calibre(mm(300)),
  }),
]);
const rig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  Array.from({ length: 3 }, (_, i) =>
    firingModule(i + 1, modelNamed("fc-32")!, positionId("pad.a")),
  ),
);
const field = site(
  "field",
  straightLine("spectator line", point(-300, -300), point(300, -300)),
);

const options = { catalog, rig };

describe("a clean script", () => {
  const result = compile(
    ["show autumn", "frame 25", "at 20 fire shell.150 from pad.a"].join("\n"),
    "show.pf",
    options,
  );

  it("compiles to a schedule", () => {
    expect(result.ok).toBe(true);
    expect(result.schedule.events).toHaveLength(1);
  });

  it("raises nothing", () => {
    expect(result.diagnostics.size).toBe(0);
  });

  it("keeps the parsed script", () => {
    expect(result.script.statements).toHaveLength(3);
  });
});

describe("frame rate and seed", () => {
  it("takes the rate the script names over the caller's", () => {
    const result = compile(
      ["frame 30", "at 20 fire shell.150 from pad.a"].join("\n"),
      "show.pf",
      options,
    );
    expect(result.schedule.format.rate).toBe(30);
  });

  it("falls back to the caller's rate", () => {
    const result = compile("at 20 fire shell.150 from pad.a", "show.pf", {
      ...options,
      format: SMPTE_30,
    });
    expect(result.schedule.format.rate).toBe(30);
  });

  it("defaults to twenty five", () => {
    const result = compile(
      "at 20 fire shell.150 from pad.a",
      "show.pf",
      options,
    );
    expect(result.schedule.format.rate).toBe(25);
  });

  it("uses the script's seed for jitter", () => {
    const one = compile(
      [
        "seed alpha",
        "at 20 ripple 6 of shell.75 from pad.a every 200ms jitter 30ms",
      ].join("\n"),
      "show.pf",
      options,
    );
    const two = compile(
      [
        "seed beta",
        "at 20 ripple 6 of shell.75 from pad.a every 200ms jitter 30ms",
      ].join("\n"),
      "show.pf",
      options,
    );
    expect(one.schedule.events.map((e) => raw(e.ignitionAt))).not.toEqual(
      two.schedule.events.map((e) => raw(e.ignitionAt)),
    );
  });

  it("falls back to the show name as a seed", () => {
    const one = compile(
      [
        "show alpha",
        "at 20 ripple 6 of shell.75 from pad.a every 200ms jitter 30ms",
      ].join("\n"),
      "show.pf",
      options,
    );
    const again = compile(
      [
        "show alpha",
        "at 20 ripple 6 of shell.75 from pad.a every 200ms jitter 30ms",
      ].join("\n"),
      "show.pf",
      options,
    );
    expect(one.schedule.events.map((e) => raw(e.ignitionAt))).toEqual(
      again.schedule.events.map((e) => raw(e.ignitionAt)),
    );
  });
});

describe("stopping and carrying on", () => {
  it("stops at a parse error rather than reporting an empty show", () => {
    const result = compile("rocket 4", "show.pf", options);
    expect(result.ok).toBe(false);
    expect(result.schedule.events).toEqual([]);
    expect(result.diagnostics.byCode("PF2116")).toHaveLength(1);
  });

  it("carries on past an unresolved name", () => {
    const result = compile(
      [
        "at 20 fire shell.999 from pad.a",
        "at 22 fire shell.150 from pad.a",
      ].join("\n"),
      "show.pf",
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.schedule.events).toHaveLength(1);
  });

  it("still runs the load check on what did resolve", () => {
    const result = compile(
      [
        "at 20 fire shell.999 from pad.a",
        "at 22 fan 12 of shell.75 from pad.a spread 4ms",
      ].join("\n"),
      "show.pf",
      { ...options, allocation: { packTight: true } },
    );
    expect(result.diagnostics.byCode("PF3100").length).toBeGreaterThan(0);
  });
});

describe("pre roll", () => {
  it("reports the pre roll a big opener needs", () => {
    const result = compile(
      "at 1 fire shell.300 from pad.a",
      "show.pf",
      options,
    );
    expect(raw(result.preRoll)).toBeGreaterThan(5000);
  });

  it("can absorb it so nothing fires before zero", () => {
    const result = compile("at 1 fire shell.300 from pad.a", "show.pf", {
      ...options,
      absorbPreRoll: true,
    });
    expect(raw(result.preRoll)).toBe(0);
    expect(raw(result.schedule.events[0]!.ignitionAt)).toBeGreaterThanOrEqual(
      0,
    );
  });
});

describe("optional checks", () => {
  it("runs the safety check only when a site is given", () => {
    const without = compile(
      "at 20 fire shell.150 from pad.a",
      "show.pf",
      options,
    );
    expect(without.safety).toBeUndefined();
    const with_ = compile("at 20 fire shell.150 from pad.a", "show.pf", {
      ...options,
      safety: { site: field },
    });
    expect(with_.safety?.ok).toBe(true);
  });

  it("folds a safety failure into the verdict", () => {
    const result = compile("at 20 fire shell.300 from pad.a", "show.pf", {
      ...options,
      safety: { site: field, ceiling: metres(100) },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.byCode("PF4101")).toHaveLength(1);
  });

  it("applies a density cap when one is given", () => {
    const result = compile(
      "at 20 ripple 8 of shell.150 from pad.a every 100ms",
      "show.pf",
      { ...options, density: { maxSimultaneous: 2 } },
    );
    expect(result.diagnostics.byCode("PF3200")).toHaveLength(1);
  });

  it("warns about a lull only past the threshold given", () => {
    const source = [
      "at 10 fire shell.150 from pad.a",
      "at 16 fire shell.150 from pad.a",
    ].join("\n");
    expect(
      compile(source, "show.pf", {
        ...options,
        density: { lullThreshold: ms(10000) },
      }).diagnostics.byCode("PF3201"),
    ).toEqual([]);
    expect(
      compile(source, "show.pf", {
        ...options,
        density: { lullThreshold: ms(500) },
      }).diagnostics.byCode("PF3201").length,
    ).toBeGreaterThan(0);
  });
});

describe("summariseCompile", () => {
  it("says ready with the counts", () => {
    const result = compile(
      "at 20 fire shell.150 from pad.a",
      "show.pf",
      options,
    );
    expect(summariseCompile(result)).toBe(
      "ready, 1 cues, 0 errors, 0 warnings",
    );
  });

  it("says not ready when something failed", () => {
    expect(summariseCompile(compile("rocket 4", "show.pf", options))).toContain(
      "not ready",
    );
  });
});

describe("assignments", () => {
  it("come back with the result", () => {
    const result = compile(
      "at 20 ripple 4 of shell.75 from pad.a every 200ms",
      "show.pf",
      options,
    );
    expect(result.assignments).toHaveLength(4);
  });

  it("match the schedule cue for cue", () => {
    const result = compile(
      "at 20 ripple 4 of shell.75 from pad.a every 200ms",
      "show.pf",
      options,
    );
    const fromSchedule = result.schedule.events
      .map((event) => `${event.address.module}:${event.address.pin}`)
      .sort();
    const fromAssignments = result.assignments
      .map((a) => `${a.address.module}:${a.address.pin}`)
      .sort();
    expect(fromAssignments).toEqual(fromSchedule);
  });

  it("carry the shot, which the schedule has thrown away", () => {
    const result = compile(
      "at 20 fire shell.150 from pad.a",
      "show.pf",
      options,
    );
    expect(result.assignments[0]?.shot.effect).toBe("shell.150");
  });

  it("are empty when the script does not parse", () => {
    expect(compile("rocket 4", "show.pf", options).assignments).toEqual([]);
  });

  it("are empty for an empty show", () => {
    expect(compile("", "show.pf", options).assignments).toEqual([]);
  });
});

describe("the advisory checks", () => {
  const lopsided = [
    "show autumn",
    "at 10 ripple 20 of shell.75 from pad.a every 400ms",
    "at 40 fire shell.150 from pad.a",
  ].join("\n");

  it("stay quiet unless asked for", () => {
    const result = compile(lopsided, "show.pf", options);
    expect(result.diagnostics.byCode("PF3500")).toEqual([]);
    expect(result.diagnostics.byCode("PF1900")).toEqual([]);
  });

  it("suggest a chain when asked", () => {
    const result = compile(lopsided, "show.pf", { ...options, advice: true });
    expect(result.diagnostics.byCode("PF3500").length).toBeGreaterThan(0);
  });

  it("note a palette leaning on one family", () => {
    const result = compile(lopsided, "show.pf", { ...options, advice: true });
    expect(result.diagnostics.byCode("PF1900").length).toBeGreaterThan(0);
  });

  it("take their own limits", () => {
    const relaxed = compile(lopsided, "show.pf", {
      ...options,
      advice: true,
      paletteLimits: { maxShare: 1, minVariety: 0 },
    });
    expect(relaxed.diagnostics.byCode("PF1900")).toEqual([]);
  });

  it("never turn a clean show into a failing one", () => {
    const result = compile(lopsided, "show.pf", { ...options, advice: true });
    expect(result.ok).toBe(true);
  });

  it("say nothing at all about an empty show", () => {
    const result = compile("show quiet", "show.pf", {
      ...options,
      advice: true,
    });
    expect(result.diagnostics.size).toBe(0);
  });
});

describe("compiling against a magazine", () => {
  const palm = shell({
    id: effectId("shell.150.palm"),
    name: "six palm",
    calibre: calibre(mm(150)),
    breakStyle: "palm",
  });
  const kamuro = shell({
    id: effectId("shell.150.kamuro"),
    name: "six kamuro",
    calibre: calibre(mm(150)),
    breakStyle: "kamuro",
  });
  const near = shell({
    id: effectId("shell.160.peony"),
    name: "six and a bit",
    calibre: calibre(mm(160)),
  });
  const stocked = Catalog.from([palm, kamuro, near]);
  const source = [
    "show autumn",
    "frame 25",
    "at 20 fire shell.150.palm from pad.a label opener",
    "at 30 fire shell.150.palm from pad.a label second",
  ].join("\n");

  function withBook(lots: readonly Lot[], over: Partial<CompileOptions> = {}) {
    return compile(source, "show.pf", {
      catalog: stocked,
      rig,
      magazine: Magazine.from(lots),
      ...over,
    });
  }

  it("draws nothing without a book, and says nothing about lots", () => {
    const result = compile(source, "show.pf", { catalog: stocked, rig });
    expect(result.draw).toBeUndefined();
    expect(result.schedule.events[0]?.lot).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("names the lot on every event it drew", () => {
    const result = withBook([
      { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 4 },
    ]);
    expect(result.schedule.events.map((event) => event.lot)).toEqual([
      "vn1",
      "vn1",
    ]);
    expect(result.diagnostics.byCode("PF1601")).toEqual([]);
    expect(result.diagnostics.errorCount).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("fires a stand-in for the cue the stock does not reach", () => {
    const result = withBook([
      { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 1 },
      { lotNumber: "vn2", effectId: "shell.150.kamuro", quantity: 1 },
    ]);
    const second = result.schedule.events[1];
    expect(second?.effectId).toBe("shell.150.kamuro");
    expect(second?.effect.id).toBe("shell.150.kamuro");
    expect(second?.substitutedFor).toBe("shell.150.palm");
    expect(second?.lot).toBe("vn2");
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  it("carries only the lot on a cue that drew its own", () => {
    const result = withBook([
      { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 1 },
      { lotNumber: "vn2", effectId: "shell.150.kamuro", quantity: 1 },
    ]);
    expect(result.schedule.events[0]?.substitutedFor).toBeUndefined();
    expect(result.schedule.events[0]?.lot).toBe("vn1");
  });

  it("keeps the cue time and lifts on the stand-in's own lead", () => {
    const asked = compile(source, "show.pf", { catalog: stocked, rig });
    const covered = withBook([
      { lotNumber: "vn2", effectId: "shell.160.peony", quantity: 4 },
    ]);
    expect(raw(covered.schedule.events[0]!.visibleAt)).toBe(
      raw(asked.schedule.events[0]!.visibleAt),
    );
    expect(raw(covered.schedule.events[0]!.ignitionAt)).toBeLessThan(
      raw(asked.schedule.events[0]!.ignitionAt),
    );
    expect(covered.diagnostics.byCode("PF1602")).toHaveLength(1);
  });

  it("keeps the height clause the script wrote on the stand-in", () => {
    const result = compile(
      "at 20 fire shell.150.palm from pad.a height 90",
      "show.pf",
      {
        catalog: stocked,
        rig,
        magazine: Magazine.from([
          { lotNumber: "vn2", effectId: "shell.160.peony", quantity: 4 },
        ]),
      },
    );
    const event = result.schedule.events[0];
    expect(event?.effectId).toBe("shell.160.peony");
    expect(raw((event?.effect as AerialShell).breakHeight!)).toBe(90);
  });

  it("lets the pins and the safety checks see the stand-in", () => {
    const result = withBook(
      [{ lotNumber: "vn2", effectId: "shell.160.peony", quantity: 4 }],
      { safety: { site: field } },
    );
    expect(result.assignments[0]?.shot.resolved.id).toBe("shell.160.peony");
    expect(result.assignments[0]?.shot.substitutedFor).toBe("shell.150.palm");
    expect(result.safety).toBeDefined();
  });

  it("will not call a show ready when a cue is left as written", () => {
    const result = withBook([]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
    expect(result.schedule.events[0]?.effectId).toBe("shell.150.palm");
    expect(result.schedule.events[0]?.lot).toBeUndefined();
  });

  it("sets aside the lots it is told to pull before drawing", () => {
    const result = withBook(
      [
        { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 4 },
        { lotNumber: "vn3", effectId: "shell.150.palm", quantity: 4 },
      ],
      { pull: ["vn1"] },
    );
    expect(result.schedule.events.map((event) => event.lot)).toEqual([
      "vn3",
      "vn3",
    ]);
  });

  it("hands the draw back so a report can name the stand-ins", () => {
    const result = withBook([
      { lotNumber: "vn2", effectId: "shell.150.kamuro", quantity: 4 },
    ]);
    expect(result.draw?.standIns).toEqual([
      {
        wanted: "shell.150.palm",
        substitute: "shell.150.kamuro",
        quality: "exact",
        shots: 2,
        lots: ["vn2"],
      },
    ]);
  });
});
