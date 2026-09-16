import { describe, expect, it } from "vitest";
import { calibre } from "../src/catalog/calibre.js";
import { Magazine } from "../src/catalog/inventory.js";
import { shell } from "../src/catalog/effect.js";
import { Catalog } from "../src/catalog/registry.js";
import { compile, summariseCompile } from "../src/compile.js";
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

describe("drawing the show out of a magazine", () => {
  const palm = shell({
    id: effectId("shell.150.palm"),
    name: "six palm",
    calibre: calibre(mm(150)),
    breakStyle: "palm",
  });
  const aster = shell({
    id: effectId("shell.150.aster"),
    name: "six aster",
    calibre: calibre(mm(150)),
  });
  const wide = shell({
    id: effectId("shell.160.peony"),
    name: "six and a bit",
    calibre: calibre(mm(160)),
  });
  const shelf = Catalog.from([palm, aster, wide]);
  const show = [
    "show autumn",
    "at 20 fire shell.150.palm from pad.a label one",
    "at 24 fire shell.150.palm from pad.a label two",
  ].join("\n");

  function draw(book: Magazine, source = show, pull?: readonly string[]) {
    return compile(source, "show.pf", {
      catalog: shelf,
      rig,
      magazine: book,
      ...(pull === undefined ? {} : { pull }),
    });
  }

  it("puts the lot each cue drew on the event", () => {
    const result = draw(
      Magazine.from([
        { lotNumber: "vn2405", effectId: "shell.150.palm", quantity: 2 },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.schedule.events.map((event) => event.lot)).toEqual([
      "vn2405",
      "vn2405",
    ]);
    expect(result.draw?.standIns).toEqual([]);
  });

  it("fires the stand-in and remembers what was asked for", () => {
    const result = draw(
      Magazine.from([
        { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 1 },
        { lotNumber: "vn2", effectId: "shell.150.aster", quantity: 1 },
      ]),
    );
    const covered = result.schedule.events[1]!;
    expect(covered.effectId).toBe("shell.150.aster");
    expect(covered.effect.id).toBe("shell.150.aster");
    expect(covered.substitutedFor).toBe("shell.150.palm");
    expect(covered.lot).toBe("vn2");
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
  });

  it("keeps the cue time and lifts on the stand-in's own lead", () => {
    const result = draw(
      Magazine.from([
        { lotNumber: "vn5", effectId: "shell.160.peony", quantity: 2 },
      ]),
    );
    const asked = compile(show, "show.pf", { catalog: shelf, rig });
    const [covered] = result.schedule.events;
    const [written] = asked.schedule.events;
    expect(raw(covered!.visibleAt)).toBe(raw(written!.visibleAt));
    // The wider shell climbs longer, so the panel has to fire it earlier.
    expect(raw(covered!.ignitionAt)).toBeLessThan(raw(written!.ignitionAt));
    expect(result.diagnostics.byCode("PF1602")).toHaveLength(1);
  });

  it("lowers a stand-in to the height the script asked for", () => {
    const result = draw(
      Magazine.from([
        { lotNumber: "vn2", effectId: "shell.150.aster", quantity: 1 },
      ]),
      "at 20 fire shell.150.palm from pad.a height 90",
    );
    const [event] = result.schedule.events;
    expect(event?.effect.id).toBe("shell.150.aster");
    expect(
      event?.effect.kind === "shell" ? raw(event.effect.breakHeight!) : 0,
    ).toBe(90);
  });

  it("gives a covered cue its own pin like any other cue", () => {
    const result = draw(
      Magazine.from([
        { lotNumber: "vn2", effectId: "shell.150.aster", quantity: 2 },
      ]),
    );
    const pins = result.assignments.map(
      (assignment) => assignment.shot.resolved.id,
    );
    expect(pins).toEqual(["shell.150.aster", "shell.150.aster"]);
    expect(result.schedule.events[0]?.address).not.toEqual(
      result.schedule.events[1]?.address,
    );
  });

  it("stops the show when nothing can stand in", () => {
    const result = draw(new Magazine());
    expect(result.ok).toBe(false);
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
    expect(result.schedule.events[0]?.effectId).toBe("shell.150.palm");
    expect(result.schedule.events[0]?.lot).toBeUndefined();
  });

  it("leaves the book it was handed alone", () => {
    const book = Magazine.from([
      { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 4 },
    ]);
    draw(book);
    expect(book.onHand("shell.150.palm")).toBe(4);
  });

  it("sets a pulled lot aside before the draw", () => {
    const book = Magazine.from([
      { lotNumber: "vn2405", effectId: "shell.150.palm", quantity: 4 },
      { lotNumber: "vn2", effectId: "shell.150.aster", quantity: 4 },
    ]);
    const result = draw(book, show, ["vn2405"]);
    expect(result.schedule.events.map((event) => event.effectId)).toEqual([
      "shell.150.aster",
      "shell.150.aster",
    ]);
    expect(book.onHand("shell.150.palm")).toBe(4);
  });

  it("does not touch stock when it was given no magazine", () => {
    const result = compile(show, "show.pf", { catalog: shelf, rig });
    expect(result.draw).toBeUndefined();
    expect(result.schedule.events[0]?.lot).toBeUndefined();
    expect("draw" in result).toBe(false);
  });
});
