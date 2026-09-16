import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { Lot } from "../../src/catalog/inventory.js";
import {
  Magazine,
  compareDrawOrder,
  describeShortfall,
  shortfall,
  tally,
  unusedStock,
} from "../../src/catalog/inventory.js";
import { Catalog } from "../../src/catalog/registry.js";
import { effectId } from "../../src/core/ids.js";
import { mm } from "../../src/core/units.js";

const lots = [
  { lotNumber: "vn2405", effectId: "shell.150.palm", quantity: 20 },
  { lotNumber: "vn2413", effectId: "shell.150.palm", quantity: 26 },
  { lotNumber: "vn2405", effectId: "shell.75.peony", quantity: 60 },
  { lotNumber: "cx1102", effectId: "cake.silver", quantity: 4 },
];

describe("receiving", () => {
  it("counts lots and units", () => {
    const magazine = Magazine.from(lots);
    expect(magazine.lotCount).toBe(4);
    expect(magazine.onHand("shell.150.palm")).toBe(46);
  });

  it("adds a split delivery to the same lot", () => {
    const magazine = Magazine.from(lots).receive({
      lotNumber: "vn2405",
      effectId: "shell.150.palm",
      quantity: 5,
    });
    expect(magazine.lotCount).toBe(4);
    expect(magazine.onHand("shell.150.palm")).toBe(51);
  });

  it("keeps the same lot number under two effects apart", () => {
    const magazine = Magazine.from(lots);
    expect(magazine.byLotNumber("vn2405")).toHaveLength(2);
  });

  it("reports nothing on hand for an effect it does not hold", () => {
    expect(Magazine.from(lots).onHand("mine.100")).toBe(0);
    expect(Magazine.from(lots).lotsFor("mine.100")).toEqual([]);
  });

  it("refuses a nonsense quantity", () => {
    const magazine = new Magazine();
    expect(() =>
      magazine.receive({ lotNumber: "a", effectId: "b", quantity: -1 }),
    ).toThrow(/quantity/);
    expect(() =>
      magazine.receive({ lotNumber: "a", effectId: "b", quantity: 1.5 }),
    ).toThrow(/quantity/);
  });
});

describe("stock listing", () => {
  it("lists effects in reading order", () => {
    expect(Magazine.from(lots).effectIds()).toEqual([
      "cake.silver",
      "shell.75.peony",
      "shell.150.palm",
    ]);
  });

  it("gives the total and the lots behind it", () => {
    const line = Magazine.from(lots)
      .stock()
      .find((entry) => entry.effectId === "shell.150.palm");
    expect(line?.onHand).toBe(46);
    expect(line?.lots).toHaveLength(2);
  });

  it("lists nothing for an empty magazine", () => {
    expect(new Magazine().stock()).toEqual([]);
  });
});

describe("quarantine", () => {
  it("pulls every unit of a lot and says how many went", () => {
    const magazine = Magazine.from(lots);
    expect(magazine.quarantine("vn2405")).toBe(80);
    expect(magazine.onHand("shell.150.palm")).toBe(26);
    expect(magazine.onHand("shell.75.peony")).toBe(0);
  });

  it("does nothing for a lot it does not hold", () => {
    const magazine = Magazine.from(lots);
    expect(magazine.quarantine("nothing")).toBe(0);
    expect(magazine.lotCount).toBe(4);
  });
});

describe("orphans", () => {
  it("names stock the catalog does not define", () => {
    const catalog = Catalog.from([
      shell({
        id: effectId("shell.150.palm"),
        name: "palm",
        calibre: calibre(mm(150)),
      }),
    ]);
    expect(Magazine.from(lots).orphans(catalog)).toEqual([
      "cake.silver",
      "shell.75.peony",
    ]);
  });
});

describe("shortfall", () => {
  const magazine = Magazine.from(lots);

  it("finds what is missing and by how much", () => {
    const needed = new Map([
      ["shell.150.palm", 60],
      ["cake.silver", 2],
    ]);
    const lines = shortfall(needed, magazine);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      effectId: "shell.150.palm",
      needed: 60,
      onHand: 46,
      short: 14,
    });
  });

  it("counts an effect held at zero as entirely short", () => {
    const lines = shortfall(new Map([["mine.100", 8]]), magazine);
    expect(lines[0]?.short).toBe(8);
  });

  it("finds nothing when stock covers the show", () => {
    expect(shortfall(new Map([["cake.silver", 4]]), magazine)).toEqual([]);
  });

  it("sorts by effect name", () => {
    const needed = new Map([
      ["shell.150.palm", 99],
      ["cake.silver", 99],
    ]);
    expect(shortfall(needed, magazine).map((line) => line.effectId)).toEqual([
      "cake.silver",
      "shell.150.palm",
    ]);
  });
});

