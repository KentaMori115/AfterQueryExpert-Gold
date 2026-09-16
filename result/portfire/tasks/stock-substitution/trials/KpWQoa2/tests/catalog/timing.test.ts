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
  ignitionTimeFor,
  isTightOnCue,
  occupancyOf,
  preRollFor,
  timingOf,
  visibleTimeFor,
  visibleWindowOf,
} from "../../src/catalog/timing.js";
import { effectId } from "../../src/core/ids.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";

const six = shell({
  id: effectId("shell.150"),
  name: "six",
  calibre: calibre(mm(150)),
  hangTime: ms(2400),
});

const twelve = shell({
  id: effectId("shell.300"),
  name: "twelve",
  calibre: calibre(mm(300)),
});

const cake: Cake = {
  kind: "cake",
  id: effectId("cake.silver"),
  name: "silver",
  calibre: calibre(mm(30)),
  shots: 25,
  shotInterval: ms(200),
  hangTime: ms(1000),
};

const mine: Mine = {
  kind: "mine",
  id: effectId("mine.100"),
  name: "mine",
  calibre: calibre(mm(100)),
  spreadAngle: 40,
  height: metres(35),
  hangTime: ms(1800),
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

const gerb: GroundPiece = {
  kind: "ground",
  id: effectId("gerb.silver"),
  name: "gerb",
  style: "gerb",
  duration: ms(30000),
  height: metres(4),
};

describe("timingOf a shell", () => {
  it("leads by the rise plus the match delay", () => {
    expect(raw(timingOf(six).lead)).toBe(4030);
  });

  it("runs until the stars burn out", () => {
    expect(raw(timingOf(six).duration)).toBe(4030 + 2400);
  });

  it("peaks at the break", () => {
    expect(raw(timingOf(six).peak)).toBe(raw(timingOf(six).lead));
  });

  it("shortens the lead for a lowered break", () => {
    const low = { ...six, breakHeight: metres(45) };
    expect(raw(timingOf(low).lead)).toBeLessThan(raw(timingOf(six).lead));
  });
});

describe("timingOf the other kinds", () => {
  it("runs a cake from its first shot to its last star", () => {
    const timing = timingOf(cake);
    const span = 24 * 200;
    expect(raw(timing.duration) - raw(timing.lead)).toBe(span + 1000);
  });

  it("puts a cake's peak in the middle of the rack", () => {
    const timing = timingOf(cake);
    expect(raw(timing.peak)).toBe(raw(timing.lead) + (24 * 200) / 2);
  });

  it("fires a mine with almost no lead", () => {
    expect(raw(timingOf(mine).lead)).toBe(30);
    expect(raw(timingOf(mine).duration)).toBe(1830);
  });

  it("gives a candle a short lead and a long tail", () => {
    const timing = timingOf(candle);
    expect(raw(timing.lead)).toBe(280);
    expect(raw(timing.duration)).toBe(280 + 9 * 600 + 900);
  });

  it("burns a ground piece for its own duration", () => {
    expect(raw(timingOf(gerb).lead)).toBe(30);
    expect(raw(timingOf(gerb).duration)).toBe(30030);
  });

  it("handles a single shot cake without a negative span", () => {
    const single = { ...cake, shots: 1 };
    const timing = timingOf(single);
    expect(raw(timing.peak)).toBe(raw(timing.lead));
  });
});

describe("ignitionTimeFor", () => {
  it("fires early enough for the break to land on the beat", () => {
    expect(raw(ignitionTimeFor(six, ms(20000)))).toBe(20000 - 4030);
  });

  it("goes before zero when the opener is large", () => {
    expect(raw(ignitionTimeFor(twelve, ms(1000)))).toBeLessThan(0);
  });

  it("reverses back to the visible moment", () => {
    const fired = ignitionTimeFor(six, ms(20000));
    expect(raw(visibleTimeFor(six, fired))).toBe(20000);
  });
});

describe("windows", () => {
  it("occupies from ignition to the last light", () => {
    const window = occupancyOf(six, ms(1000));
    expect(raw(window.start)).toBe(1000);
    expect(raw(window.end)).toBe(1000 + 4030 + 2400);
  });

  it("is visible only from the break", () => {
    const window = visibleWindowOf(six, ms(1000));
    expect(raw(window.start)).toBe(1000 + 4030);
    expect(raw(window.end)).toBe(1000 + 4030 + 2400);
  });

  it("makes a ground piece visible almost at once", () => {
    const window = visibleWindowOf(gerb, ms(0));
    expect(raw(window.start)).toBe(30);
  });
});

describe("preRollFor", () => {
  it("takes the worst lead in the show", () => {
    expect(raw(preRollFor([six, twelve, mine]))).toBe(
      raw(timingOf(twelve).lead),
    );
  });

  it("needs nothing for a show of ground pieces", () => {
    expect(raw(preRollFor([gerb]))).toBe(30);
  });

  it("needs nothing at all for an empty show", () => {
    expect(raw(preRollFor([]))).toBe(0);
  });
});

describe("isTightOnCue", () => {
  it("trusts a mine and a ground piece", () => {
    expect(isTightOnCue(mine)).toBe(true);
    expect(isTightOnCue(gerb)).toBe(true);
  });

  it("does not trust a six inch shell on a downbeat", () => {
    expect(isTightOnCue(six)).toBe(false);
  });

  it("trusts a candle", () => {
    expect(isTightOnCue(candle)).toBe(true);
  });
});
