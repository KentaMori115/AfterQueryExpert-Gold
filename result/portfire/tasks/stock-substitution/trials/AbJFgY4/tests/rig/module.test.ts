import { describe, expect, it } from "vitest";
import {
  MODELS,
  describeModule,
  firingModule,
  firstFreePin,
  holdsPin,
  modelNamed,
  perPinCurrent,
  pinsOf,
  usageOf,
} from "../../src/rig/module.js";
import { pinAddress, pinKey } from "../../src/rig/pin.js";
import { positionId } from "../../src/core/ids.js";
import { raw } from "../../src/core/units.js";

const fc32 = modelNamed("fc-32")!;
const unit = firingModule(12, fc32, positionId("pad.a"));

describe("models", () => {
  it("finds a model by name, ignoring case", () => {
    expect(modelNamed("FC-32")?.pins).toBe(32);
  });

  it("gives nothing for a model it does not know", () => {
    expect(modelNamed("nothing")).toBeUndefined();
  });

  it("never claims more simultaneous outputs than it has pins", () => {
    for (const model of MODELS) {
      expect(model.simultaneous).toBeLessThanOrEqual(model.pins);
      expect(model.simultaneous).toBeGreaterThan(0);
    }
  });

  it("gives every model a firing pulse and a current", () => {
    for (const model of MODELS) {
      expect(model.pulseMs).toBeGreaterThan(0);
      expect(raw(model.firingCurrent)).toBeGreaterThan(0);
    }
  });
});

describe("firingModule", () => {
  it("holds its number, model and position", () => {
    expect(unit.number).toBe(12);
    expect(unit.model.name).toBe("fc-32");
    expect(unit.position).toBe("pad.a");
  });

  it("leaves the note off when there is none", () => {
    expect("note" in unit).toBe(false);
    expect(firingModule(1, fc32, positionId("pad.a"), "spare").note).toBe(
      "spare",
    );
  });

  it("refuses a module number of zero", () => {
    expect(() => firingModule(0, fc32, positionId("pad.a"))).toThrow(
      /module number/,
    );
  });
});

describe("pins", () => {
  it("lists every pin on the module", () => {
    const pins = pinsOf(unit);
    expect(pins).toHaveLength(32);
    expect(pins[0]).toEqual(pinAddress(12, 1));
    expect(pins[31]).toEqual(pinAddress(12, 32));
  });

  it("claims the pins it holds and no others", () => {
    expect(holdsPin(unit, pinAddress(12, 1))).toBe(true);
    expect(holdsPin(unit, pinAddress(12, 32))).toBe(true);
    expect(holdsPin(unit, pinAddress(12, 33))).toBe(false);
    expect(holdsPin(unit, pinAddress(13, 1))).toBe(false);
  });
});

describe("perPinCurrent", () => {
  it("shares the firing current across the simultaneous limit", () => {
    expect(raw(perPinCurrent(fc32))).toBeCloseTo(1.2, 6);
  });

  it("gives a lower per pin draw on a module that fires everything", () => {
    const slat = modelNamed("slat-50")!;
    expect(raw(perPinCurrent(slat))).toBeLessThan(raw(perPinCurrent(fc32)));
  });
});

describe("usageOf", () => {
  it("counts what is taken on this module only", () => {
    const usage = usageOf(unit, [
      pinAddress(12, 1),
      pinAddress(12, 2),
      pinAddress(13, 1),
    ]);
    expect(usage.used).toBe(2);
    expect(usage.free).toBe(30);
  });

  it("counts a repeated address once", () => {
    const usage = usageOf(unit, [pinAddress(12, 1), pinAddress(12, 1)]);
    expect(usage.used).toBe(1);
    expect(usage.usedPins).toHaveLength(1);
  });

  it("reports a whole module free when nothing is taken", () => {
    expect(usageOf(unit, []).free).toBe(32);
  });
});

describe("firstFreePin", () => {
  it("starts at pin one", () => {
    expect(firstFreePin(unit, new Set())).toEqual(pinAddress(12, 1));
  });

  it("skips what is taken", () => {
    const taken = new Set([
      pinKey(pinAddress(12, 1)),
      pinKey(pinAddress(12, 2)),
    ]);
    expect(firstFreePin(unit, taken)).toEqual(pinAddress(12, 3));
  });

  it("gives nothing when the module is full", () => {
    const taken = new Set(pinsOf(unit).map(pinKey));
    expect(firstFreePin(unit, taken)).toBeUndefined();
  });

  it("ignores pins taken on another module", () => {
    const taken = new Set([pinKey(pinAddress(13, 1))]);
    expect(firstFreePin(unit, taken)).toEqual(pinAddress(12, 1));
  });
});

describe("describeModule", () => {
  it("reads as one line on a rig sheet", () => {
    expect(describeModule(unit)).toBe(
      "module 12 (fc-32) at pad.a, 12.01 to 12.32",
    );
  });
});
