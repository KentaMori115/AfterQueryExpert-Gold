import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { Cake, GroundPiece, Mine } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { validateCatalog, validateEffect } from "../../src/catalog/validate.js";
import { DiagnosticBag } from "../../src/core/diagnostic.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms } from "../../src/core/units.js";

const good = shell({
  id: effectId("shell.150.palm"),
  name: "six inch palm",
  calibre: calibre(mm(150)),
  breakStyle: "palm",
});

function codesFor(
  effect: Parameters<typeof validateEffect>[0],
  options?: Parameters<typeof validateEffect>[2],
): string[] {
  const bag = new DiagnosticBag();
  validateEffect(effect, bag, options ?? {});
  return bag.all().map((diagnostic) => diagnostic.code);
}

describe("a sound entry", () => {
  it("raises nothing", () => {
    expect(codesFor(good)).toEqual([]);
  });
});

describe("calibre", () => {
  it("errors on a calibre of zero", () => {
    const broken = { ...good, calibre: calibre(mm(0)) };
    expect(codesFor(broken)).toContain("PF1103");
  });

  it("warns above the measured lift table", () => {
    const huge = shell({
      id: effectId("shell.500"),
      name: "twenty",
      calibre: calibre(mm(500)),
    });
    expect(codesFor(huge)).toContain("PF1104");
  });

  it("warns below the measured lift table", () => {
    const tiny = shell({
      id: effectId("shell.30"),
      name: "tiny",
      calibre: calibre(mm(30)),
    });
    expect(codesFor(tiny)).toContain("PF1105");
  });

  it("warns when the site cannot take the bore", () => {
    expect(codesFor(good, { maxCalibreMm: 100 })).toContain("PF1106");
    expect(codesFor(good, { maxCalibreMm: 200 })).not.toContain("PF1106");
  });
});

describe("shells", () => {
  it("errors on no hang time and no break", () => {
    const dead = { ...good, hangTime: ms(0), breakDiameter: metres(0) };
    const codes = codesFor(dead);
    expect(codes).toContain("PF1107");
    expect(codes).toContain("PF1109");
  });

  it("warns on a hang time that looks like seconds", () => {
    expect(codesFor({ ...good, hangTime: ms(2) })).toContain("PF1108");
  });

  it("warns on an implausible break diameter", () => {
    expect(codesFor({ ...good, breakDiameter: metres(400) })).toContain(
      "PF1110",
    );
  });

  it("warns when a lowered break sits above apogee", () => {
    expect(codesFor({ ...good, breakHeight: metres(900) })).toContain("PF1111");
  });

  it("accepts a genuine lowered break", () => {
    expect(codesFor({ ...good, breakHeight: metres(90) })).toEqual([]);
  });

  it("warns about a small salute", () => {
    const salute = shell({
      id: effectId("shell.50.salute"),
      name: "small salute",
      calibre: calibre(mm(50)),
      breakStyle: "salute",
    });
    expect(codesFor(salute)).toContain("PF1112");
  });
});

describe("cakes", () => {
  const cake: Cake = {
    kind: "cake",
    id: effectId("cake.silver"),
    name: "silver",
    calibre: calibre(mm(30)),
    shots: 25,
    shotInterval: ms(200),
    hangTime: ms(1000),
  };

  it("accepts an ordinary cake", () => {
    expect(codesFor(cake)).toEqual([]);
  });

  it("errors on no shots and no interval", () => {
    const codes = codesFor({ ...cake, shots: 0, shotInterval: ms(0) });
    expect(codes).toContain("PF1113");
    expect(codes).toContain("PF1114");
  });

  it("warns on an interval under a frame", () => {
    expect(codesFor({ ...cake, shotInterval: ms(10) })).toContain("PF1115");
  });

  it("warns on a cake that runs for minutes", () => {
    expect(codesFor({ ...cake, shots: 500, shotInterval: ms(500) })).toContain(
      "PF1116",
    );
  });
});

describe("mines and ground pieces", () => {
  const mine: Mine = {
    kind: "mine",
    id: effectId("mine.100"),
    name: "mine",
    calibre: calibre(mm(100)),
    spreadAngle: 40,
    height: metres(35),
    hangTime: ms(1800),
  };
  const gerb: GroundPiece = {
    kind: "ground",
    id: effectId("gerb.silver"),
    name: "gerb",
    style: "gerb",
    duration: ms(30000),
    height: metres(4),
  };

  it("accepts an ordinary mine and gerb", () => {
    expect(codesFor(mine)).toEqual([]);
    expect(codesFor(gerb)).toEqual([]);
  });

  it("warns on an impossible spread", () => {
    expect(codesFor({ ...mine, spreadAngle: 0 })).toContain("PF1117");
    expect(codesFor({ ...mine, spreadAngle: 200 })).toContain("PF1117");
  });

  it("warns on a mine that climbs like a shell", () => {
    expect(codesFor({ ...mine, height: metres(120) })).toContain("PF1118");
  });

  it("errors on a ground piece that burns for no time", () => {
    expect(codesFor({ ...gerb, duration: ms(0) })).toContain("PF1100");
  });

  it("warns on a ten minute burn and a tall ground piece", () => {
    expect(codesFor({ ...gerb, duration: ms(900000) })).toContain("PF1101");
    expect(codesFor({ ...gerb, height: metres(60) })).toContain("PF1102");
  });
});

describe("validateCatalog", () => {
  it("checks every entry", () => {
    const catalog = Catalog.from([good, { ...good, id: effectId("shell.b") }]);
    expect(validateCatalog(catalog).hasErrors()).toBe(false);
  });

  it("warns when two entries print the same name", () => {
    const catalog = Catalog.from([
      good,
      { ...good, id: effectId("shell.b"), name: "Six Inch Palm" },
    ]);
    const codes = validateCatalog(catalog).byCode("PF1119");
    expect(codes).toHaveLength(1);
    expect(codes[0]?.help).toContain("shell.b");
  });

  it("passes the options down to each entry", () => {
    const catalog = Catalog.from([good]);
    expect(validateCatalog(catalog, { maxCalibreMm: 75 }).size).toBe(1);
  });
});
