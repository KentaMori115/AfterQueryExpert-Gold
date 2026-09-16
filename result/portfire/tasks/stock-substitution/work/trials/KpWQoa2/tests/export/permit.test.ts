import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { GroundPiece } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  permitClears,
  permitDocument,
  permitFacts,
  permitShotList,
  permitSummary,
  permitTiming,
} from "../../src/export/permit.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { point, site, straightLine } from "../../src/safety/site.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";

const gerb: GroundPiece = {
  kind: "ground",
  id: effectId("gerb.silver"),
  name: "gerb",
  style: "gerb",
  duration: ms(20000),
  height: metres(4),
};
const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
  gerb,
]);
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 60, 0),
  ],
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-32")!, positionId("pad.b")),
  ],
);
const roomy = site(
  "long meadow",
  straightLine("spectator line", point(-500, -200), point(500, -200)),
);
const tight = site(
  "car park",
  straightLine("spectator line", point(-500, -40), point(500, -40)),
);

const details = {
  showName: "autumn 2025",
  siteName: "long meadow",
  date: "2025-11-05",
  operator: "skye",
  licenceNumber: "abc-1234",
};

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

const built = scheduleOf(
  [
    "at 20 fire shell.150 from pad.a",
    "at 22 ripple 4 of shell.75 from pad.b every 300ms",
    "at 30 fire gerb.silver from pad.a",
  ].join("\n"),
);

describe("permitFacts", () => {
  const facts = permitFacts(built, rig, roomy, details);

  it("counts the shots and the positions", () => {
    expect(facts.shotCount).toBe(6);
    expect(facts.positions).toBe(2);
  });

  it("finds the largest bore, ignoring the ground piece", () => {
    expect(facts.largestCalibreMm).toBe(150);
  });

  it("quotes the separation the largest effect needs", () => {
    expect(raw(facts.requiredSeparation)).toBeCloseTo(128, 0);
  });

  it("quotes the tightest separation the site offers", () => {
    expect(raw(facts.actualSeparation)).toBe(200);
  });

  it("counts each effect", () => {
    expect(facts.effectCounts.get("shell.75")).toBe(4);
    expect(facts.effectCounts.get("gerb.silver")).toBe(1);
  });

  it("carries the details through", () => {
    expect(facts.details.licenceNumber).toBe("abc-1234");
  });

  it("reports a show with no cues without dividing by nothing", () => {
    const empty = permitFacts(scheduleOf(""), rig, roomy, details);
    expect(empty.shotCount).toBe(0);
    expect(raw(empty.actualSeparation)).toBe(0);
    expect(empty.largestCalibreMm).toBe(0);
  });
});

describe("permitClears", () => {
  it("clears on a site with room", () => {
    expect(permitClears(permitFacts(built, rig, roomy, details))).toBe(true);
  });

  it("does not clear on a tight site", () => {
    expect(permitClears(permitFacts(built, rig, tight, details))).toBe(false);
  });

  it("clears under the reduced rule where the full one fails", () => {
    expect(
      permitClears(permitFacts(built, rig, tight, details, "reduced")),
    ).toBe(false);
    const midway = site(
      "midway",
      straightLine("spectator line", point(-500, -80), point(500, -80)),
    );
    expect(permitClears(permitFacts(built, rig, midway, details))).toBe(false);
    expect(
      permitClears(permitFacts(built, rig, midway, details, "reduced")),
    ).toBe(true);
  });

  it("clears a show with no cues", () => {
    expect(permitClears(permitFacts(scheduleOf(""), rig, tight, details))).toBe(
      true,
    );
  });
});

describe("permitSummary", () => {
  const summary = permitSummary(permitFacts(built, rig, roomy, details));

  it("names the show, site, date, operator and licence", () => {
    expect(summary).toContain("autumn 2025");
    expect(summary).toContain("2025-11-05");
    expect(summary).toContain("skye");
    expect(summary).toContain("abc-1234");
  });

  it("quotes both metres and feet", () => {
    expect(summary).toContain("128m (420ft)");
  });

  it("says whether it clears", () => {
    expect(summary).toContain("clears the rule");
    expect(summary).toContain("yes");
  });

  it("leaves out the optional lines that were not given", () => {
    const bare = permitSummary(
      permitFacts(built, rig, roomy, {
        showName: "a",
        siteName: "b",
      }),
    );
    expect(bare).not.toContain("licence");
    expect(bare).not.toContain("operator");
  });
});

describe("permitShotList", () => {
  const list = permitShotList(built);

  it("gives a row per effect with its count", () => {
    expect(list).toContain("shell.75");
    expect(list).toContain("shell.150");
    expect(list).toContain("gerb.silver");
  });

  it("puts the largest bore first", () => {
    const rows = list.split("\n").slice(2);
    expect(rows[0]).toContain("shell.150");
  });

  it("marks a ground piece as having no bore", () => {
    expect(list).toContain("ground");
  });

  it("quotes a separation for every row", () => {
    for (const row of list.split("\n").slice(2)) {
      expect(row).toMatch(/\d+m$/);
    }
  });
});

describe("permitTiming", () => {
  it("quotes the first and last ignition", () => {
    const timing = permitTiming(built);
    expect(timing).toContain("first ignition");
    expect(timing).toContain("last ignition");
    expect(timing).toContain("runs");
  });

  it("says so for an empty show", () => {
    expect(permitTiming(scheduleOf(""))).toBe("no cues");
  });
});

describe("permitDocument", () => {
  it("puts the whole thing together", () => {
    const document = permitDocument(built, rig, roomy, details);
    expect(document).toContain("autumn 2025 at long meadow");
    expect(document).toContain("shot list");
    expect(document).toContain("timing");
  });
});
