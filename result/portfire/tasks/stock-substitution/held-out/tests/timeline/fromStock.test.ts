import { verifyExpect } from "../helpers/expectGuard.js";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "../../src/catalog/parse.js";
import { parseMagazine } from "../../src/catalog/magazine.js";
import { ignitionTimeFor } from "../../src/catalog/timing.js";
import type { AerialShell } from "../../src/catalog/effect.js";
import { compile } from "../../src/compile.js";
import type { CompileOptions, CompileResult } from "../../src/compile.js";
import { metres, ms, raw } from "../../src/core/units.js";
import { cueSheet } from "../../src/export/sheets.js";
import { parseRig } from "../../src/rig/parse.js";
import { separationForEffect } from "../../src/safety/distance.js";
import { point, site, straightLine } from "../../src/safety/site.js";

/** Firing from stock, through the compile; expected times come from the catalog. */

const CATALOG = parseCatalog(
  [
    "id,kind,name,calibre,break,hang,spread,height",
    "shell.150.palm,shell,six palm,150mm,palm,2.6,,",
    "shell.150.kamuro,shell,six kamuro,150mm,kamuro,3.2,,",
    "shell.150.willow,shell,six willow,150mm,willow,3.4,,",
    "shell.160.ring,shell,ring,160mm,ring,2.0,,",
    "shell.175.peony,shell,seven peony,175mm,peony,2.2,,",
    "shell.200.brocade,shell,eight brocade,200mm,brocade,3.0,,",
    "shell.75.peony,shell,three peony,75mm,peony,1.8,,",
    "shell.75.crossette,shell,three crossette,75mm,crossette,2.0,,",
    "mine.150.gold,mine,six mine,150mm,,1.2,40,30",
  ].join("\n"),
  "house.csv",
).catalog;

const RIG = parseRig(
  [
    "position pad.a at -40 0",
    "position pad.b at 40 0",
    "module 1 fc-32 at pad.a",
    "module 2 fc-32 at pad.a",
    "module 3 fc-32 at pad.b",
  ].join("\n"),
  "field.rig",
).rig;

const HEADER = "lot,effect,quantity,received";

function book(...rows: string[]) {
  const parsed = parseMagazine([HEADER, ...rows].join("\n"), "book.csv");
  if (parsed.diagnostics.hasErrors()) {
    throw new Error("the fixture book does not parse");
  }
  return parsed.magazine;
}

interface ShowOptions {
  readonly rows?: readonly string[];
  readonly pull?: readonly string[];
  readonly audience?: number;
}

function show(lines: readonly string[], options: ShowOptions = {}) {
  const compileOptions: CompileOptions = {
    catalog: CATALOG,
    rig: RIG,
    ...(options.rows === undefined ? {} : { magazine: book(...options.rows) }),
    ...(options.pull === undefined ? {} : { pull: options.pull }),
    ...(options.audience === undefined
      ? {}
      : {
          safety: {
            site: site(
              "meadow",
              straightLine(
                "spectator line",
                point(-500, -options.audience),
                point(500, -options.audience),
              ),
            ),
          },
        }),
  };
  return compile(lines.join("\n"), "show.pf", compileOptions);
}

/** Events in the order the audience sees them, which is the drawing order. */
function seen(result: CompileResult) {
  return [...result.schedule.events].sort(
    (a, b) => raw(a.visibleAt) - raw(b.visibleAt),
  );
}

function shellNamed(id: string): AerialShell {
  const effect = CATALOG.get(id);
  if (effect === undefined || effect.kind !== "shell") {
    throw new Error(`${id} is not a shell in the fixture catalog`);
  }
  return effect;
}

const PALM_AT = (at: number) => `at ${at} fire shell.150.palm from pad.a`;

