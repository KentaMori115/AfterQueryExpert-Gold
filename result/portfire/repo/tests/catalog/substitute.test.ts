import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { Cake } from "../../src/catalog/effect.js";
import { Magazine } from "../../src/catalog/inventory.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  bestSubstitute,
  changesSafety,
  checkSubstitutions,
  planSubstitutions,
  substitutesFor,
} from "../../src/catalog/substitute.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms } from "../../src/core/units.js";

const palm = shell({
  id: effectId("shell.150.palm"),
  name: "six palm",
  calibre: calibre(mm(150)),
  breakStyle: "palm",
});
const willow = shell({
  id: effectId("shell.150.willow"),
  name: "six willow",
  calibre: calibre(mm(150)),
  breakStyle: "willow",
});
const bigger = shell({
  id: effectId("shell.200.peony"),
  name: "eight peony",
  calibre: calibre(mm(200)),
});
const smaller = shell({
  id: effectId("shell.75.peony"),
  name: "three peony",
  calibre: calibre(mm(75)),
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

const catalog = Catalog.from([palm, willow, bigger, smaller, cake]);

describe("substitutesFor", () => {
  it("finds another shell of the same calibre", () => {
    const found = substitutesFor(palm, catalog);
    expect(found[0]?.effect.id).toBe("shell.150.willow");
    expect(found[0]?.quality).toBe("exact");
  });

  it("never suggests the effect itself", () => {
    expect(
      substitutesFor(palm, catalog).map((entry) => entry.effect.id),
    ).not.toContain("shell.150.palm");
  });

  it("never crosses effect kinds", () => {
    expect(
      substitutesFor(cake, catalog).map((entry) => entry.effect.id),
    ).toEqual([]);
  });

  it("does not suggest a shell for a three inch that flies differently", () => {
    expect(
      substitutesFor(smaller, catalog).map((entry) => entry.effect.id),
    ).toEqual([]);
  });

  it("puts an exact calibre match before a near one", () => {
    const found = substitutesFor(palm, catalog, { leadToleranceMs: 5000 });
    expect(found[0]?.quality).toBe("exact");
    expect(found.some((entry) => entry.quality === "near")).toBe(true);
  });

  it("refuses a near match when band matching is off", () => {
    const found = substitutesFor(palm, catalog, {
      leadToleranceMs: 5000,
      allowBandMatch: false,
    });
    expect(found.every((entry) => entry.quality === "exact")).toBe(true);
  });

  it("refuses a candidate whose flight time differs too much", () => {
    expect(
      substitutesFor(palm, catalog, { leadToleranceMs: 10 }).map(
        (entry) => entry.effect.id,
      ),
    ).toEqual(["shell.150.willow"]);
  });

  it("only suggests what the magazine can supply", () => {
    const magazine = Magazine.from([
      { lotNumber: "vn1", effectId: "shell.150.willow", quantity: 2 },
    ]);
    expect(substitutesFor(palm, catalog, { magazine, wanted: 1 })).toHaveLength(
      1,
    );
    expect(substitutesFor(palm, catalog, { magazine, wanted: 5 })).toEqual([]);
  });

  it("reports how many are on hand when it was given a magazine", () => {
    const magazine = Magazine.from([
      { lotNumber: "vn1", effectId: "shell.150.willow", quantity: 9 },
    ]);
    expect(substitutesFor(palm, catalog, { magazine })[0]?.onHand).toBe(9);
  });

  it("leaves the on hand count off with no magazine", () => {
    expect("onHand" in (substitutesFor(palm, catalog)[0] ?? {})).toBe(false);
  });
});

describe("bestSubstitute", () => {
  it("takes the first suggestion", () => {
    expect(bestSubstitute(palm, catalog)?.effect.id).toBe("shell.150.willow");
  });

  it("gives nothing when there is nothing", () => {
    expect(bestSubstitute(cake, catalog)).toBeUndefined();
  });
});

describe("planSubstitutions", () => {
  const magazine = Magazine.from([
    { lotNumber: "vn1", effectId: "shell.150.willow", quantity: 40 },
  ]);

  it("covers a shortfall it can cover", () => {
    const plans = planSubstitutions(
      new Map([["shell.150.palm", 4]]),
      catalog,
      magazine,
    );
    expect(plans[0]?.substitute?.effect.id).toBe("shell.150.willow");
  });

  it("leaves a line with no cover in the plan", () => {
    const plans = planSubstitutions(
      new Map([["cake.silver", 2]]),
      catalog,
      magazine,
    );
    expect(plans[0]?.substitute).toBeUndefined();
  });

  it("keeps a line whose effect is not in the catalog", () => {
    const plans = planSubstitutions(
      new Map([["shell.999", 2]]),
      catalog,
      magazine,
    );
    expect(plans[0]?.effectId).toBe("shell.999");
    expect(plans[0]?.substitute).toBeUndefined();
  });

  it("orders lines by effect name", () => {
    const plans = planSubstitutions(
      new Map([
        ["shell.150.palm", 1],
        ["cake.silver", 1],
      ]),
      catalog,
      magazine,
    );
    expect(plans.map((plan) => plan.effectId)).toEqual([
      "cake.silver",
      "shell.150.palm",
    ]);
  });
});

describe("checkSubstitutions", () => {
  const magazine = Magazine.from([
    { lotNumber: "vn1", effectId: "shell.150.willow", quantity: 40 },
    { lotNumber: "vn2", effectId: "shell.200.peony", quantity: 40 },
  ]);

  it("errors on a line nothing covers", () => {
    const plans = planSubstitutions(
      new Map([["cake.silver", 2]]),
      catalog,
      magazine,
    );
    expect(checkSubstitutions(plans).byCode("PF1600")[0]?.help).toContain(
      "buy in",
    );
  });

  it("notes an exact swap without warning about it", () => {
    const plans = planSubstitutions(
      new Map([["shell.150.palm", 2]]),
      catalog,
      magazine,
    );
    const diagnostics = checkSubstitutions(plans);
    expect(diagnostics.byCode("PF1601")).toHaveLength(1);
    expect(diagnostics.warningCount).toBe(0);
  });

  it("warns about a near swap and says to check the separation", () => {
    const thin = Catalog.from([palm, bigger]);
    const plans = planSubstitutions(
      new Map([["shell.150.palm", 2]]),
      thin,
      Magazine.from([
        { lotNumber: "vn2", effectId: "shell.200.peony", quantity: 40 },
      ]),
      { leadToleranceMs: 5000 },
    );
    expect(checkSubstitutions(plans).byCode("PF1602")[0]?.help).toContain(
      "separation",
    );
  });
});

describe("changesSafety", () => {
  it("is false for the same calibre and break", () => {
    expect(changesSafety(palm, { ...palm, id: effectId("other") })).toBe(false);
  });

  it("is true for a different calibre", () => {
    expect(changesSafety(palm, bigger)).toBe(true);
  });

  it("is true for a wider break at the same calibre", () => {
    expect(changesSafety(palm, { ...willow, breakDiameter: metres(400) })).toBe(
      true,
    );
  });

  it("is true when one has no calibre at all", () => {
    const ground = {
      kind: "ground" as const,
      id: effectId("gerb"),
      name: "gerb",
      style: "gerb" as const,
      duration: ms(1000),
      height: metres(4),
    };
    expect(changesSafety(palm, ground)).toBe(true);
  });
});
