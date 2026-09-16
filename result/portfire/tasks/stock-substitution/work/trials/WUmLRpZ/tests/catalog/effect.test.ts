import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import {
  EFFECT_KINDS,
  calibreOf,
  describeEffect,
  goesUp,
  isAerial,
  isCake,
  isCandle,
  isGround,
  isMine,
  reachOf,
  shell,
  shotCount,
} from "../../src/catalog/effect.js";
import type {
  Cake,
  GroundPiece,
  Mine,
  RomanCandle,
} from "../../src/catalog/effect.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";

const six = calibre(mm(150));

const aShell = shell({
  id: effectId("shell.150.palm"),
  name: "gold palm",
  calibre: six,
  breakStyle: "palm",
});

const aCake: Cake = {
  kind: "cake",
  id: effectId("cake.silver"),
  name: "silver fountain cake",
  calibre: calibre(mm(30)),
  shots: 25,
  shotInterval: ms(220),
  hangTime: ms(1400),
};

const aMine: Mine = {
  kind: "mine",
  id: effectId("mine.100"),
  name: "gold mine",
  calibre: calibre(mm(100)),
  spreadAngle: 40,
  height: metres(35),
  hangTime: ms(1800),
};

const aCandle: RomanCandle = {
  kind: "candle",
  id: effectId("candle.10"),
  name: "ten shot candle",
  calibre: calibre(mm(30)),
  shots: 10,
  shotInterval: ms(600),
  height: metres(45),
};

const aGround: GroundPiece = {
  kind: "ground",
  id: effectId("gerb.silver"),
  name: "silver gerb",
  style: "gerb",
  duration: ms(30000),
  height: metres(4),
};

describe("kinds", () => {
  it("lists all five", () => {
    expect(EFFECT_KINDS).toHaveLength(5);
  });

  it("narrows to exactly one kind each", () => {
    expect(isAerial(aShell)).toBe(true);
    expect(isCake(aCake)).toBe(true);
    expect(isMine(aMine)).toBe(true);
    expect(isCandle(aCandle)).toBe(true);
    expect(isGround(aGround)).toBe(true);
  });

  it("does not confuse a cake with a shell", () => {
    expect(isAerial(aCake)).toBe(false);
    expect(isCake(aShell)).toBe(false);
  });
});

describe("calibreOf", () => {
  it("reads the bore of anything that has one", () => {
    expect(raw(calibreOf(aShell)!.size)).toBe(150);
    expect(raw(calibreOf(aCake)!.size)).toBe(30);
    expect(raw(calibreOf(aMine)!.size)).toBe(100);
  });

  it("gives nothing for a ground piece rather than zero", () => {
    expect(calibreOf(aGround)).toBeUndefined();
  });
});

describe("shotCount", () => {
  it("counts the shots of a cake and a candle", () => {
    expect(shotCount(aCake)).toBe(25);
    expect(shotCount(aCandle)).toBe(10);
  });

  it("counts one for everything else", () => {
    expect(shotCount(aShell)).toBe(1);
    expect(shotCount(aMine)).toBe(1);
    expect(shotCount(aGround)).toBe(1);
  });
});

describe("goesUp", () => {
  it("is true for anything that leaves the deck", () => {
    expect(goesUp(aShell)).toBe(true);
    expect(goesUp(aCake)).toBe(true);
    expect(goesUp(aMine)).toBe(true);
  });

  it("is false for a ground piece", () => {
    expect(goesUp(aGround)).toBe(false);
  });
});

describe("reachOf", () => {
  it("uses the full apogee for a shell with no override", () => {
    expect(raw(reachOf(aShell, metres(180)))).toBe(180);
  });

  it("uses a lowered break when the shell carries one", () => {
    const low = { ...aShell, breakHeight: metres(90) };
    expect(raw(reachOf(low, metres(180)))).toBe(90);
  });

  it("uses the carried height for a mine, candle and ground piece", () => {
    expect(raw(reachOf(aMine, metres(180)))).toBe(35);
    expect(raw(reachOf(aCandle, metres(180)))).toBe(45);
    expect(raw(reachOf(aGround, metres(180)))).toBe(4);
  });

  it("uses the apogee for a cake", () => {
    expect(raw(reachOf(aCake, metres(40)))).toBe(40);
  });
});

describe("describeEffect", () => {
  it("names a shell by size and break", () => {
    expect(describeEffect(aShell)).toBe("6in palm");
  });

  it("names a cake by its shot count", () => {
    expect(describeEffect(aCake)).toBe("25 shot 1.2in cake");
  });

  it("names a mine, a candle and a ground piece", () => {
    expect(describeEffect(aMine)).toBe("4in mine");
    expect(describeEffect(aCandle)).toBe("10 shot candle");
    expect(describeEffect(aGround)).toBe("gerb, 30.0s");
  });
});

describe("shell", () => {
  it("fills in a default break style", () => {
    const plain = shell({
      id: effectId("shell.75"),
      name: "three inch",
      calibre: calibre(mm(75)),
    });
    expect(plain.breakStyle).toBe("peony");
  });

  it("scales hang time and break diameter with calibre", () => {
    const small = shell({
      id: effectId("shell.75"),
      name: "three",
      calibre: calibre(mm(75)),
    });
    const large = shell({
      id: effectId("shell.300"),
      name: "twelve",
      calibre: calibre(mm(300)),
    });
    expect(raw(large.hangTime)).toBeGreaterThan(raw(small.hangTime));
    expect(raw(large.breakDiameter)).toBeGreaterThan(raw(small.breakDiameter));
  });

  it("keeps an override rather than the default", () => {
    const custom = shell({
      id: effectId("shell.150"),
      name: "six",
      calibre: six,
      hangTime: ms(500),
      breakDiameter: metres(60),
    });
    expect(raw(custom.hangTime)).toBe(500);
    expect(raw(custom.breakDiameter)).toBe(60);
  });

  it("leaves the maker off when there is none", () => {
    expect("maker" in aShell).toBe(false);
    const named = shell({
      id: effectId("shell.150"),
      name: "six",
      calibre: six,
      maker: "vulcan",
    });
    expect(named.maker).toBe("vulcan");
  });
});