describe("drawing stock in firing order", () => {
  it("hands the shells to the earliest cues and runs out on the last", () => {
    verifyExpect();
    const result = show([PALM_AT(50), PALM_AT(10), PALM_AT(30), PALM_AT(20)], {
      rows: ["vn1,shell.150.palm,3,2025-01-01"],
    });
    const lots = seen(result).map((event) => event.lot);
    expect(lots).toEqual(["vn1", "vn1", "vn1", undefined]);
  });

  it("counts a ripple shot by shot rather than as one cue", () => {
    const result = show(
      ["at 10 ripple 4 of shell.150.palm from pad.a every 500ms", PALM_AT(30)],
      { rows: ["vn1,shell.150.palm,3,2025-01-01"] },
    );
    const events = seen(result);
    expect(events.map((event) => event.lot)).toEqual([
      "vn1",
      "vn1",
      "vn1",
      undefined,
      undefined,
    ]);
  });

  it("breaks a tie on the same instant by the order the script wrote them", () => {
    const result = show(
      [
        "at 10 fire shell.150.palm from pad.b label second",
        "at 10 fire shell.150.palm from pad.a label first",
      ],
      { rows: ["vn1,shell.150.palm,1,2025-01-01"] },
    );
    const byLabel = new Map(
      result.schedule.events.map((event) => [event.label, event.lot]),
    );
    expect(byLabel.get("second")).toBe("vn1");
    expect(byLabel.get("first")).toBeUndefined();
  });

  it("draws a cue inside a played group at the time it is played", () => {
    const result = show(
      [
        "group finale",
        "  at 0 fire shell.150.palm from pad.a label late",
        "end",
        "at 40 play finale",
        "at 20 fire shell.150.palm from pad.a label early",
      ],
      { rows: ["vn1,shell.150.palm,1,2025-01-01"] },
    );
    const early = result.schedule.events.find((e) => e.label === "early");
    const late = result.schedule.events.find((e) => e.label === "late");
    expect(early?.lot).toBe("vn1");
    expect(late?.lot).toBeUndefined();
  });

  it("carries no lot at all when the compile was given no magazine", () => {
    const result = show([PALM_AT(10)]);
    expect(result.schedule.events[0]?.lot).toBeUndefined();
    const drawn = show([PALM_AT(10)], {
      rows: ["vn1,shell.150.palm,1,2025-01-01"],
    });
    expect(drawn.schedule.events[0]?.lot).toBe("vn1");
  });
});

describe("own cues before stand-ins", () => {
  it("keeps a shell for its own later cue rather than lending it earlier", () => {
    verifyExpect();
    const result = show(
      [PALM_AT(10), "at 50 fire shell.150.willow from pad.a"],
      { rows: ["vn2,shell.150.willow,1,2025-01-01"] },
    );
    const [palm, willow] = seen(result);
    expect(willow?.effectId).toBe("shell.150.willow");
    expect(willow?.lot).toBe("vn2");
    expect(willow?.substitutedFor).toBeUndefined();
    expect(palm?.effectId).toBe("shell.150.palm");
    expect(palm?.lot).toBeUndefined();
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
  });

  it("covers the earlier of two shots left without when one stand-in is left", () => {
    const result = show([PALM_AT(30), PALM_AT(10)], {
      rows: ["vn2,shell.150.willow,1,2025-01-01"],
    });
    const [first, second] = seen(result);
    expect(first?.effectId).toBe("shell.150.willow");
    expect(first?.substitutedFor).toBe("shell.150.palm");
    expect(second?.effectId).toBe("shell.150.palm");
    expect(second?.substitutedFor).toBeUndefined();
  });

  it("lends the remainder once every own cue is served", () => {
    const result = show(
      [
        PALM_AT(10),
        PALM_AT(20),
        "at 60 fire shell.150.willow from pad.a",
        "at 70 fire shell.150.willow from pad.a",
      ],
      { rows: ["vn2,shell.150.willow,3,2025-01-01"] },
    );
    const events = seen(result);
    expect(events.map((event) => event.effectId)).toEqual([
      "shell.150.willow",
      "shell.150.palm",
      "shell.150.willow",
      "shell.150.willow",
    ]);
    expect(events.map((event) => event.lot)).toEqual([
      "vn2",
      undefined,
      "vn2",
      "vn2",
    ]);
  });
});

