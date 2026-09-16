import { describe, expect, it } from "vitest";
import {
  bandOf,
  calibre,
  compareCalibres,
  fitsMortar,
  formatCalibre,
  mortarBore,
  parseCalibre,
  sameCalibre,
  spokenCalibre,
  standardCalibres,
} from "../../src/catalog/calibre.js";
import { inches, mm, raw } from "../../src/core/units.js";

describe("calibre", () => {
  it("labels a standard size in inches", () => {
    expect(calibre(mm(150)).inchLabel).toBe("6");
    expect(calibre(mm(75)).inchLabel).toBe("3");
    expect(calibre(mm(63)).inchLabel).toBe("2.5");
  });

  it("labels a size between the standards from its own conversion", () => {
    expect(calibre(mm(175)).inchLabel).toBe("6.9");
  });

  it("keeps the size it was given rather than the nominal one", () => {
    expect(raw(calibre(inches(6)).size)).toBeCloseTo(152.4, 3);
  });
});

describe("parseCalibre", () => {
  it("reads millimetres", () => {
    expect(raw(parseCalibre("150mm")!.size)).toBe(150);
    expect(raw(parseCalibre("150 millimetres")!.size)).toBe(150);
  });

  it("reads inches in every spelling", () => {
    expect(raw(parseCalibre("6in")!.size)).toBeCloseTo(152.4, 3);
    expect(raw(parseCalibre('6"')!.size)).toBeCloseTo(152.4, 3);
    expect(raw(parseCalibre("6 inches")!.size)).toBeCloseTo(152.4, 3);
  });

  it("guesses a bare number from its size", () => {
    expect(raw(parseCalibre("150")!.size)).toBe(150);
    expect(raw(parseCalibre("6")!.size)).toBeCloseTo(152.4, 3);
  });

  it("takes a fraction of an inch", () => {
    expect(parseCalibre("2.5in")!.inchLabel).toBe("2.5");
  });

  it("ignores surrounding space and case", () => {
    expect(raw(parseCalibre("  150 MM ")!.size)).toBe(150);
  });

  it("refuses nonsense", () => {
    expect(parseCalibre("big")).toBeUndefined();
    expect(parseCalibre("")).toBeUndefined();
    expect(parseCalibre("0mm")).toBeUndefined();
    expect(parseCalibre("6 feet")).toBeUndefined();
  });
});

describe("formatting", () => {
  it("prints millimetres for a table", () => {
    expect(formatCalibre(calibre(mm(150)))).toBe("150mm");
    expect(formatCalibre(calibre(inches(6)))).toBe("152mm");
  });

  it("prints inches for a person", () => {
    expect(spokenCalibre(calibre(mm(150)))).toBe("6in");
    expect(spokenCalibre(calibre(mm(63)))).toBe("2.5in");
  });
});

describe("bandOf", () => {
  it("bands by where the handling changes", () => {
    expect(bandOf(calibre(mm(50)))).toBe("small");
    expect(bandOf(calibre(mm(75)))).toBe("medium");
    expect(bandOf(calibre(mm(125)))).toBe("medium");
    expect(bandOf(calibre(mm(150)))).toBe("large");
    expect(bandOf(calibre(mm(200)))).toBe("large");
    expect(bandOf(calibre(mm(250)))).toBe("salute-class");
  });
});

describe("comparison", () => {
  it("orders by size", () => {
    expect(compareCalibres(calibre(mm(75)), calibre(mm(150)))).toBeLessThan(0);
    expect(compareCalibres(calibre(mm(150)), calibre(mm(75)))).toBeGreaterThan(
      0,
    );
  });

  it("says equal sizes are the same", () => {
    expect(sameCalibre(calibre(mm(150)), calibre(mm(150)))).toBe(true);
    expect(sameCalibre(calibre(mm(150)), calibre(mm(125)))).toBe(false);
  });
});

describe("mortars", () => {
  it("widens the bore by the handling clearance", () => {
    expect(raw(mortarBore(calibre(mm(75))))).toBe(77);
    expect(raw(mortarBore(calibre(mm(150))))).toBe(153);
    expect(raw(mortarBore(calibre(mm(250))))).toBe(255);
  });

  it("accepts a mortar with a workable gap", () => {
    const six = calibre(mm(150));
    expect(fitsMortar(six, mm(153))).toBe(true);
    expect(fitsMortar(six, mm(160))).toBe(true);
  });

  it("rejects a mortar that is too tight or too loose", () => {
    const six = calibre(mm(150));
    expect(fitsMortar(six, mm(150))).toBe(false);
    expect(fitsMortar(six, mm(170))).toBe(false);
    expect(fitsMortar(six, mm(140))).toBe(false);
  });
});

describe("standardCalibres", () => {
  it("lists the catalogue sizes in order", () => {
    const sizes = standardCalibres().map((value) => raw(value.size));
    expect(sizes[0]).toBe(25);
    expect(sizes[sizes.length - 1]).toBe(400);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  it("labels every one of them in inches", () => {
    for (const value of standardCalibres()) {
      expect(value.inchLabel).not.toContain(".0");
    }
  });
});
