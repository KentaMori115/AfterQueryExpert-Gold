import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  SHOW_JSON_VERSION,
  cuesBetween,
  describeJsonShow,
  isQuantised,
  jsonShowLines,
  readShowJson,
  toJsonShow,
  writeShowJson,
} from "../../src/export/json.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { quantiseSchedule } from "../../src/timeline/quantise.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { SMPTE_25, SMPTE_2997 } from "../../src/core/timecode.js";
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
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 10),
  ],
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-32")!, positionId("pad.b")),
  ],
);

function scheduleOf(source: string, format = SMPTE_25) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig);
  return quantiseSchedule(buildSchedule(allocated.assignments), format);
}

const built = scheduleOf(
  [
    "at 20 fire shell.150 from pad.a label opener",
    "at 22 fire shell.150 from pad.b",
  ].join("\n"),
);

describe("toJsonShow", () => {
  const show = toJsonShow(built, { name: "autumn" });

  it("carries a version", () => {
    expect(show.version).toBe(SHOW_JSON_VERSION);
  });

  it("carries the frame format", () => {
    expect(show.frameRate).toBe(25);
    expect(show.dropFrame).toBe(false);
    expect(toJsonShow(scheduleOf("", SMPTE_2997)).dropFrame).toBe(true);
  });

  it("numbers cues from one", () => {
    expect(show.events.map((event) => event.cue)).toEqual([1, 2]);
  });

  it("writes times as whole milliseconds", () => {
    for (const event of show.events) {
      expect(Number.isInteger(event.ignitionMs)).toBe(true);
      expect(Number.isInteger(event.visibleMs)).toBe(true);
    }
  });

  it("writes the address three ways for three kinds of consumer", () => {
    const event = show.events[0]!;
    expect(event.address).toBe("01.01");
    expect(event.module).toBe(1);
    expect(event.pin).toBe(1);
  });

  it("describes the effect for a person reading the file", () => {
    expect(show.events[0]?.description).toBe("6in palm");
  });

  it("keeps a label and leaves it off when there is none", () => {
    expect(show.events[0]?.label).toBe("opener");
    expect("label" in (show.events[1] ?? {})).toBe(false);
  });

  it("writes the occupancy window as a pair", () => {
    const window = show.events[0]!.occupancyMs;
    expect(window[1]).toBeGreaterThan(window[0]);
  });

  it("summarises the show", () => {
    expect(show.cueCount).toBe(2);
    expect(show.summary.peakLit).toBeGreaterThan(0);
    expect(show.summary.litMs).toBeGreaterThan(0);
  });

  it("leaves the rig out unless it was given one", () => {
    expect("positions" in show).toBe(false);
    const withRig = toJsonShow(built, { rig });
    expect(withRig.positions).toHaveLength(2);
    expect(withRig.positions?.[1]).toEqual({
      id: "pad.b",
      east: 40,
      north: 10,
      modules: [2],
    });
  });

  it("names the show something rather than nothing", () => {
    expect(toJsonShow(built).name).toBe("show");
  });
});

describe("writeShowJson and readShowJson", () => {
  it("round trips", () => {
    const text = writeShowJson(built, { name: "autumn" });
    const read = readShowJson(text);
    expect(read?.name).toBe("autumn");
    expect(read?.events).toHaveLength(2);
  });

  it("writes compact json on request", () => {
    expect(writeShowJson(built, {}, false).includes("\n")).toBe(false);
  });

  it("refuses text that is not json", () => {
    expect(readShowJson("not json")).toBeUndefined();
  });

  it("refuses json that is not a show", () => {
    expect(readShowJson('{"hello":true}')).toBeUndefined();
    expect(readShowJson("[]")).toBeUndefined();
    expect(readShowJson("null")).toBeUndefined();
  });

  it("refuses a version it does not know", () => {
    expect(readShowJson('{"version":99,"events":[]}')).toBeUndefined();
  });

  it("accepts a show with no cues", () => {
    const text = writeShowJson(scheduleOf(""), { name: "quiet" });
    expect(readShowJson(text)?.cueCount).toBe(0);
  });
});

describe("consumer helpers", () => {
  const show = toJsonShow(built, { name: "autumn" });

  it("describes a show in one line", () => {
    expect(describeJsonShow(show)).toContain("autumn, 2 cues");
    expect(describeJsonShow(show)).toContain("25fps");
  });

  it("finds the cues inside a window", () => {
    expect(cuesBetween(show, 0, 21000)).toEqual([1]);
    expect(cuesBetween(show, 0, 30000)).toEqual([1, 2]);
    expect(cuesBetween(show, 60000, 70000)).toEqual([]);
  });

  it("writes plain lines for a consumer that cannot parse json", () => {
    const lines = jsonShowLines(show);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("01.01");
    expect(lines[0]).toContain("shell.150");
  });
});

describe("isQuantised", () => {
  it("tells a quantised schedule from a raw one", () => {
    expect(isQuantised(built)).toBe(true);
    expect(isQuantised({ events: [], preRoll: ms(0), duration: ms(0) })).toBe(
      false,
    );
  });
});

describe("a show drawn from a magazine", () => {
  function drawnShow() {
    const parsed = parseScript(
      new SourceFile("show.pf", "at 20 fire shell.150 from pad.a label opener"),
    );
    const expanded = expandScript(parsed.script.statements, { seed: "t" });
    const resolved = resolveShots(expanded.shots, catalog, rig);
    const drawn = resolved.shots.map((shot) => ({
      ...shot,
      lot: "vn2405",
      substitutedFor: "shell.150.other",
    }));
    return quantiseSchedule(
      buildSchedule(allocatePins(drawn, rig).assignments),
      SMPTE_25,
    );
  }

  it("carries the lot and what it stood in for", () => {
    const json = toJsonShow(drawnShow());
    expect(json.events[0]?.lot).toBe("vn2405");
    expect(json.events[0]?.substitutedFor).toBe("shell.150.other");
  });

  it("leaves both out when there was no magazine", () => {
    const json = toJsonShow(scheduleOf("at 20 fire shell.150 from pad.a"));
    expect("lot" in (json.events[0] ?? {})).toBe(false);
    expect("substitutedFor" in (json.events[0] ?? {})).toBe(false);
  });
});
