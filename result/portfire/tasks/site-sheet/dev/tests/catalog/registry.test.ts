import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type { Cake, GroundPiece } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms } from "../../src/core/units.js";

const three = shell({
  id: effectId("shell.75.peony"),
  name: "three inch peony",
  calibre: calibre(mm(75)),
  maker: "vulcan",
});
const six = shell({
  id: effectId("shell.150.palm"),
  name: "six inch palm",
  calibre: calibre(mm(150)),
  breakStyle: "palm",
  maker: "vulcan",
});
const twelve = shell({
  id: effectId("shell.300.willow"),
  name: "twelve inch willow",
  calibre: calibre(mm(300)),
  breakStyle: "willow",
});
const cake: Cake = {
  kind: "cake",
  id: effectId("cake.silver"),
  name: "silver cake",
  calibre: calibre(mm(30)),
  shots: 25,
  shotInterval: ms(200),
  hangTime: ms(1000),
};
const gerb: GroundPiece = {
  kind: "ground",
  id: effectId("gerb.silver"),
  name: "silver gerb",
  style: "gerb",
  duration: ms(30000),
  height: metres(4),
};

const catalog = Catalog.from([six, three, cake, gerb, twelve]);

describe("lookup", () => {
  it("counts what it holds", () => {
    expect(catalog.size).toBe(5);
  });

  it("finds an effect by name", () => {
    expect(catalog.get("shell.150.palm")).toBe(six);
    expect(catalog.has("cake.silver")).toBe(true);
  });

  it("gives nothing for a name it does not hold", () => {
    expect(catalog.get("shell.999")).toBeUndefined();
    expect(catalog.has("shell.999")).toBe(false);
  });

  it("keeps the source when it was told one", () => {
    const sourced = new Catalog().add(six, "house.csv");
    expect(sourced.entry("shell.150.palm")?.source).toBe("house.csv");
    expect("source" in (catalog.entry("shell.150.palm") ?? {})).toBe(false);
  });

  it("replaces an entry with the same name", () => {
    const replaced = new Catalog().add(six).add({ ...six, name: "new name" });
    expect(replaced.size).toBe(1);
    expect(replaced.get("shell.150.palm")?.name).toBe("new name");
  });

  it("removes by name", () => {
    const trimmed = Catalog.from([six, three]);
    expect(trimmed.remove("shell.150.palm")).toBe(true);
    expect(trimmed.remove("shell.150.palm")).toBe(false);
    expect(trimmed.size).toBe(1);
  });
});

describe("listing", () => {
  it("sorts names the way a person reads them", () => {
    expect(catalog.ids()).toEqual([
      "cake.silver",
      "gerb.silver",
      "shell.75.peony",
      "shell.150.palm",
      "shell.300.willow",
    ]);
  });

  it("lists effects in the same order", () => {
    expect(catalog.all()[0]).toBe(cake);
  });

  it("filters on a prefix at segment boundaries", () => {
    expect(catalog.under("shell").map((effect) => effect.id)).toEqual([
      "shell.75.peony",
      "shell.150.palm",
      "shell.300.willow",
    ]);
    expect(catalog.under("shell.150")).toHaveLength(1);
  });

  it("filters by kind", () => {
    expect(catalog.ofKind("shell")).toHaveLength(3);
    expect(catalog.ofKind("ground")).toEqual([gerb]);
    expect(catalog.ofKind("mine")).toEqual([]);
  });

  it("filters by maker", () => {
    expect(catalog.byMaker("vulcan")).toHaveLength(2);
    expect(catalog.byMaker("nobody")).toEqual([]);
  });
});

describe("upToCalibre", () => {
  it("keeps everything at or under the limit", () => {
    const small = catalog.upToCalibre(150).map((effect) => effect.id);
    expect(small).toContain("shell.150.palm");
    expect(small).not.toContain("shell.300.willow");
  });

  it("always keeps ground pieces", () => {
    expect(catalog.upToCalibre(10).map((effect) => effect.id)).toContain(
      "gerb.silver",
    );
  });
});

describe("merge", () => {
  it("takes both sides", () => {
    const merged = Catalog.from([six]).merge(Catalog.from([three]));
    expect(merged.size).toBe(2);
  });

  it("lets the second side win", () => {
    const renamed = { ...six, name: "renamed" };
    const merged = Catalog.from([six]).merge(Catalog.from([renamed]));
    expect(merged.get("shell.150.palm")?.name).toBe("renamed");
  });

  it("does not touch either original", () => {
    const left = Catalog.from([six]);
    left.merge(Catalog.from([three]));
    expect(left.size).toBe(1);
  });

  it("names the entries that clash", () => {
    const other = Catalog.from([{ ...six, name: "different" }, three]);
    expect(Catalog.from([six, three]).conflictsWith(other)).toEqual([
      "shell.150.palm",
    ]);
  });

  it("finds no clash when the entries are identical", () => {
    expect(Catalog.from([six]).conflictsWith(Catalog.from([six]))).toEqual([]);
  });
});

describe("summaries", () => {
  it("counts by kind", () => {
    const counts = catalog.countByKind();
    expect(counts.get("shell")).toBe(3);
    expect(counts.get("cake")).toBe(1);
    expect(counts.get("mine")).toBeUndefined();
  });

  it("finds the largest bore", () => {
    expect(catalog.largestCalibre()).toBe(300);
  });

  it("reports zero for a catalog of ground pieces", () => {
    expect(Catalog.from([gerb]).largestCalibre()).toBe(0);
    expect(new Catalog().largestCalibre()).toBe(0);
  });
});
