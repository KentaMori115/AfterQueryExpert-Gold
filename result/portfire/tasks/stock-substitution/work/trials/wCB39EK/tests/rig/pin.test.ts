import { describe, expect, it } from "vitest";
import {
  allPinsOn,
  comparePins,
  formatPin,
  labelPin,
  parsePin,
  pinAddress,
  pinFromIndex,
  pinIndex,
  pinKey,
  pinRange,
  samePin,
  sortPins,
} from "../../src/rig/pin.js";

describe("pinAddress", () => {
  it("holds a module and a pin", () => {
    const address = pinAddress(12, 7);
    expect(address.module).toBe(12);
    expect(address.pin).toBe(7);
  });

  it("refuses a pin of zero, since the terminals start at one", () => {
    expect(() => pinAddress(12, 0)).toThrow(/pin number/);
    expect(() => pinAddress(0, 7)).toThrow(/module number/);
  });

  it("refuses a fractional address", () => {
    expect(() => pinAddress(12.5, 7)).toThrow(/module number/);
  });
});

describe("parsePin", () => {
  it("reads every spelling a crew uses", () => {
    expect(parsePin("12.07")).toEqual({ module: 12, pin: 7 });
    expect(parsePin("12-7")).toEqual({ module: 12, pin: 7 });
    expect(parsePin("M12/7")).toEqual({ module: 12, pin: 7 });
    expect(parsePin("12:7")).toEqual({ module: 12, pin: 7 });
  });

  it("ignores case and surrounding space", () => {
    expect(parsePin("  m12 . 07 ")).toEqual({ module: 12, pin: 7 });
  });

  it("refuses nonsense", () => {
    expect(parsePin("twelve seven")).toBeUndefined();
    expect(parsePin("12")).toBeUndefined();
    expect(parsePin("12.")).toBeUndefined();
    expect(parsePin("0.7")).toBeUndefined();
    expect(parsePin("12.0")).toBeUndefined();
  });
});

describe("formatting", () => {
  it("pads so a sorted list lines up", () => {
    expect(formatPin(pinAddress(1, 2))).toBe("01.02");
    expect(formatPin(pinAddress(12, 32))).toBe("12.32");
  });

  it("labels a lead the way it is read out", () => {
    expect(labelPin(pinAddress(12, 7))).toBe("M12/7");
  });

  it("round trips through the parser", () => {
    const address = pinAddress(3, 19);
    expect(parsePin(formatPin(address))).toEqual(address);
    expect(parsePin(labelPin(address))).toEqual(address);
  });
});

describe("comparison", () => {
  it("says two of the same address are the same", () => {
    expect(samePin(pinAddress(2, 3), pinAddress(2, 3))).toBe(true);
    expect(samePin(pinAddress(2, 3), pinAddress(2, 4))).toBe(false);
  });

  it("orders by module then pin", () => {
    expect(comparePins(pinAddress(1, 32), pinAddress(2, 1))).toBeLessThan(0);
    expect(comparePins(pinAddress(2, 1), pinAddress(2, 2))).toBeLessThan(0);
    expect(comparePins(pinAddress(2, 2), pinAddress(2, 2))).toBe(0);
  });

  it("sorts without touching the input", () => {
    const input = [pinAddress(2, 1), pinAddress(1, 5)];
    expect(sortPins(input)[0]).toEqual(pinAddress(1, 5));
    expect(input[0]).toEqual(pinAddress(2, 1));
  });

  it("keys uniquely", () => {
    const keys = new Set([
      pinKey(pinAddress(1, 12)),
      pinKey(pinAddress(11, 2)),
    ]);
    expect(keys.size).toBe(2);
  });
});

describe("pinRange", () => {
  it("walks a run inside one module", () => {
    const range = pinRange(pinAddress(12, 1), pinAddress(12, 4), 32);
    expect(range.map(formatPin)).toEqual(["12.01", "12.02", "12.03", "12.04"]);
  });

  it("crosses a module boundary", () => {
    const range = pinRange(pinAddress(12, 31), pinAddress(13, 2), 32);
    expect(range.map(formatPin)).toEqual(["12.31", "12.32", "13.01", "13.02"]);
  });

  it("walks backwards when the ends are reversed", () => {
    const range = pinRange(pinAddress(12, 4), pinAddress(12, 1), 32);
    expect(range.map((address) => address.pin)).toEqual([4, 3, 2, 1]);
  });

  it("gives one address when both ends are the same", () => {
    expect(pinRange(pinAddress(1, 1), pinAddress(1, 1), 32)).toHaveLength(1);
  });

  it("refuses a pin past the end of a module", () => {
    expect(() => pinRange(pinAddress(1, 1), pinAddress(1, 40), 32)).toThrow(
      /cannot reach pin 40/,
    );
  });

  it("refuses a module with no pins", () => {
    expect(() => pinRange(pinAddress(1, 1), pinAddress(1, 1), 0)).toThrow(
      /at least one pin/,
    );
  });

  it("lists a whole module", () => {
    expect(allPinsOn(4, 32)).toHaveLength(32);
    expect(formatPin(allPinsOn(4, 32)[31]!)).toBe("04.32");
  });
});

describe("flat indexing", () => {
  it("counts from zero across the rig", () => {
    expect(pinIndex(pinAddress(1, 1), 32)).toBe(0);
    expect(pinIndex(pinAddress(1, 32), 32)).toBe(31);
    expect(pinIndex(pinAddress(2, 1), 32)).toBe(32);
  });

  it("round trips", () => {
    for (const index of [0, 1, 31, 32, 99, 640]) {
      expect(pinIndex(pinFromIndex(index, 32), 32)).toBe(index);
    }
  });

  it("refuses a negative or fractional index", () => {
    expect(() => pinFromIndex(-1, 32)).toThrow(/whole number/);
    expect(() => pinFromIndex(1.5, 32)).toThrow(/whole number/);
  });
});
