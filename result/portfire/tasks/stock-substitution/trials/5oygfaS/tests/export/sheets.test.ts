import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  cueSheet,
  positionSheets,
  sheetHeader,
  wiringSheet,
} from "../../src/export/sheets.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm, ms } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({
    id: effectId("shell.150"),
    name: "six",
    calibre: calibre(mm(150)),
    breakStyle: "palm",
    hangTime: ms(2000),
  }),
]);
const fc16 = modelNamed("fc-16")!;
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 0),
  ],
  [
    firingModule(1, fc16, positionId("pad.a")),
    firingModule(2, fc16, positionId("pad.b")),
  ],
);

function scheduleOf(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig);
  return buildSchedule(allocated.assignments);
}

const built = scheduleOf(
  [
    "at 20 fire shell.150 from pad.a label opener",
    "at 22 fire shell.150 from pad.b",
  ].join("\n"),
);

describe("cueSheet", () => {
  it("puts the cues in firing order", () => {
    const lines = cueSheet(built).split("\n");
    expect(lines[2]).toContain("pad.a");
    expect(lines[3]).toContain("pad.b");
  });

  it("prints both the ignition and the break time", () => {
    expect(cueSheet(built)).toContain("0:15.970");
    expect(cueSheet(built)).toContain("0:20.000");
  });

  it("describes the effect the way a person reads it", () => {
    expect(cueSheet(built)).toContain("6in palm");
  });

  it("prints the label", () => {
    expect(cueSheet(built)).toContain("opener");
  });

  it("can drop the break column", () => {
    const sheet = cueSheet(built, { showBreak: false });
    expect(sheet).not.toContain("break");
    expect(sheet.split("\n")[0]?.split(/\s+/)).toContain("pin");
  });

  it("takes a title", () => {
    expect(cueSheet(built, { title: "autumn 2025" }).split("\n")[0]).toBe(
      "autumn 2025",
    );
  });

  it("prints headers alone for an empty show", () => {
    expect(cueSheet(scheduleOf("")).split("\n")).toHaveLength(2);
  });
});

describe("wiringSheet", () => {
  const sheet = wiringSheet(built, rig);

  it("gives every module a block", () => {
    expect(sheet).toContain("module 1 (fc-16) at pad.a");
    expect(sheet).toContain("module 2 (fc-16) at pad.b");
  });

  it("counts what is used on each module", () => {
    expect(sheet).toContain("1 of 16 used");
  });

  it("lists every pin, used or not", () => {
    expect(sheet).toContain("01.16");
    expect(sheet).toContain("02.16");
  });

  it("prints the lead label a crew reads out", () => {
    expect(sheet).toContain("M1/1");
  });

  it("leaves an unused pin's columns empty", () => {
    const line = sheet.split("\n").find((row) => row.startsWith("01.09"));
    expect(line?.trim()).toBe("01.09  M1/9");
  });

  it("takes a title", () => {
    expect(
      wiringSheet(built, rig, { title: "load sheet" }).split("\n")[0],
    ).toBe("load sheet");
  });
});

describe("sheetHeader", () => {
  it("counts the cues and quotes the times", () => {
    const header = sheetHeader(built, "autumn");
    expect(header).toContain("2 cues");
    expect(header).toContain("first fires at 0:15.970");
    expect(header).toContain("runs");
  });

  it("says when a show needs pre roll", () => {
    const early = scheduleOf("at 1 fire shell.150 from pad.a");
    expect(sheetHeader(early, "autumn")).toContain("pre roll");
  });

  it("does not mention pre roll when there is none", () => {
    expect(sheetHeader(built, "autumn")).not.toContain("pre roll");
  });

  it("says so for an empty show", () => {
    expect(sheetHeader(scheduleOf(""), "autumn")).toContain("no cues");
  });
});

describe("positionSheets", () => {
  it("gives one sheet per position", () => {
    const sheets = positionSheets(built);
    expect([...sheets.keys()]).toEqual(["pad.a", "pad.b"]);
  });

  it("puts only that position's cues on its sheet", () => {
    const sheets = positionSheets(built);
    expect(sheets.get("pad.a")).toContain("pad.a");
    expect(sheets.get("pad.a")).not.toContain("pad.b");
  });

  it("gives nothing for an empty show", () => {
    expect(positionSheets(scheduleOf("")).size).toBe(0);
  });
});

describe("the lot column", () => {
  const drawn = {
    ...built,
    events: built.events.map((event, index) =>
      index === 0 ? { ...event, lot: "vn2405" } : event,
    ),
  };

  it("appears once a show has been drawn from a magazine", () => {
    const lines = cueSheet(drawn).split("\n");
    expect(lines[0]).toContain("lot");
    expect(lines[2]).toContain("vn2405");
  });

  it("leaves the cell empty on a cue nothing was drawn for", () => {
    const lines = cueSheet(drawn).split("\n");
    expect(lines[3]).not.toContain("vn2405");
  });

  it("stays away on a show that was never drawn", () => {
    expect(cueSheet(built).split("\n")[0]).not.toContain("lot");
  });

  it("can be asked for even where there is nothing to put in it", () => {
    expect(cueSheet(built, { showLots: true }).split("\n")[0]).toContain("lot");
  });

  it("can be turned off on a show that was drawn", () => {
    expect(cueSheet(drawn, { showLots: false }).split("\n")[0]).not.toContain(
      "lot",
    );
  });

  it("survives dropping the break column", () => {
    const header = cueSheet(drawn, { showBreak: false }).split("\n")[0] ?? "";
    expect(header).toContain("lot");
    expect(header).not.toContain("break");
  });

  it("comes through on a position sheet too", () => {
    const sheets = positionSheets(drawn);
    expect(sheets.get("pad.a")).toContain("vn2405");
  });
});