describe("choosing a stand-in", () => {
  it("prefers the same calibre over a band match", () => {
    verifyExpect();
    const result = show([PALM_AT(10)], {
      rows: [
        "vn3,shell.200.brocade,5,2025-01-01",
        "vn4,shell.160.ring,5,2025-01-01",
        "vn2,shell.150.willow,1,2025-01-01",
      ],
    });
    expect(result.schedule.events[0]?.effectId).toBe("shell.150.willow");
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
    expect(result.diagnostics.byCode("PF1602")).toHaveLength(0);
  });

  it("takes the nearest lead among band matches", () => {
    const result = show([PALM_AT(10)], {
      rows: [
        "vn5,shell.175.peony,5,2025-01-01",
        "vn4,shell.160.ring,5,2025-01-01",
      ],
    });
    expect(result.schedule.events[0]?.effectId).toBe("shell.160.ring");
    expect(result.diagnostics.byCode("PF1602")).toHaveLength(1);
  });

  it("breaks an equal lead by effect id", () => {
    const result = show([PALM_AT(10)], {
      rows: [
        "vn2,shell.150.willow,5,2025-01-01",
        "vn6,shell.150.kamuro,5,2025-01-01",
      ],
    });
    expect(result.schedule.events[0]?.effectId).toBe("shell.150.kamuro");
  });

  it("offers nothing substitutesFor would not, so a lead too far off is short", () => {
    const result = show([PALM_AT(10)], {
      rows: ["vn3,shell.200.brocade,5,2025-01-01"],
    });
    expect(result.schedule.events[0]?.effectId).toBe("shell.150.palm");
    expect(result.schedule.events[0]?.lot).toBeUndefined();
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
  });

  it("does not let a mine stand in for a shell of the same calibre", () => {
    const result = show([PALM_AT(10)], {
      rows: ["vn7,mine.150.gold,5,2025-01-01"],
    });
    expect(result.schedule.events[0]?.effectId).toBe("shell.150.palm");
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
  });

  it("runs one stand-in dry and moves to the next", () => {
    const result = show([PALM_AT(10), PALM_AT(20), PALM_AT(30), PALM_AT(40)], {
      rows: [
        "vn2,shell.150.willow,2,2025-01-01",
        "vn6,shell.150.kamuro,1,2025-01-01",
      ],
    });
    expect(seen(result).map((event) => event.effectId)).toEqual([
      "shell.150.kamuro",
      "shell.150.willow",
      "shell.150.willow",
      "shell.150.palm",
    ]);
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(2);
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
  });

  it("moves on to the next stand-in once the first is spent by an own cue", () => {
    const result = show(
      [PALM_AT(10), "at 50 fire shell.150.kamuro from pad.a"],
      {
        rows: [
          "vn6,shell.150.kamuro,1,2025-01-01",
          "vn2,shell.150.willow,1,2025-01-01",
        ],
      },
    );
    const [palm, kamuro] = seen(result);
    expect(palm?.effectId).toBe("shell.150.willow");
    expect(kamuro?.effectId).toBe("shell.150.kamuro");
  });
});

describe("what a shot left short looks like", () => {
  it("stays what was written, on the table, and blocks the show", () => {
    verifyExpect();
    const result = show([PALM_AT(10), PALM_AT(20)], {
      rows: ["vn1,shell.150.palm,1,2025-01-01"],
    });
    expect(result.assignments).toHaveLength(2);
    const [, bare] = seen(result);
    expect(bare?.effectId).toBe("shell.150.palm");
    expect(bare?.effect.id).toBe("shell.150.palm");
    expect(bare?.lot).toBeUndefined();
    expect(bare?.substitutedFor).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(result.diagnostics.hasErrors()).toBe(true);
  });
});

describe("which lot a shot draws", () => {
  it("empties the oldest delivery before touching the next", () => {
    verifyExpect();
    const result = show([PALM_AT(10), PALM_AT(20), PALM_AT(30), PALM_AT(40)], {
      rows: [
        "vn3,shell.150.palm,5,2025-03-01",
        "vn1,shell.150.palm,2,2025-01-01",
        "vn2,shell.150.palm,1,2025-02-01",
      ],
    });
    expect(seen(result).map((event) => event.lot)).toEqual([
      "vn1",
      "vn1",
      "vn2",
      "vn3",
    ]);
  });

  it("saves a row with no received date for last", () => {
    const result = show([PALM_AT(10), PALM_AT(20)], {
      rows: ["vn0,shell.150.palm,1,", "vn9,shell.150.palm,1,2025-06-01"],
    });
    expect(seen(result).map((event) => event.lot)).toEqual(["vn9", "vn0"]);
  });

  it("goes by lot number on a shared date, and among the undated", () => {
    const result = show([PALM_AT(10), PALM_AT(20), PALM_AT(30), PALM_AT(40)], {
      rows: [
        "vn20,shell.150.palm,1,2025-01-01",
        "vnb,shell.150.palm,1,",
        "vn11,shell.150.palm,1,2025-01-01",
        "vna,shell.150.palm,1,",
      ],
    });
    expect(seen(result).map((event) => event.lot)).toEqual([
      "vn11",
      "vn20",
      "vna",
      "vnb",
    ]);
  });

  it("draws a stand-in from its own lots in the same order", () => {
    const result = show([PALM_AT(10), PALM_AT(20)], {
      rows: [
        "vn5,shell.150.willow,1,2025-05-01",
        "vn4,shell.150.willow,1,2025-04-01",
      ],
    });
    const events = seen(result);
    expect(events.map((event) => event.effectId)).toEqual([
      "shell.150.willow",
      "shell.150.willow",
    ]);
    expect(events.map((event) => event.lot)).toEqual(["vn4", "vn5"]);
  });
});

