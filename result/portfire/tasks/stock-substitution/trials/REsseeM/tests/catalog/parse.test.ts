import { describe, expect, it } from "vitest";
import { parseCatalog } from "../../src/catalog/parse.js";
import { isAerial, isCake, isGround } from "../../src/catalog/effect.js";
import { raw } from "../../src/core/units.js";

const HEADER =
  "id,kind,name,calibre,break,hang,diameter,shots,interval,spread,height,duration,style,maker";

const rows = (...lines: string[]): string => [HEADER, ...lines].join("\n");

describe("headers", () => {
  it("complains about a file with nothing in it", () => {
    const parsed = parseCatalog("", "house.csv");
    expect(parsed.diagnostics.byCode("PF1000")).toHaveLength(1);
  });

  it("complains about a missing required column", () => {
    const parsed = parseCatalog("id,name\nshell.150,six", "house.csv");
    expect(parsed.diagnostics.byCode("PF1001")).toHaveLength(1);
    expect(parsed.catalog.size).toBe(0);
  });

  it("does not read any rows once the header is wrong", () => {
    const parsed = parseCatalog("kind,name\nshell,six", "house.csv");
    expect(parsed.catalog.size).toBe(0);
  });
});

describe("shells", () => {
  it("reads a full row", () => {
    const parsed = parseCatalog(
      rows(
        "shell.150.palm,shell,six inch palm,150mm,palm,2.4,140,,,,,,,vulcan",
      ),
      "house.csv",
    );
    expect(parsed.diagnostics.hasErrors()).toBe(false);
    const effect = parsed.catalog.get("shell.150.palm");
    expect(effect && isAerial(effect)).toBe(true);
    if (effect && isAerial(effect)) {
      expect(effect.breakStyle).toBe("palm");
      expect(raw(effect.hangTime)).toBe(2400);
      expect(raw(effect.breakDiameter)).toBe(140);
      expect(effect.maker).toBe("vulcan");
    }
  });

  it("fills in defaults for the columns left blank", () => {
    const parsed = parseCatalog(
      rows("shell.75,shell,three inch,3in,,,,,,,,,,"),
      "house.csv",
    );
    const effect = parsed.catalog.get("shell.75");
    expect(effect && isAerial(effect)).toBe(true);
    if (effect && isAerial(effect)) {
      expect(effect.breakStyle).toBe("peony");
      expect(raw(effect.hangTime)).toBeGreaterThan(0);
    }
  });

  it("warns about an unknown break style but keeps the shell", () => {
    const parsed = parseCatalog(
      rows("shell.150,shell,six,150mm,sparklebomb,,,,,,,,,"),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1013")).toHaveLength(1);
    expect(parsed.diagnostics.hasErrors()).toBe(false);
    expect(parsed.catalog.has("shell.150")).toBe(true);
  });

  it("refuses a shell with no calibre", () => {
    const parsed = parseCatalog(
      rows("shell.150,shell,six,,,,,,,,,,,"),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1012")).toHaveLength(1);
    expect(parsed.catalog.size).toBe(0);
  });

  it("says where to look and what to write", () => {
    const parsed = parseCatalog(
      rows("shell.150,shell,six,huge,,,,,,,,,,"),
      "house.csv",
    );
    const message = parsed.diagnostics.byCode("PF1012")[0];
    expect(message?.message).toContain("house.csv line 2");
    expect(message?.help).toContain("150mm");
  });
});

describe("cakes and candles", () => {
  it("reads a cake", () => {
    const parsed = parseCatalog(
      rows("cake.silver,cake,silver,30mm,,1.0,,25,0.2,,,,,"),
      "house.csv",
    );
    const effect = parsed.catalog.get("cake.silver");
    expect(effect && isCake(effect)).toBe(true);
    if (effect && isCake(effect)) {
      expect(effect.shots).toBe(25);
      expect(raw(effect.shotInterval)).toBe(200);
      expect(raw(effect.hangTime)).toBe(1000);
    }
  });

  it("reads a candle with a height", () => {
    const parsed = parseCatalog(
      rows("candle.10,candle,ten shot,30mm,,,,10,0.6,,45,,,"),
      "house.csv",
    );
    const effect = parsed.catalog.get("candle.10");
    expect(effect?.kind).toBe("candle");
  });

  it("refuses a shot count that is missing or fractional", () => {
    const parsed = parseCatalog(
      rows(
        "cake.a,cake,a,30mm,,,,,,,,,,",
        "cake.b,cake,b,30mm,,,,2.5,,,,,,",
        "cake.c,cake,c,30mm,,,,0,,,,,,",
      ),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1014")).toHaveLength(3);
  });
});

describe("mines and ground pieces", () => {
  it("reads a mine with its spread", () => {
    const parsed = parseCatalog(
      rows("mine.100,mine,gold mine,100mm,,1.8,,,,50,35,,,"),
      "house.csv",
    );
    const effect = parsed.catalog.get("mine.100");
    expect(effect?.kind).toBe("mine");
    if (effect?.kind === "mine") {
      expect(effect.spreadAngle).toBe(50);
      expect(raw(effect.height)).toBe(35);
    }
  });

  it("reads a ground piece without needing a calibre", () => {
    const parsed = parseCatalog(
      rows("gerb.silver,ground,silver gerb,,,,,,,,4,30,gerb,"),
      "house.csv",
    );
    expect(parsed.diagnostics.hasErrors()).toBe(false);
    const effect = parsed.catalog.get("gerb.silver");
    expect(effect && isGround(effect)).toBe(true);
  });

  it("refuses a ground piece with an unknown style", () => {
    const parsed = parseCatalog(
      rows("thing,ground,thing,,,,,,,,,30,sparkler,"),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1010")).toHaveLength(1);
  });

  it("refuses a ground piece with no duration", () => {
    const parsed = parseCatalog(
      rows("gerb.a,ground,gerb,,,,,,,,,,gerb,"),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1011")).toHaveLength(1);
  });
});

describe("row problems", () => {
  it("refuses an unusable id", () => {
    const parsed = parseCatalog(
      rows("Shell 150,shell,six,150mm,,,,,,,,,,"),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1002")).toHaveLength(1);
  });

  it("refuses a repeated id and keeps the first", () => {
    const parsed = parseCatalog(
      rows(
        "shell.150,shell,first,150mm,,,,,,,,,,",
        "shell.150,shell,second,150mm,,,,,,,,,,",
      ),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1003")).toHaveLength(1);
    expect(parsed.catalog.get("shell.150")?.name).toBe("first");
  });

  it("refuses an unknown kind and names it", () => {
    const parsed = parseCatalog(
      rows("thing,rocket,thing,50mm,,,,,,,,,,"),
      "house.csv",
    );
    expect(parsed.diagnostics.byCode("PF1015")[0]?.message).toContain("rocket");
  });

  it("keeps reading after a bad row", () => {
    const parsed = parseCatalog(
      rows(
        "thing,rocket,thing,50mm,,,,,,,,,,",
        "shell.150,shell,six,150mm,,,,,,,,,,",
      ),
      "house.csv",
    );
    expect(parsed.catalog.size).toBe(1);
    expect(parsed.diagnostics.errorCount).toBe(1);
  });

  it("records the source of every entry", () => {
    const parsed = parseCatalog(
      rows("shell.150,shell,six,150mm,,,,,,,,,,"),
      "house.csv",
    );
    expect(parsed.catalog.entry("shell.150")?.source).toBe("house.csv");
  });
});
