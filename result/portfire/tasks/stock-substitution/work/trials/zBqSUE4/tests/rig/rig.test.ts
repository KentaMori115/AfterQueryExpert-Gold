import { describe, expect, it } from "vitest";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { pinAddress, pinKey } from "../../src/rig/pin.js";
import { Rig, distanceBetween, firingPosition } from "../../src/rig/rig.js";
import { positionId } from "../../src/core/ids.js";

const fc32 = modelNamed("fc-32")!;
const fc16 = modelNamed("fc-16")!;

const padA = firingPosition(positionId("pad.a"), 0, 0);
const padB = firingPosition(positionId("pad.b"), 40, 0);
const padC = firingPosition(positionId("pad.c"), 0, 30, "behind the water");

const rig = Rig.from(
  [padA, padB, padC],
  [
    firingModule(1, fc32, positionId("pad.a")),
    firingModule(2, fc16, positionId("pad.a")),
    firingModule(3, fc32, positionId("pad.b")),
  ],
);

describe("firingPosition", () => {
  it("holds coordinates and an optional note", () => {
    expect(padA.east).toBe(0);
    expect("note" in padA).toBe(false);
    expect(padC.note).toBe("behind the water");
  });

  it("refuses a coordinate that is not finite", () => {
    expect(() => firingPosition(positionId("pad.x"), Number.NaN, 0)).toThrow(
      /not finite/,
    );
  });

  it("measures the distance between two positions", () => {
    expect(distanceBetween(padA, padB)).toBe(40);
    expect(distanceBetween(padB, padC)).toBeCloseTo(50, 6);
    expect(distanceBetween(padA, padA)).toBe(0);
  });
});

describe("shape", () => {
  it("counts modules, positions and pins", () => {
    expect(rig.moduleCount).toBe(3);
    expect(rig.positionCount).toBe(3);
    expect(rig.pinCount).toBe(80);
  });

  it("lists modules by case number", () => {
    expect(rig.moduleNumbers()).toEqual([1, 2, 3]);
  });

  it("lists positions in reading order", () => {
    expect(rig.positionIds()).toEqual(["pad.a", "pad.b", "pad.c"]);
  });

  it("replaces a module with the same case number", () => {
    const replaced = Rig.from(
      [padA],
      [
        firingModule(1, fc32, positionId("pad.a")),
        firingModule(1, fc16, positionId("pad.a")),
      ],
    );
    expect(replaced.moduleCount).toBe(1);
    expect(replaced.module(1)?.model.name).toBe("fc-16");
  });

  it("lists the models actually in use", () => {
    expect(rig.modelsInUse().map((model) => model.name)).toEqual([
      "fc-16",
      "fc-32",
    ]);
  });
});

describe("lookup", () => {
  it("finds a module and a position by name", () => {
    expect(rig.module(2)?.model.name).toBe("fc-16");
    expect(rig.position("pad.b")?.east).toBe(40);
  });

  it("gives nothing for what it does not hold", () => {
    expect(rig.module(9)).toBeUndefined();
    expect(rig.position("pad.z")).toBeUndefined();
  });

  it("groups modules by position", () => {
    expect(rig.modulesAt("pad.a").map((unit) => unit.number)).toEqual([1, 2]);
    expect(rig.modulesAt("pad.c")).toEqual([]);
  });
});

describe("pins", () => {
  it("owns an address that lands on a real module", () => {
    expect(rig.hasPin(pinAddress(1, 32))).toBe(true);
    expect(rig.moduleFor(pinAddress(2, 16))?.number).toBe(2);
  });

  it("disowns an address past the end of a module", () => {
    expect(rig.hasPin(pinAddress(2, 17))).toBe(false);
    expect(rig.moduleFor(pinAddress(9, 1))).toBeUndefined();
  });

  it("says which position a pin is at", () => {
    expect(rig.positionOf(pinAddress(3, 4))).toBe("pad.b");
    expect(rig.positionOf(pinAddress(9, 1))).toBeUndefined();
  });

  it("lists every pin in the rig in order", () => {
    const pins = rig.allPins();
    expect(pins).toHaveLength(80);
    expect(pins[0]).toEqual(pinAddress(1, 1));
    expect(pins[79]).toEqual(pinAddress(3, 32));
  });

  it("lists the pins at one position", () => {
    expect(rig.pinsAt("pad.a")).toHaveLength(48);
    expect(rig.pinsAt("pad.c")).toEqual([]);
  });
});

describe("wiring problems", () => {
  it("names a position a module claims that does not exist", () => {
    const broken = Rig.from(
      [padA],
      [firingModule(1, fc32, positionId("pad.missing"))],
    );
    expect(broken.undefinedPositions()).toEqual(["pad.missing"]);
  });

  it("names a position with nothing standing at it", () => {
    expect(rig.emptyPositions()).toEqual(["pad.c"]);
  });

  it("finds no problems in a clean rig", () => {
    expect(rig.undefinedPositions()).toEqual([]);
  });
});

describe("free pins", () => {
  it("starts at the lowest module and pin", () => {
    expect(rig.nextFreePin(new Set())).toEqual(pinAddress(1, 1));
  });

  it("moves on to the next module when one fills", () => {
    const taken = new Set(rig.pinsAt("pad.a").map(pinKey));
    expect(rig.nextFreePin(taken)).toEqual(pinAddress(3, 1));
  });

  it("gives nothing when the whole rig is full", () => {
    const taken = new Set(rig.allPins().map(pinKey));
    expect(rig.nextFreePin(taken)).toBeUndefined();
  });

  it("can be held to one position", () => {
    expect(rig.nextFreePinAt("pad.b", new Set())).toEqual(pinAddress(3, 1));
    expect(rig.nextFreePinAt("pad.c", new Set())).toBeUndefined();
  });

  it("counts what is left", () => {
    expect(rig.freeCount([])).toBe(80);
    expect(rig.freeCount([pinAddress(1, 1), pinAddress(1, 2)])).toBe(78);
  });

  it("does not count an address the rig does not own", () => {
    expect(rig.freeCount([pinAddress(9, 1)])).toBe(80);
  });
});

describe("reports", () => {
  it("describes the rig by position", () => {
    expect(rig.describe().split("\n")).toEqual([
      "pad.a: 2 modules, 48 pins",
      "pad.b: 1 modules, 32 pins",
      "pad.c: 0 modules, 0 pins",
    ]);
  });

  it("summarises usage per module", () => {
    const summary = rig.usageSummary([pinAddress(1, 1), pinAddress(1, 2)]);
    expect(summary[0]).toBe("01 2/32");
    expect(summary[1]).toBe("02 0/16");
  });
});
