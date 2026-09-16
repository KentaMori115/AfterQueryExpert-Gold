import { describe, expect, it } from "vitest";
import { calibre } from "../src/catalog/calibre.js";
import { shell } from "../src/catalog/effect.js";
import { Magazine } from "../src/catalog/inventory.js";
import { Catalog } from "../src/catalog/registry.js";
import { compile, summariseCompile } from "../src/compile.js";
import { SMPTE_30 } from "../src/core/timecode.js";
import { effectId, positionId } from "../src/core/ids.js";
import { timingOf } from "../src/catalog/timing.js";
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

describe("drawing the show from a magazine", () => {
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
  const store = Catalog.from([palm, kamuro]);
  const four = [
    "show autumn",
    "at 20 fire shell.150.palm from pad.a label one",
    "at 22 fire shell.150.palm from pad.a label two",
    "at 24 fire shell.150.palm from pad.a label three",
    "at 26 fire shell.150.palm from pad.a label four",
  ].join("\n");

  function bookOf(palms: number, kamuros: number): Magazine {
    return Magazine.from([
      {
        lotNumber: "vn2405",
        effectId: "shell.150.palm",
        quantity: palms,
        received: "2025-04-01",
      },
      {
        lotNumber: "vn2413",
        effectId: "shell.150.kamuro",
        quantity: kamuros,
        received: "2025-04-02",
      },
    ]);
  }

  it("fires the catalog when there is no book", () => {
    const result = compile(four, "show.pf", { catalog: store, rig });
    expect(result.draw).toBeUndefined();
    expect(
      result.schedule.events.every((event) => event.lot === undefined),
    ).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("puts the lot each round came from on its event", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(9, 0),
    });
    expect(result.schedule.events.map((event) => event.lot)).toEqual([
      "vn2405",
      "vn2405",
      "vn2405",
      "vn2405",
    ]);
    expect(result.ok).toBe(true);
  });

  it("leaves the book it was given alone", () => {
    const book = bookOf(9, 0);
    compile(four, "show.pf", { catalog: store, rig, magazine: book });
    compile(four, "show.pf", { catalog: store, rig, magazine: book });
    expect(book.onHand("shell.150.palm")).toBe(9);
  });

  it("stands a shell in for the cues the book cannot cover", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(2, 4),
    });
    expect(result.schedule.events.map((event) => event.effectId)).toEqual([
      "shell.150.palm",
      "shell.150.palm",
      "shell.150.kamuro",
      "shell.150.kamuro",
    ]);
    const stood = result.schedule.events[2];
    expect(stood?.substitutedFor).toBe("shell.150.palm");
    expect(stood?.effect.id).toBe("shell.150.kamuro");
    expect(stood?.lot).toBe("vn2413");
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  it("keeps the cue time of a covered shot", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(0, 4),
    });
    // Within the frame the panel rounds to, the break is still on the beat.
    for (const [index, event] of result.schedule.events.entries()) {
      expect(
        Math.abs(raw(event.visibleAt) - (20000 + index * 2000)),
      ).toBeLessThan(20);
    }
  });

  it("lifts a covered shot on the stand-in's own lead", () => {
    const wide = shell({
      id: effectId("shell.175.wide"),
      name: "seven",
      calibre: calibre(mm(175)),
    });
    const result = compile("at 20 fire shell.150.palm from pad.a", "show.pf", {
      catalog: Catalog.from([palm, wide]),
      rig,
      magazine: Magazine.from([
        { lotNumber: "vn1", effectId: "shell.175.wide", quantity: 2 },
      ]),
    });
    const event = result.schedule.events[0];
    expect(event?.effectId).toBe("shell.175.wide");
    // The seven inch climbs four hundred milliseconds longer than the six, so
    // it has to leave the tube that much earlier to break on the same beat.
    expect(
      raw(event?.visibleAt ?? ms(0)) - raw(event?.ignitionAt ?? ms(0)),
    ).toBe(raw(timingOf(wide).lead));
    expect(result.diagnostics.byCode("PF1602")).toHaveLength(1);
  });

  it("takes the height clause with it onto the stand-in", () => {
    const result = compile(
      "at 20 fire shell.150.palm from pad.a height 60",
      "show.pf",
      { catalog: store, rig, magazine: bookOf(0, 4) },
    );
    const event = result.schedule.events[0];
    expect(event?.effectId).toBe("shell.150.kamuro");
    const flown = event?.effect;
    expect(
      flown !== undefined && flown.kind === "shell"
        ? raw(flown.breakHeight ?? metres(0))
        : 0,
    ).toBe(60);
    expect(
      raw(event?.visibleAt ?? ms(0)) - raw(event?.ignitionAt ?? ms(0)),
    ).toBe(raw(timingOf(flown ?? kamuro).lead));
  });

  it("keeps what was written when nothing can stand in", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(1, 0),
    });
    expect(result.schedule.events.map((event) => event.effectId)).toEqual([
      "shell.150.palm",
      "shell.150.palm",
      "shell.150.palm",
      "shell.150.palm",
    ]);
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
    expect(result.diagnostics.byCode("PF1600")[0]?.message).toContain(
      "3 cues short",
    );
    expect(result.ok).toBe(false);
  });

  it("sets a pulled lot aside before drawing", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(9, 9),
      pull: ["VN2405"],
    });
    expect(result.schedule.events.map((event) => event.lot)).toEqual([
      "vn2413",
      "vn2413",
      "vn2413",
      "vn2413",
    ]);
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
  });

  it("warns about a pulled lot the book does not hold", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(9, 0),
      pull: ["vn9999"],
    });
    expect(result.diagnostics.byCode("PF1603")).toHaveLength(1);
  });

  it("gives a stand-in its own pin and its own place in the layout", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(2, 4),
    });
    const pins = new Set(
      result.assignments.map(
        (assignment) =>
          `${assignment.address.module}.${assignment.address.pin}`,
      ),
    );
    expect(pins.size).toBe(4);
    expect(
      result.assignments.filter(
        (assignment) => assignment.shot.resolved.id === "shell.150.kamuro",
      ),
    ).toHaveLength(2);
  });

  it("checks the separation against the stand-in", () => {
    const large = shell({
      id: effectId("shell.300.big"),
      name: "twelve",
      calibre: calibre(mm(300)),
    });
    const mixed = Catalog.from([
      shell({
        id: effectId("shell.300.other"),
        name: "twelve other",
        calibre: calibre(mm(300)),
      }),
      large,
    ]);
    const close = site(
      "field",
      straightLine("spectator line", point(-300, -80), point(300, -80)),
    );
    const result = compile("at 20 fire shell.300.other from pad.a", "show.pf", {
      catalog: mixed,
      rig,
      magazine: Magazine.from([
        { lotNumber: "vn1", effectId: "shell.300.big", quantity: 2 },
      ]),
      safety: { site: close },
    });
    expect(result.schedule.events[0]?.effectId).toBe("shell.300.big");
    expect(result.diagnostics.byCode("PF4100").length).toBeGreaterThan(0);
  });

  it("counts what it drew and what it could not", () => {
    const result = compile(four, "show.pf", {
      catalog: store,
      rig,
      magazine: bookOf(1, 1),
    });
    expect(result.draw?.substitutions).toHaveLength(1);
    const swap = result.draw?.substitutions[0];
    expect(swap?.asked).toBe("shell.150.palm");
    expect(swap?.used).toBe("shell.150.kamuro");
    expect(swap?.quality).toBe("exact");
    expect(swap?.count).toBe(1);
    expect(swap?.where).toBeDefined();
    expect(result.draw?.uncovered[0]?.count).toBe(2);
    expect(result.draw?.remaining.onHand("shell.150.palm")).toBe(0);
  });
});
