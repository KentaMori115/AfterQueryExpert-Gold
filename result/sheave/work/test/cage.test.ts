/**
 * The cage against the skip, which is an argument about tare.
 *
 * A cage weighs twice its payload and a skip weighs two fifths of one,
 * so a shaft converted from cages to skips gets half as much coal again
 * out of the same winder — and loses the ability to wind men at all.
 * Every colliery that made that trade kept a second shaft with cages in.
 */

import { describe, expect, it } from "vitest";
import {
  A_MAN,
  A_MAN_WEIGHS,
  A_TUB,
  CAGE_TARE,
  SKIP_FILL,
  SKIP_TARE,
  conveyance,
  counterweight,
  counterweightFor,
  describeConveyance,
  emptyWeight,
  gross,
  kindNamed,
  loadedWeight,
  matched,
  menIn,
  menLimitedBy,
  outOfBalance,
  outOfBalanceWeight,
  payloadAllowed,
  skip,
  skipCarries,
  skipVolume,
  tubsIn,
  usefulFraction,
} from "../src/cage/conveyance.ts";
import { weightOf } from "../src/units/measure.ts";
import { WindingError } from "../src/errors.ts";

const cage = conveyance();
const sk = skip(12_000);

describe("a cage", () => {
  it("weighs about twice what it carries", () => {
    expect(cage.tare / cage.payload).toBeCloseTo(CAGE_TARE, 1);
    expect(usefulFraction(cage)).toBeLessThan(0.4);
  });

  it("carries men by the floor and not by the rope", () => {
    expect(menIn(cage)).toBeGreaterThan(30);
    expect(menLimitedBy(cage)).toBe("floor");
    expect(menIn(cage) * A_MAN_WEIGHS).toBeLessThan(cage.payload);
  });

  it("becomes rope-limited only when the cage is very large and light", () => {
    const roomy = conveyance({ width: 4, across: 3, decks: 3, payload: 1500 });
    expect(menLimitedBy(roomy)).toBe("rope");
  });

  it("carries tubs by weight", () => {
    expect(tubsIn(cage)).toBe(Math.floor(cage.payload / A_TUB));
  });

  it("will not be asked about skip things", () => {
    expect(() => skipVolume(cage)).toThrow(WindingError);
    expect(() => menIn(sk)).toThrow(WindingError);
    expect(() => tubsIn(sk)).toThrow(WindingError);
  });
});

describe("a skip", () => {
  it("weighs two fifths of what it carries", () => {
    expect(sk.tare / sk.payload).toBeCloseTo(SKIP_TARE, 2);
    expect(usefulFraction(sk)).toBeGreaterThan(0.65);
  });

  it("is worth half as much again in useful load", () => {
    expect(usefulFraction(sk) / usefulFraction(cage)).toBeGreaterThan(1.8);
  });

  it("is filled by volume and paid for by weight", () => {
    const volume = skipVolume(sk, 850);
    expect(skipCarries(sk, 850, volume)).toBeCloseTo(sk.payload, 0);
    expect(skipCarries(sk, 950, volume)).toBeGreaterThan(sk.payload);
    expect(SKIP_FILL).toBeLessThan(1);
  });

  it("wants more volume for lighter coal", () => {
    expect(skipVolume(sk, 750)).toBeGreaterThan(skipVolume(sk, 950));
  });
});

describe("balancing one against another", () => {
  it("leaves only the payload when the pair is matched", () => {
    const empty = conveyance({ payload: 0 });
    expect(outOfBalance(cage, empty)).toBe(cage.payload);
    expect(outOfBalanceWeight(cage, empty)).toBeCloseTo(weightOf(cage.payload), 3);
    expect(matched(cage, empty)).toBe(true);
  });

  it("catches a pair that is not matched", () => {
    expect(matched(cage, conveyance({ tare: 9000 }))).toBe(false);
    expect(outOfBalance(cage, conveyance({ tare: 9000, payload: 0 }))).toBeLessThan(cage.payload);
  });

  it("balances a single conveyance at half load with a counterweight", () => {
    expect(counterweightFor(cage)).toBe(cage.tare + cage.payload / 2);
    expect(counterweight(cage).kind).toBe("counterweight");
    expect(counterweight(cage).payload).toBe(0);
  });

  it("refuses a counterweight that carries something", () => {
    expect(() => conveyance({ kind: "counterweight", payload: 500 })).toThrow(WindingError);
  });
});

describe("what a rope allows", () => {
  it("takes the tare off before it gives a payload", () => {
    const allowed = payloadAllowed(cage, 200);
    expect(allowed).toBeLessThan((200 * 1000) / 9.80665);
    expect(allowed + cage.tare).toBeLessThanOrEqual((200 * 1000) / 9.80665 + 1);
  });

  it("rounds the payload down to the hundredweight", () => {
    const allowed = payloadAllowed(cage, 200);
    expect(Math.abs(allowed / 50.8 - Math.round(allowed / 50.8))).toBeLessThan(1e-6);
  });

  it("refuses an allowance that will not lift the empty conveyance", () => {
    expect(() => payloadAllowed(cage, 10)).toThrow(WindingError);
  });
});

describe("what the module refuses", () => {
  it("will not have a conveyance weighing nothing", () => {
    expect(() => conveyance({ tare: 0 })).toThrow(WindingError);
  });

  it("will not have a conveyance with no name", () => {
    expect(() => conveyance({ name: "  " })).toThrow(WindingError);
  });

  it("names the kinds it knows", () => {
    expect(kindNamed("skip")).toBe("skip");
    expect(() => kindNamed("bucket")).toThrow(/cage/);
  });

  it("weighs itself loaded and empty", () => {
    expect(loadedWeight(cage)).toBeCloseTo(weightOf(gross(cage)), 3);
    expect(emptyWeight(cage)).toBeCloseTo(weightOf(cage.tare), 3);
    expect(describeConveyance(cage)).toContain("useful");
  });

  it("gives a man a fifth of a square metre", () => {
    expect(A_MAN).toBeCloseTo(0.2, 3);
  });
});
