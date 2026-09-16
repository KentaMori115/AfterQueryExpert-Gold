import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { Cake, GroundPiece } from "../../src/catalog/effect.js";
import {
  calibreSpread,
  checkPalette,
  describePalette,
  dominantFamilies,
  familyOf,
  missingFamilies,
  palette,
  varietyIndex,
} from "../../src/catalog/palette.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms } from "../../src/core/units.js";

function shellOf(
  id: string,
  style: Parameters<typeof shell>[0]["breakStyle"],
  size = 150,
) {
  return shell({
    id: effectId(id),
    name: id,
    calibre: calibre(mm(size)),
    ...(style === undefined ? {} : { breakStyle: style }),
  });
}

const peony = shellOf("shell.peony", "peony");
const willow = shellOf("shell.willow", "willow");
const crossette = shellOf("shell.crossette", "crossette");
const salute = shellOf("shell.salute", "salute");
const strobe = shellOf("shell.strobe", "strobe");
const small = shellOf("shell.small", "peony", 50);
const cake: Cake = {
  kind: "cake",
  id: effectId("cake.silver"),
  name: "cake",
  calibre: calibre(mm(30)),
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

describe("familyOf", () => {
  it("groups by what an effect looks like", () => {
    expect(familyOf(peony)).toBe("burst");
    expect(familyOf(willow)).toBe("trailing");
    expect(familyOf(crossette)).toBe("ringed");
    expect(familyOf(salute)).toBe("report");
    expect(familyOf(strobe)).toBe("flashing");
  });

  it("puts a cake and a candle in the low family", () => {
    expect(familyOf(cake)).toBe("low");
  });

  it("puts a ground piece in its own family", () => {
    expect(familyOf(gerb)).toBe("ground");
  });

  it("puts two styles that look alike in one family", () => {
    expect(familyOf(shellOf("a", "chrysanthemum"))).toBe(
      familyOf(shellOf("b", "peony")),
    );
    expect(familyOf(shellOf("c", "kamuro"))).toBe(
      familyOf(shellOf("d", "palm")),
    );
  });
});

describe("palette", () => {
  it("counts shots per family", () => {
    const entries = palette([peony, willow, gerb]);
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.shots === 1)).toBe(true);
  });

  it("multiplies by the counts it was given", () => {
    const entries = palette([peony, willow], new Map([["shell.peony", 30]]));
    const burst = entries.find((entry) => entry.family === "burst");
    expect(burst?.shots).toBe(30);
    expect(burst?.share).toBeCloseTo(30 / 31, 5);
  });

  it("orders families by how much of the show they are", () => {
    const entries = palette([peony, willow], new Map([["shell.willow", 10]]));
    expect(entries[0]?.family).toBe("trailing");
  });

  it("gives nothing for an empty show", () => {
    expect(palette([])).toEqual([]);
  });
});

describe("varietyIndex", () => {
  it("is one when families are even", () => {
    expect(varietyIndex(palette([peony, willow, gerb]))).toBeCloseTo(1, 4);
  });

  it("is zero when the show is one family", () => {
    expect(varietyIndex(palette([peony]))).toBe(0);
  });

  it("falls as one family takes over", () => {
    const even = varietyIndex(palette([peony, willow]));
    const skewed = varietyIndex(
      palette([peony, willow], new Map([["shell.peony", 50]])),
    );
    expect(skewed).toBeLessThan(even);
  });

  it("is zero for an empty show", () => {
    expect(varietyIndex([])).toBe(0);
  });
});

describe("missingFamilies", () => {
  it("names what a show never reaches for", () => {
    const missing = missingFamilies(palette([peony]));
    expect(missing).toContain("trailing");
    expect(missing).not.toContain("burst");
  });

  it("names nothing when everything appears", () => {
    const entries = palette([
      peony,
      willow,
      crossette,
      salute,
      strobe,
      cake,
      gerb,
    ]);
    expect(missingFamilies(entries)).toEqual([]);
  });
});

describe("checkPalette", () => {
  it("says nothing about a varied show", () => {
    const entries = palette([peony, willow, crossette, cake]);
    expect(checkPalette(entries).size).toBe(0);
  });

  it("notes a family that dominates", () => {
    const entries = palette([peony, willow], new Map([["shell.peony", 50]]));
    expect(checkPalette(entries).byCode("PF1900")[0]?.help).toContain(
      "fourth of anything",
    );
  });

  it("notes a monotonous show", () => {
    const entries = palette([peony, willow], new Map([["shell.peony", 200]]));
    expect(checkPalette(entries).byCode("PF1901")).toHaveLength(1);
  });

  it("takes its own limits", () => {
    const even = palette([peony, willow, crossette, cake]);
    expect(
      checkPalette(even, { maxShare: 0.1 }).byCode("PF1900").length,
    ).toBeGreaterThan(0);
    const uneven = palette(
      [peony, willow, crossette, cake],
      new Map([["shell.peony", 3]]),
    );
    expect(varietyIndex(uneven)).toBeLessThan(1);
    expect(
      checkPalette(uneven, { minVariety: 0.99 }).byCode("PF1901"),
    ).toHaveLength(1);
  });

  it("says nothing about an empty show", () => {
    expect(checkPalette([]).size).toBe(0);
  });
});

describe("calibreSpread", () => {
  it("counts shots by handling band", () => {
    const spread = calibreSpread(
      [peony, small, gerb],
      new Map([["shell.peony", 4]]),
    );
    expect(spread.get("large")).toBe(4);
    expect(spread.get("small")).toBe(1);
    expect(spread.get("ground")).toBe(1);
  });
});

describe("reports", () => {
  it("describes the palette with a variety line", () => {
    const text = describePalette(palette([peony, willow, gerb]));
    expect(text).toContain("family");
    expect(text).toContain("variety");
  });

  it("names the families never used", () => {
    expect(describePalette(palette([peony]))).toContain("never used:");
  });

  it("says every family appears when it does", () => {
    const entries = palette([
      peony,
      willow,
      crossette,
      salute,
      strobe,
      cake,
      gerb,
    ]);
    expect(describePalette(entries)).toContain("every family appears");
  });

  it("says so for an empty show", () => {
    expect(describePalette([])).toBe("nothing to describe");
  });

  it("names the families a show leans on", () => {
    const entries = palette(
      [peony, willow, gerb],
      new Map([
        ["shell.peony", 30],
        ["shell.willow", 20],
      ]),
    );
    expect(dominantFamilies(entries)).toEqual(["burst", "trailing"]);
  });
});