describe("unusedStock", () => {
  it("names what no show touches", () => {
    const needed = new Map([["shell.150.palm", 1]]);
    expect(unusedStock(needed, Magazine.from(lots))).toEqual([
      "cake.silver",
      "shell.75.peony",
    ]);
  });
});

describe("describeShortfall", () => {
  it("says so when there is nothing missing", () => {
    expect(describeShortfall([])).toContain("in stock");
  });

  it("names each line with a plural that agrees", () => {
    const text = describeShortfall([
      { effectId: "shell.150.palm", needed: 2, onHand: 1, short: 1 },
      { effectId: "cake.silver", needed: 9, onHand: 4, short: 5 },
    ]);
    expect(text).toContain("short by 1 unit");
    expect(text).toContain("short by 5 units");
  });
});

describe("tally", () => {
  it("counts repeats of the same effect", () => {
    const palm = shell({
      id: effectId("shell.150.palm"),
      name: "palm",
      calibre: calibre(mm(150)),
    });
    const counts = tally([palm, palm, { ...palm, id: effectId("shell.b") }]);
    expect(counts.get("shell.150.palm")).toBe(2);
    expect(counts.get("shell.b")).toBe(1);
  });

  it("counts nothing for an empty list", () => {
    expect(tally([]).size).toBe(0);
  });
});

describe("drawing stock", () => {
  const dated = [
    { lotNumber: "vn3", effectId: "shell.150.palm", quantity: 1 },
    {
      lotNumber: "vn2",
      effectId: "shell.150.palm",
      quantity: 1,
      received: "2025-05-01",
    },
    {
      lotNumber: "vn1",
      effectId: "shell.150.palm",
      quantity: 2,
      received: "2025-04-01",
    },
  ];

  it("orders the lots oldest first with the undated last", () => {
    expect(
      Magazine.from(dated)
        .lotsInDrawOrder("shell.150.palm")
        .map((lot) => lot.lotNumber),
    ).toEqual(["vn1", "vn2", "vn3"]);
  });

  it("breaks a tie on the same date with the lot number", () => {
    const same = Magazine.from([
      { lotNumber: "vn9", effectId: "a", quantity: 1, received: "2025-04-01" },
      { lotNumber: "vn4", effectId: "a", quantity: 1, received: "2025-04-01" },
    ]);
    expect(same.lotsInDrawOrder("a").map((lot) => lot.lotNumber)).toEqual([
      "vn4",
      "vn9",
    ]);
    expect(compareDrawOrder(...(same.allLots() as [Lot, Lot]))).toBeGreaterThan(
      0,
    );
  });

  it("puts an undated lot behind a dated one either way round", () => {
    const undated: Lot = { lotNumber: "vn3", effectId: "a", quantity: 1 };
    const dated: Lot = {
      lotNumber: "vn1",
      effectId: "a",
      quantity: 1,
      received: "2025-04-01",
    };
    expect(compareDrawOrder(undated, dated)).toBe(1);
    expect(compareDrawOrder(dated, undated)).toBe(-1);
    expect(compareDrawOrder(dated, dated)).toBe(0);
  });

  it("takes one unit at a time and empties a lot before moving on", () => {
    const magazine = Magazine.from(dated);
    expect(magazine.draw("shell.150.palm")).toBe("vn1");
    expect(magazine.draw("shell.150.palm")).toBe("vn1");
    expect(magazine.draw("shell.150.palm")).toBe("vn2");
    expect(magazine.lotCount).toBe(1);
    expect(magazine.draw("shell.150.palm")).toBe("vn3");
    expect(magazine.draw("shell.150.palm")).toBeUndefined();
    expect(magazine.onHand("shell.150.palm")).toBe(0);
  });

  it("draws nothing for an effect it never held", () => {
    expect(Magazine.from(dated).draw("mine.100")).toBeUndefined();
  });

  it("copies without sharing the stock", () => {
    const magazine = Magazine.from(dated);
    const copy = magazine.copy();
    copy.draw("shell.150.palm");
    copy.quarantine("vn3");
    expect(copy.onHand("shell.150.palm")).toBe(2);
    expect(magazine.onHand("shell.150.palm")).toBe(4);
    expect(magazine.allLots()).toHaveLength(3);
  });
});
