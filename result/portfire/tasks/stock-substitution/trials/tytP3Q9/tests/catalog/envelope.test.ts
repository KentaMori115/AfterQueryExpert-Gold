import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import type {
  Cake,
  GroundPiece,
  Mine,
  RomanCandle,
} from "../../src/catalog/effect.js";
import {
  ceilingOf,
  clearanceBetween,
  describeEnvelope,
  envelopeOf,
  envelopesIntersect,
  floorOf,
} from "../../src/catalog/envelope.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";

const six = shell({
  id: effectId("shell.150"),
  name: "six",
  calibre: calibre(mm(150)),
  breakDiameter: metres(140),
});

describe("a shell", () => {
  it("centres the ball at the break height", () => {
    expect(raw(envelopeOf(six).centreHeight)).toBe(180);
  });

  it("takes the radius from half the break diameter", () => {
    expect(raw(envelopeOf(six).radius)).toBe(70);
  });

  it("uses a lowered break when the shell carries one", () => {
    const low = { ...six, breakHeight: metres(90) };
    expect(raw(envelopeOf(low).centreHeight)).toBe(90);
  });

  it("takes an apogee override", () => {
    expect(raw(envelopeOf(six, metres(120)).centreHeight)).toBe(120);
  });

  it("throws debris wider than it breaks", () => {
    const envelope = envelopeOf(six);
    expect(raw(envelope.falloutRadius)).toBeGreaterThan(raw(envelope.radius));
  });
});

describe("a mine", () => {
  const mine: Mine = {
    kind: "mine",
    id: effectId("mine.100"),
    name: "mine",
    calibre: calibre(mm(100)),
    spreadAngle: 60,
    height: metres(35),
    hangTime: ms(1800),
  };

  it("sits halfway up its own column", () => {
    expect(raw(envelopeOf(mine).centreHeight)).toBe(17.5);
  });

  it("gets wider with a wider spread", () => {
    const narrow = envelopeOf({ ...mine, spreadAngle: 20 });
    const wide = envelopeOf({ ...mine, spreadAngle: 90 });
    expect(raw(wide.radius)).toBeGreaterThan(raw(narrow.radius));
  });

  it("never reports a radius of nothing", () => {
    expect(raw(envelopeOf({ ...mine, spreadAngle: 1 }).radius)).toBe(2);
  });
});

describe("a cake", () => {
  const cake: Cake = {
    kind: "cake",
    id: effectId("cake.silver"),
    name: "silver",
    calibre: calibre(mm(50)),
    shots: 25,
    shotInterval: ms(200),
    hangTime: ms(1000),
  };

  it("sits halfway to its apogee", () => {
    expect(raw(envelopeOf(cake).centreHeight)).toBe(30);
  });

  it("opens wider when it is fanned", () => {
    const straight = envelopeOf(cake);
    const fanned = envelopeOf({ ...cake, fanAngle: 60 });
    expect(raw(fanned.radius)).toBeGreaterThan(raw(straight.radius));
  });
});

describe("ground pieces and candles", () => {
  const gerb: GroundPiece = {
    kind: "ground",
    id: effectId("gerb.silver"),
    name: "gerb",
    style: "gerb",
    duration: ms(30000),
    height: metres(6),
  };
  const candle: RomanCandle = {
    kind: "candle",
    id: effectId("candle.10"),
    name: "candle",
    calibre: calibre(mm(30)),
    shots: 10,
    shotInterval: ms(600),
    height: metres(45),
  };

  it("keeps a gerb close to the deck", () => {
    expect(raw(envelopeOf(gerb).centreHeight)).toBe(3);
    expect(raw(envelopeOf(gerb).radius)).toBe(6);
  });

  it("gives every effect a floor on its fallout", () => {
    expect(raw(envelopeOf(gerb).falloutRadius)).toBe(12);
    expect(raw(envelopeOf({ ...gerb, height: metres(1) }).falloutRadius)).toBe(
      10,
    );
  });

  it("treats a candle as a narrow column", () => {
    expect(raw(envelopeOf(candle).radius)).toBe(4);
    expect(raw(envelopeOf(candle).centreHeight)).toBe(22.5);
  });
});

describe("ceiling and floor", () => {
  it("reads the top and bottom of the ball", () => {
    const envelope = envelopeOf(six);
    expect(raw(ceilingOf(envelope))).toBe(250);
    expect(raw(floorOf(envelope))).toBe(110);
  });

  it("never puts the floor below the ground", () => {
    const low = envelopeOf({ ...six, breakHeight: metres(20) });
    expect(raw(floorOf(low))).toBe(0);
  });
});

describe("intersection", () => {
  it("says two breaks at the same height collide", () => {
    const a = envelopeOf(six);
    expect(envelopesIntersect(a, a)).toBe(true);
  });

  it("separates them by height", () => {
    const high = envelopeOf(six);
    const low = envelopeOf({ ...six, breakHeight: metres(20) });
    expect(envelopesIntersect(high, low)).toBe(false);
  });

  it("separates them across the ground", () => {
    const a = envelopeOf(six);
    expect(envelopesIntersect(a, a, 200)).toBe(false);
    expect(envelopesIntersect(a, a, 100)).toBe(true);
  });

  it("says how far apart to fire them", () => {
    const a = envelopeOf(six);
    expect(raw(clearanceBetween(a, a))).toBe(140);
  });

  it("asks for no clearance when the heights already separate them", () => {
    const high = envelopeOf(six);
    const low = envelopeOf({ ...six, breakHeight: metres(20) });
    expect(raw(clearanceBetween(high, low))).toBe(0);
  });
});

describe("describeEnvelope", () => {
  it("reads as one line on a report", () => {
    expect(describeEnvelope(envelopeOf(six))).toBe(
      "70m ball at 180m, fallout 105m",
    );
  });
});
