import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { GroundPiece, Mine } from "../../src/catalog/effect.js";
import {
  describeSeparation,
  largestCalibreFor,
  needsJustification,
  separationFor,
  separationForEffect,
  worstSeparation,
} from "../../src/safety/distance.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms, raw, toFeet } from "../../src/core/units.js";

const six = calibre(mm(150));
const three = calibre(mm(75));

describe("nfpa 1123", () => {
  it("gives seventy feet per inch of bore", () => {
    expect(toFeet(separationFor(six))).toBeCloseTo(420, 0);
    expect(toFeet(separationFor(three))).toBeCloseTo(210, 0);
  });

  it("rounds a metric bore up to the next half inch", () => {
    expect(toFeet(separationFor(calibre(mm(152))))).toBeCloseTo(420, 0);
    expect(toFeet(separationFor(calibre(mm(155))))).toBeCloseTo(455, 0);
  });

  it("puts a six inch shell further out than most people guess", () => {
    expect(raw(separationFor(six))).toBeGreaterThan(125);
  });

  it("rises with bore", () => {
    const sizes = [50, 75, 100, 150, 200, 300];
    const distances = sizes.map((size) =>
      raw(separationFor(calibre(mm(size)))),
    );
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]!).toBeGreaterThan(distances[i - 1]!);
    }
  });
});

describe("the other rules", () => {
  it("halves the distance under the reduced rule", () => {
    expect(raw(separationFor(six, "reduced"))).toBeCloseTo(
      raw(separationFor(six)) / 2,
      5,
    );
  });

  it("uses a banded table for the european rule", () => {
    expect(raw(separationFor(calibre(mm(150)), "cen-category-4"))).toBe(125);
    expect(raw(separationFor(calibre(mm(130)), "cen-category-4"))).toBe(125);
    expect(raw(separationFor(calibre(mm(75)), "cen-category-4"))).toBe(50);
  });

  it("does not give the same answer as the american rule", () => {
    expect(raw(separationFor(six, "cen-category-4"))).not.toBeCloseTo(
      raw(separationFor(six, "nfpa-1123")),
      0,
    );
  });

  it("holds the top band for anything past the table", () => {
    expect(raw(separationFor(calibre(mm(600)), "cen-category-4"))).toBe(350);
  });
});

describe("per effect", () => {
  const aShell = shell({
    id: effectId("shell.150"),
    name: "six",
    calibre: six,
  });
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
    id: effectId("gerb"),
    name: "gerb",
    style: "gerb",
    duration: ms(30000),
    height: metres(4),
  };

  it("uses the bore for a shell", () => {
    expect(raw(separationForEffect(aShell))).toBeCloseTo(
      raw(separationFor(six)),
      5,
    );
  });

  it("gives a mine less than its bore would ask for", () => {
    expect(raw(separationForEffect(mine))).toBeLessThan(
      raw(separationFor(calibre(mm(100)))),
    );
  });

  it("never puts anything closer than twenty five metres", () => {
    expect(raw(separationForEffect(gerb))).toBe(25);
    const tiny = { ...mine, height: metres(1), spreadAngle: 5 };
    expect(raw(separationForEffect(tiny))).toBeGreaterThanOrEqual(25);
  });

  it("lets a wide mine ask for more than a narrow one", () => {
    const wide = { ...mine, spreadAngle: 140, height: metres(50) };
    expect(raw(separationForEffect(wide))).toBeGreaterThan(
      raw(separationForEffect(mine)),
    );
  });

  it("takes the worst effect in a show", () => {
    expect(raw(worstSeparation([gerb, mine, aShell]))).toBeCloseTo(
      raw(separationForEffect(aShell)),
      5,
    );
  });

  it("asks for nothing when there is nothing to fire", () => {
    expect(raw(worstSeparation([]))).toBe(0);
  });
});

describe("largestCalibreFor", () => {
  it("finds the biggest bore a field can take", () => {
    const size = largestCalibreFor(separationFor(six));
    expect(size).toBeGreaterThanOrEqual(150);
    expect(size).toBeLessThan(175);
  });

  it("is one millimetre short of allowing a bore it cannot fit", () => {
    const justUnder = metres(raw(separationFor(six)) - 0.1);
    expect(largestCalibreFor(justUnder)).toBeLessThan(150);
  });

  it("allows a bigger bore under the reduced rule", () => {
    expect(largestCalibreFor(metres(130), "reduced")).toBeGreaterThan(
      largestCalibreFor(metres(130)),
    );
  });

  it("allows nothing on a field with no room", () => {
    expect(largestCalibreFor(metres(5))).toBe(0);
  });
});

describe("reporting", () => {
  it("quotes both metres and feet and the rule", () => {
    const line = describeSeparation(six);
    expect(line).toContain("6in needs 128m (420ft)");
    expect(line).toContain("nfpa-1123");
  });

  it("flags the bores that need a written justification", () => {
    expect(needsJustification(six)).toBe(true);
    expect(needsJustification(three)).toBe(false);
  });
});
