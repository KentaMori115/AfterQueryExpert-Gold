import { describe, expect, it } from "vitest";
import { calibre } from "../src/catalog/calibre.js";
import { shell } from "../src/catalog/effect.js";
import { Magazine } from "../src/catalog/inventory.js";
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

describe("drawing the show from a magazine", () => {
  const store = Catalog.from([
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
      id: effectId("shell.175.peony"),
      name: "seven peony",
      calibre: calibre(mm(175)),
    }),
  ]);
  const drawn = { catalog: store, rig };
  const show = [
    "show autumn",
    "at 20 ripple 3 of shell.150.palm from pad.a every 2s",
  ].join("\n");

  it("fires what the script asks for while the stock lasts", () => {
    const result = compile(show, "show.pf", {
      ...drawn,
      magazine: Magazine.from([
        { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 3 },
      ]),
    });
    expect(result.ok).toBe(true);
    expect(result.schedule.events.map((event) => event.lot)).toEqual([
      "vn1",
      "vn1",
      "vn1",
    ]);
    expect(
      result.schedule.events.every(
        (event) => event.substitutedFor === undefined,
      ),
    ).toBe(true);
  });

  it("draws nothing at all without a magazine", () => {
    const result = compile(show, "show.pf", drawn);
    expect(result.draw).toBeUndefined();
    expect(result.schedule.events[0]?.lot).toBeUndefined();
  });

  it("puts the stand-in on the event and keeps the ask beside it", () => {
    const result = compile(show, "show.pf", {
      ...drawn,
      magazine: Magazine.from([
        { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 2 },
        { lotNumber: "vn2", effectId: "shell.150.willow", quantity: 5 },
      ]),
    });
    const last = result.schedule.events[2];
    expect(last?.effectId).toBe("shell.150.willow");
    expect(last?.effect.id).toBe("shell.150.willow");
    expect(last?.substitutedFor).toBe("shell.150.palm");
    expect(last?.lot).toBe("vn2");
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  it("lifts a covered cue on the stand-in's own lead", () => {
    const asked = compile("at 20 fire shell.150.palm from pad.a", "show.pf", {
      ...drawn,
      magazine: Magazine.from([
        { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 1 },
      ]),
    });
    const stood = compile("at 20 fire shell.150.palm from pad.a", "show.pf", {
      ...drawn,
      magazine: Magazine.from([
        { lotNumber: "vn2", effectId: "shell.175.peony", quantity: 1 },
      ]),
    });
    expect(raw(stood.schedule.events[0]!.visibleAt)).toBe(
      raw(asked.schedule.events[0]!.visibleAt),
    );
    expect(raw(stood.schedule.events[0]!.ignitionAt)).toBeLessThan(
      raw(asked.schedule.events[0]!.ignitionAt),
    );
    expect(stood.diagnostics.byCode("PF1602")).toHaveLength(1);
  });

  it("keeps the height clause on a covered cue", () => {
    const result = compile(
      "at 20 fire shell.150.palm from pad.a height 90",
      "show.pf",
      {
        ...drawn,
        magazine: Magazine.from([
          { lotNumber: "vn2", effectId: "shell.175.peony", quantity: 1 },
        ]),
      },
    );
    const event = result.schedule.events[0];
    expect(
      event?.effect.kind === "shell" && raw(event.effect.breakHeight!),
    ).toBe(90);
  });

  it("sets a pulled lot aside before the show is drawn", () => {
    const book = Magazine.from([
      {
        lotNumber: "vn1",
        effectId: "shell.150.palm",
        quantity: 5,
        received: "2025-01-01",
      },
      {
        lotNumber: "vn2",
        effectId: "shell.150.palm",
        quantity: 5,
        received: "2025-02-01",
      },
    ]);
    const result = compile(show, "show.pf", {
      ...drawn,
      magazine: book,
      pull: ["vn1"],
    });
    expect(result.schedule.events.map((event) => event.lot)).toEqual([
      "vn2",
      "vn2",
      "vn2",
    ]);
    expect(book.onHand("shell.150.palm")).toBe(10);
  });

  it("fails and keeps the ask when nothing covers a cue", () => {
    const result = compile(show, "show.pf", {
      ...drawn,
      magazine: Magazine.from([
        { lotNumber: "vn1", effectId: "shell.150.palm", quantity: 1 },
      ]),
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
    expect(result.schedule.events[2]?.effectId).toBe("shell.150.palm");
    expect(result.schedule.events[2]?.lot).toBeUndefined();
  });

  it("hands the draw back with the stand-ins on it", () => {
    const result = compile(show, "show.pf", {
      ...drawn,
      magazine: Magazine.from([
        { lotNumber: "vn2", effectId: "shell.150.willow", quantity: 5 },
      ]),
    });
    expect(result.draw?.standIns[0]).toMatchObject({
      effectId: "shell.150.palm",
      standInId: "shell.150.willow",
      shots: 3,
      lots: ["vn2"],
    });
    expect(result.draw?.remaining.onHand("shell.150.willow")).toBe(2);
  });

  it("shows the stand-in to the pins and to the safety layer", () => {
    const result = compile("at 20 fire shell.150.palm from pad.a", "show.pf", {
      ...drawn,
      magazine: Magazine.from([
        { lotNumber: "vn2", effectId: "shell.175.peony", quantity: 1 },
      ]),
      safety: {
        site: site(
          "tight",
          straightLine("spectator line", point(-300, -10), point(300, -10)),
        ),
      },
    });
    expect(result.assignments[0]?.shot.resolved.id).toBe("shell.175.peony");
    expect(result.diagnostics.byCode("PF4100")[0]?.message).toContain(
      "shell.175.peony",
    );
  });
});
