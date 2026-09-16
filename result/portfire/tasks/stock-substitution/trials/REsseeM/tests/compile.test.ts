import { describe, expect, it } from "vitest";
import { calibre } from "../src/catalog/calibre.js";
import { shell } from "../src/catalog/effect.js";
import type { AerialShell } from "../src/catalog/effect.js";
import { Catalog } from "../src/catalog/registry.js";
import { compile, summariseCompile } from "../src/compile.js";
import { SMPTE_30 } from "../src/core/timecode.js";
import { effectId, positionId } from "../src/core/ids.js";
import { metres, mm, ms, raw } from "../src/core/units.js";
import type { Metres } from "../src/core/units.js";
import { Magazine } from "../src/catalog/inventory.js";
import { timingOf } from "../src/catalog/timing.js";
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

describe("drawing the show from a magazine", () => {
  const drawnCatalog = Catalog.from([
    shell({
      id: effectId("shell.150.palm"),
      name: "six palm",
      calibre: calibre(mm(150)),
      breakStyle: "palm",
    }),
    shell({
      id: effectId("shell.150.willow"),
      name: "six willow",
      calibre: calibre(mm(150)),
      breakStyle: "willow",
    }),
    shell({
      id: effectId("shell.75.peony"),
      name: "three peony",
      calibre: calibre(mm(75)),
    }),
  ]);
  const willow = drawnCatalog.get("shell.150.willow")! as AerialShell;

  function book(): Magazine {
    return Magazine.from([
      {
        lotNumber: "vn2405",
        effectId: "shell.150.palm",
        quantity: 1,
        received: "2025-01-01",
      },
      {
        lotNumber: "vn2413",
        effectId: "shell.150.willow",
        quantity: 2,
        received: "2025-02-01",
      },
    ]);
  }

  const script = [
    "show autumn",
    "at 10 fire shell.150.palm from pad.a label first",
    "at 20 fire shell.150.palm from pad.a label second",
  ].join("\n");

  it("compiles against the catalog alone when no book is given", () => {
    const result = compile(script, "show.pf", {
      catalog: drawnCatalog,
      rig,
    });
    expect(result.draw).toBeUndefined();
    expect(result.schedule.events.every((event) => event.lot === undefined));
    expect(result.ok).toBe(true);
  });

  it("puts the lot each shell came from on its cue", () => {
    const result = compile(script, "show.pf", {
      catalog: drawnCatalog,
      rig,
      magazine: book(),
    });
    const first = result.schedule.events.find(
      (event) => event.label === "first",
    );
    expect(first?.lot).toBe("vn2405");
    expect(first?.substitutedFor).toBeUndefined();
  });

  it("fires a stand-in for the cue the store cannot supply", () => {
    const result = compile(script, "show.pf", {
      catalog: drawnCatalog,
      rig,
      magazine: book(),
    });
    const second = result.schedule.events.find(
      (event) => event.label === "second",
    );
    expect(second?.effectId).toBe("shell.150.willow");
    expect(second?.effect.id).toBe("shell.150.willow");
    expect(second?.substitutedFor).toBe("shell.150.palm");
    expect(second?.lot).toBe("vn2413");
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  it("keeps the cue time and lifts on the stand-in", () => {
    const result = compile(script, "show.pf", {
      catalog: drawnCatalog,
      rig,
      magazine: book(),
    });
    const second = result.schedule.events.find(
      (event) => event.label === "second",
    )!;
    // Within a frame of the written cue time, which is all quantisation leaves.
    expect(Math.abs(raw(second.visibleAt) - 20000)).toBeLessThanOrEqual(40);
    expect(raw(second.ignitionAt)).toBeCloseTo(
      raw(second.visibleAt) - raw(timingOf(willow).lead),
      0,
    );
  });

  it("keeps the height clause on the stand-in", () => {
    const lowered = [
      "at 10 fire shell.150.palm from pad.a",
      "at 20 fire shell.150.palm from pad.a height 90 label low",
    ].join("\n");
    const result = compile(lowered, "show.pf", {
      catalog: drawnCatalog,
      rig,
      magazine: book(),
    });
    const low = result.schedule.events.find((event) => event.label === "low")!;
    expect(low.effectId).toBe("shell.150.willow");
    expect(raw((low.effect as { breakHeight: Metres }).breakHeight)).toBe(90);
    expect(raw(low.ignitionAt)).toBeCloseTo(
      raw(low.visibleAt) -
        raw(timingOf({ ...willow, breakHeight: metres(90) }).lead),
      0,
    );
  });

  it("gives the pin to the shell that will really go up", () => {
    const result = compile(script, "show.pf", {
      catalog: drawnCatalog,
      rig,
      magazine: book(),
    });
    const stood = result.assignments.find(
      (assignment) => assignment.shot.label === "second",
    );
    expect(stood?.shot.resolved.id).toBe("shell.150.willow");
    expect(stood?.shot.substitutedFor).toBe("shell.150.palm");
  });

  it("is not ready when nothing in the store can cover a cue", () => {
    const result = compile(
      "at 10 fire shell.75.peony from pad.a label lonely",
      "show.pf",
      { catalog: drawnCatalog, rig, magazine: book() },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
    const only = result.schedule.events[0];
    expect(only?.effectId).toBe("shell.75.peony");
    expect(only?.lot).toBeUndefined();
  });

  it("leaves the book it was handed alone", () => {
    const held = book();
    compile(script, "show.pf", { catalog: drawnCatalog, rig, magazine: held });
    compile(script, "show.pf", { catalog: drawnCatalog, rig, magazine: held });
    expect(held.onHand("shell.150.palm")).toBe(1);
    expect(held.onHand("shell.150.willow")).toBe(2);
  });

  it("sets the pulled lots aside before drawing", () => {
    const result = compile(script, "show.pf", {
      catalog: drawnCatalog,
      rig,
      magazine: book(),
      pull: ["vn2405"],
    });
    expect(
      result.schedule.events.map((event) => event.effectId).sort(),
    ).toEqual(["shell.150.willow", "shell.150.willow"]);
    expect(result.draw?.substitutions[0]?.count).toBe(2);
  });

  it("hands the draw back so a report can say what happened", () => {
    const result = compile(script, "show.pf", {
      catalog: drawnCatalog,
      rig,
      magazine: book(),
    });
    expect(result.draw?.remaining.onHand("shell.150.willow")).toBe(1);
    expect(result.draw?.uncovered).toEqual([]);
  });
});