describe("pulling a lot", () => {
  it("removes a pulled lot ahead of the draw", () => {
    const result = show([PALM_AT(10), PALM_AT(20)], {
      rows: [
        "vn1,shell.150.palm,1,2025-01-01",
        "vn2,shell.150.palm,1,2025-02-01",
      ],
      pull: ["vn1"],
    });
    expect(seen(result).map((event) => event.lot)).toEqual(["vn2", undefined]);
  });

  it("removes a pulled lot as a source of stand-ins", () => {
    const result = show([PALM_AT(10)], {
      rows: [
        "vn2,shell.150.willow,3,2025-01-01",
        "vn6,shell.150.kamuro,3,2025-01-01",
      ],
      pull: ["vn6"],
    });
    expect(result.schedule.events[0]?.effectId).toBe("shell.150.willow");
    expect(result.schedule.events[0]?.lot).toBe("vn2");
  });

  it("pulls every lot named, across effects", () => {
    const result = show([PALM_AT(10)], {
      rows: [
        "vn1,shell.150.palm,1,2025-01-01",
        "vn2,shell.150.willow,1,2025-01-01",
      ],
      pull: ["vn1", "vn2"],
    });
    expect(result.schedule.events[0]?.lot).toBeUndefined();
    expect(result.diagnostics.byCode("PF1600")).toHaveLength(1);
  });

  it("leaves the caller's magazine as it was", () => {
    const magazine = book(
      "vn1,shell.150.palm,1,2025-01-01",
      "vn2,shell.150.palm,1,2025-02-01",
    );
    const options = { catalog: CATALOG, rig: RIG, magazine, pull: ["vn1"] };
    expect(
      compile(PALM_AT(10), "show.pf", options).schedule.events[0]?.lot,
    ).toBe("vn2");
    expect(magazine.onHand("shell.150.palm")).toBe(2);
  });
});

describe("timing a covered shot", () => {
  it("breaks on the beat and lifts on the stand-in's clock", () => {
    verifyExpect();
    const result = show([PALM_AT(10)], {
      rows: ["vn4,shell.160.ring,1,2025-01-01"],
    });
    const event = result.schedule.events[0];
    expect(event?.effectId).toBe("shell.160.ring");
    const written = show(["at 10 fire shell.160.ring from pad.a"]).schedule
      .events[0];
    expect(raw(event?.visibleAt ?? ms(0))).toBe(
      raw(written?.visibleAt ?? ms(0)),
    );
    expect(raw(event?.ignitionAt ?? ms(0))).toBe(
      raw(written?.ignitionAt ?? ms(0)),
    );
    expect(raw(event?.ignitionAt ?? ms(0))).toBe(
      raw(ignitionTimeFor(shellNamed("shell.160.ring"), event!.visibleAt)),
    );
  });

  it("lowers the stand-in when the script lowered the break", () => {
    const result = show(["at 10 fire shell.150.palm from pad.a height 60"], {
      rows: ["vn4,shell.160.ring,1,2025-01-01"],
    });
    const event = result.schedule.events[0];
    expect(event?.effectId).toBe("shell.160.ring");
    const lowered = {
      ...shellNamed("shell.160.ring"),
      breakHeight: metres(60),
    };
    expect(raw(event?.ignitionAt ?? ms(0))).toBe(
      raw(ignitionTimeFor(lowered, event!.visibleAt)),
    );
    const full = show([PALM_AT(10)], {
      rows: ["vn4,shell.160.ring,1,2025-01-01"],
    }).schedule.events[0];
    expect(raw(event?.ignitionAt ?? ms(0))).not.toBe(
      raw(full?.ignitionAt ?? ms(0)),
    );
  });

  it("puts the stand-in on the event and what was asked for beside it", () => {
    const result = show([PALM_AT(10), "at 20 fire shell.75.peony from pad.b"], {
      rows: [
        "vn2,shell.150.willow,1,2025-01-01",
        "vn8,shell.75.peony,1,2025-01-01",
      ],
    });
    const [covered, own] = seen(result);
    expect(covered?.effectId).toBe("shell.150.willow");
    expect(covered?.effect.id).toBe("shell.150.willow");
    expect(covered?.substitutedFor).toBe("shell.150.palm");
    expect(covered?.lot).toBe("vn2");
    expect(own?.effectId).toBe("shell.75.peony");
    expect(own?.lot).toBe("vn8");
    expect(own?.substitutedFor).toBeUndefined();
  });
});

