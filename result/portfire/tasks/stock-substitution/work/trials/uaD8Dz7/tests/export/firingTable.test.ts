import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import type { Mine } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { parseCsv } from "../../src/core/csv.js";
import {
  canWrite,
  firingTableCsv,
  firingTableRows,
  rowCount,
  uniformPinsPerModule,
} from "../../src/export/firingTable.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { SMPTE_25 } from "../../src/core/timecode.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { metres, mm, ms } from "../../src/core/units.js";

const mine: Mine = {
  kind: "mine",
  id: effectId("mine.100"),
  name: "mine",
  calibre: calibre(mm(100)),
  spreadAngle: 40,
  height: metres(35),
  hangTime: ms(1800),
};
const catalog = Catalog.from([mine]);
const fc32 = modelNamed("fc-32")!;
const rig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  [
    firingModule(1, fc32, positionId("pad.a")),
    firingModule(2, fc32, positionId("pad.a")),
  ],
);
const mixedRig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  [
    firingModule(1, fc32, positionId("pad.a")),
    firingModule(2, modelNamed("fc-16")!, positionId("pad.a")),
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
    "at 10 fire mine.100 from pad.a label opener",
    "at 12 fire mine.100 from pad.a",
  ].join("\n"),
);

describe("rows", () => {
  it("numbers cues from one", () => {
    expect(firingTableRows(built).map((row) => row[0])).toEqual(["1", "2"]);
  });

  it("writes the ignition time, not the cue time", () => {
    expect(firingTableRows(built)[0]?.[1]).toBe("0:09.970");
  });

  it("writes the effect, the position and the label", () => {
    const row = firingTableRows(built)[0];
    expect(row?.[3]).toBe("mine.100");
    expect(row?.[4]).toBe("pad.a");
    expect(row?.[5]).toBe("opener");
  });

  it("leaves the note empty when there is no label", () => {
    expect(firingTableRows(built)[1]?.[5]).toBe("");
  });
});

describe("address styles", () => {
  it("writes a dotted address by default", () => {
    expect(firingTableRows(built)[0]?.[2]).toBe("01.01");
  });

  it("writes a flat index counting from one", () => {
    const rows = firingTableRows(built, {
      addressStyle: "flat",
      pinsPerModule: 32,
    });
    expect(rows[0]?.[2]).toBe("1");
    expect(rows[1]?.[2]).toBe("33");
  });

  it("writes a module and pin pair", () => {
    expect(firingTableRows(built, { addressStyle: "module-pin" })[1]?.[2]).toBe(
      "2,1",
    );
  });
});

describe("time styles", () => {
  it("writes raw milliseconds", () => {
    expect(firingTableRows(built, { timeStyle: "milliseconds" })[0]?.[1]).toBe(
      "9970",
    );
  });

  it("writes timecode", () => {
    expect(
      firingTableRows(built, {
        timeStyle: "timecode",
        format: SMPTE_25,
      })[0]?.[1],
    ).toBe("00:00:09:24");
  });
});

describe("csv", () => {
  it("writes a header by default", () => {
    const parsed = parseCsv(firingTableCsv(built));
    expect(parsed[0]?.fields[0]).toBe("cue");
    expect(parsed).toHaveLength(3);
  });

  it("can leave the header out", () => {
    expect(
      parseCsv(firingTableCsv(built, { includeHeader: false })),
    ).toHaveLength(2);
  });

  it("quotes a label with a comma in it", () => {
    const withComma = scheduleOf(
      'at 10 fire mine.100 from pad.a label "one, two"',
    );
    expect(firingTableCsv(withComma)).toContain('"one, two"');
  });

  it("round trips through the csv reader", () => {
    const parsed = parseCsv(firingTableCsv(built));
    expect(parsed[1]?.fields[3]).toBe("mine.100");
  });

  it("writes just a header for an empty show", () => {
    expect(parseCsv(firingTableCsv(scheduleOf("")))).toHaveLength(1);
  });
});

describe("rig checks", () => {
  it("finds a uniform pin count", () => {
    expect(uniformPinsPerModule(rig)).toBe(32);
  });

  it("finds none on a mixed rig", () => {
    expect(uniformPinsPerModule(mixedRig)).toBeUndefined();
    expect(uniformPinsPerModule(new Rig())).toBeUndefined();
  });

  it("allows the dotted style on any rig", () => {
    expect(canWrite(mixedRig, "dotted").ok).toBe(true);
  });

  it("refuses a flat address on a mixed rig and says why", () => {
    const check = canWrite(mixedRig, "flat");
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("same pin count");
  });

  it("counts the rows for a firmware limit", () => {
    expect(rowCount(built)).toBe(2);
  });
});
