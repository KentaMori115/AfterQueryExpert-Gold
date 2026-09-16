import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { Cake, GroundPiece } from "../../src/catalog/effect.js";
import {
  checkStore,
  classFor,
  divisionFor,
  hazardClass,
  hazardTotals,
  heaviestItems,
  netExplosiveGrams,
  transportLines,
} from "../../src/catalog/hazard.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms } from "../../src/core/units.js";

const three = shell({
  id: effectId("shell.75"),
  name: "three",
  calibre: calibre(mm(75)),
});
const six = shell({
  id: effectId("shell.150"),
  name: "six",
  calibre: calibre(mm(150)),
});
const bigSalute = shell({
  id: effectId("shell.150.salute"),
  name: "six salute",
  calibre: calibre(mm(150)),
  breakStyle: "salute",
});
const smallSalute = shell({
  id: effectId("shell.50.salute"),
  name: "two salute",
  calibre: calibre(mm(50)),
  breakStyle: "salute",
});
const tiny = shell({
  id: effectId("shell.30"),
  name: "tiny",
  calibre: calibre(mm(30)),
});
const cake: Cake = {
  kind: "cake",
  id: effectId("cake.silver"),
  name: "silver",
  calibre: calibre(mm(50)),
  shots: 25,
  shotInterval: ms(200),
  hangTime: ms(1000),
};
const gerb: GroundPiece = {
  kind: "ground",
  id: effectId("gerb"),
  name: "gerb",
  style: "gerb",
  duration: ms(20000),
  height: metres(4),
};

describe("hazardClass", () => {
  it("maps every division onto its UN number", () => {
    expect(hazardClass("1.3G").unNumber).toBe("UN0335");
    expect(hazardClass("1.1G").unNumber).toBe("UN0333");
    expect(hazardClass("1.4S").unNumber).toBe("UN0337");
  });
});

describe("netExplosiveGrams", () => {
  it("puts a three inch and a six inch in the right range", () => {
    expect(netExplosiveGrams(three)).toBeGreaterThan(40);
    expect(netExplosiveGrams(three)).toBeLessThan(90);
    expect(netExplosiveGrams(six)).toBeGreaterThan(400);
    expect(netExplosiveGrams(six)).toBeLessThan(560);
  });

  it("scales with the cube of the calibre", () => {
    const ratio = netExplosiveGrams(six) / netExplosiveGrams(three);
    expect(ratio).toBeGreaterThan(7);
    expect(ratio).toBeLessThan(9);
  });

  it("counts every shot of a cake", () => {
    expect(netExplosiveGrams(cake)).toBeGreaterThan(
      netExplosiveGrams({ ...cake, shots: 1 }) * 20,
    );
  });

  it("gives a ground piece a small flat figure", () => {
    expect(netExplosiveGrams(gerb)).toBe(30);
  });
});

describe("divisionFor", () => {
  it("puts a display shell in 1.3G", () => {
    expect(divisionFor(six)).toBe("1.3G");
    expect(divisionFor(three)).toBe("1.3G");
  });

  it("puts a large salute in 1.1G", () => {
    expect(divisionFor(bigSalute)).toBe("1.1G");
  });

  it("leaves a small salute in 1.3G", () => {
    expect(divisionFor(smallSalute)).toBe("1.3G");
  });

  it("puts a very small item in 1.4G", () => {
    expect(divisionFor(tiny)).toBe("1.4G");
  });

  it("puts a small ground piece in 1.4S", () => {
    expect(divisionFor(gerb)).toBe("1.4S");
  });

  it("gives every item a UN number", () => {
    for (const effect of [three, six, bigSalute, tiny, gerb, cake]) {
      expect(classFor(effect).unNumber).toMatch(/^UN\d{4}$/);
    }
  });
});

describe("hazardTotals", () => {
  it("adds the net quantity across a show", () => {
    const totals = hazardTotals([three, six]);
    expect(totals.totalGrams).toBe(
      netExplosiveGrams(three) + netExplosiveGrams(six),
    );
  });

  it("multiplies by the count when it was given one", () => {
    const totals = hazardTotals([six], new Map([["shell.150", 10]]));
    expect(totals.totalGrams).toBe(netExplosiveGrams(six) * 10);
  });

  it("splits the total by division", () => {
    const totals = hazardTotals([six, bigSalute, gerb]);
    expect(totals.byDivision.get("1.3G")).toBe(netExplosiveGrams(six));
    expect(totals.byDivision.get("1.1G")).toBe(netExplosiveGrams(bigSalute));
    expect(totals.byDivision.get("1.4S")).toBe(30);
  });

  it("reports the most restrictive division present", () => {
    expect(hazardTotals([six, gerb]).worst).toBe("1.3G");
    expect(hazardTotals([six, bigSalute]).worst).toBe("1.1G");
    expect(hazardTotals([gerb]).worst).toBe("1.4S");
  });

  it("reports nothing for an empty show", () => {
    const totals = hazardTotals([]);
    expect(totals.totalGrams).toBe(0);
    expect(totals.worst).toBeUndefined();
  });
});

describe("checkStore", () => {
  const licence = {
    capacityKg: 25,
    divisions: ["1.3G", "1.4G", "1.4S"] as const,
  };

  it("passes a show inside the licence", () => {
    const totals = hazardTotals([six], new Map([["shell.150", 10]]));
    expect(checkStore(totals, licence).size).toBe(0);
  });

  it("fails a show over the capacity", () => {
    const totals = hazardTotals([six], new Map([["shell.150", 200]]));
    const diagnostics = checkStore(totals, licence);
    expect(diagnostics.byCode("PF1700")[0]?.help).toContain(
      "split the delivery",
    );
  });

  it("warns close to the capacity", () => {
    const totals = hazardTotals([six], new Map([["shell.150", 50]]));
    const diagnostics = checkStore(totals, licence);
    expect(diagnostics.byCode("PF1701")).toHaveLength(1);
    expect(diagnostics.hasErrors()).toBe(false);
  });

  it("fails a division the licence does not cover", () => {
    const totals = hazardTotals([bigSalute]);
    const diagnostics = checkStore(totals, licence);
    expect(diagnostics.byCode("PF1702")[0]?.help).toContain("1.3G");
  });
});

describe("reporting", () => {
  it("writes a transport line per division, worst first", () => {
    const lines = transportLines(hazardTotals([gerb, bigSalute, six]));
    expect(lines[0]).toContain("UN0333 1.1G");
    expect(lines[lines.length - 1]).toContain("1.4S");
    expect(lines[0]).toContain("kg net");
  });

  it("names the heaviest items", () => {
    const heaviest = heaviestItems(
      [three, six, gerb],
      new Map([["shell.75", 100]]),
      2,
    );
    expect(heaviest).toHaveLength(2);
    expect(heaviest[0]?.effectId).toBe("shell.75");
  });

  it("names nothing for an empty show", () => {
    expect(heaviestItems([])).toEqual([]);
    expect(transportLines(hazardTotals([]))).toEqual([]);
  });
});