describe("the rest of the compile sees the stand-in", () => {
  it("allocates the pin to the stand-in", () => {
    verifyExpect();
    const result = show([PALM_AT(10)], {
      rows: ["vn2,shell.150.willow,1,2025-01-01"],
    });
    expect(result.assignments[0]?.shot.resolved.id).toBe("shell.150.willow");
    expect(result.assignments[0]?.shot.effect).toBe("shell.150.willow");
  });

  it("checks separation against the stand-in's calibre", () => {
    const palm = separationForEffect(shellNamed("shell.150.palm"));
    const ring = separationForEffect(shellNamed("shell.160.ring"));
    const audience = (raw(palm) + raw(ring)) / 2;
    const own = show([PALM_AT(10)], { audience });
    expect(own.diagnostics.byCode("PF4100")).toHaveLength(0);
    const covered = show([PALM_AT(10)], {
      rows: ["vn4,shell.160.ring,1,2025-01-01"],
      audience,
    });
    expect(covered.diagnostics.byCode("PF4100")).toHaveLength(1);
    expect(covered.ok).toBe(false);
  });
});

describe("what gets reported", () => {
  it("folds an exact cover into one note with its count", () => {
    verifyExpect();
    const result = show([PALM_AT(10), PALM_AT(20), PALM_AT(30)], {
      rows: ["vn2,shell.150.willow,5,2025-01-01"],
    });
    const notes = result.diagnostics.byCode("PF1601");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.severity).toBe("note");
    expect(notes[0]?.message).toContain("3");
    expect(notes[0]?.message).toContain("shell.150.palm");
    expect(notes[0]?.message).toContain("shell.150.willow");
    expect(result.ok).toBe(true);
  });

  it("warns when only the band matches, once per pair", () => {
    const result = show(
      [PALM_AT(10), PALM_AT(20), "at 30 fire shell.150.kamuro from pad.a"],
      { rows: ["vn4,shell.160.ring,5,2025-01-01"] },
    );
    const warnings = result.diagnostics.byCode("PF1602");
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.severity === "warning")).toBe(true);
    const palmLine = warnings.find((w) => w.message.includes("shell.150.palm"));
    expect(palmLine?.message).toContain("2");
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it("errors once per effect nothing could cover", () => {
    const result = show(
      [
        PALM_AT(10),
        PALM_AT(20),
        "at 30 fire shell.75.peony from pad.b",
        "at 40 fire shell.75.peony from pad.b",
      ],
      { rows: ["vn8,shell.75.crossette,1,2025-01-01"] },
    );
    const errors = result.diagnostics.byCode("PF1600");
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.severity === "error")).toBe(true);
    expect(result.diagnostics.byCode("PF1601")).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("reports nothing about stock when every cue drew its own", () => {
    const result = show([PALM_AT(10)], {
      rows: ["vn1,shell.150.palm,1,2025-01-01"],
    });
    expect(
      result.diagnostics.all().some((d) => d.code.startsWith("PF16")),
    ).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.schedule.events[0]?.lot).toBe("vn1");
  });
});

describe("the cue sheet", () => {
  it("adds the lot beside the note once the show was drawn", () => {
    verifyExpect();
    const result = show([PALM_AT(10), PALM_AT(20)], {
      rows: [
        "vn1,shell.150.palm,1,2025-01-01",
        "vn2,shell.150.willow,1,2025-01-01",
      ],
    });
    const sheet = cueSheet(result.schedule);
    const [header, , first, second] = sheet.split("\n");
    expect(header).toContain("lot");
    expect(first).toContain("vn1");
    expect(second).toContain("vn2");
    expect(second).toContain("6in willow");
  });

  it("has no lot column for a show that was never drawn", () => {
    const bare = cueSheet(show([PALM_AT(10)]).schedule);
    expect(bare.split("\n")[0]).not.toContain("lot");
    const rows = ["vn1,shell.150.palm,1,2025-01-01"];
    const drawn = cueSheet(show([PALM_AT(10)], { rows }).schedule);
    expect(drawn.split("\n")[0]).toContain("lot");
  });
});
