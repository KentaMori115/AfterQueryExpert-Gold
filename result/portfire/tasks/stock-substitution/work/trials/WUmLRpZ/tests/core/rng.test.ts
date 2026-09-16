import { describe, expect, it } from "vitest";
import { Rng, hashString, showRng } from "../../src/core/rng.js";

describe("hashString", () => {
  it("is stable", () => {
    expect(hashString("autumn")).toBe(hashString("autumn"));
  });

  it("separates similar labels", () => {
    expect(hashString("fan.a")).not.toBe(hashString("fan.b"));
  });

  it("returns an unsigned 32 bit value", () => {
    const hash = hashString("a rather long label with spaces");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(0x100000000);
  });

  it("hashes the empty string to the offset basis", () => {
    expect(hashString("")).toBe(0x811c9dc5);
  });
});

describe("determinism", () => {
  it("gives the same sequence for the same numeric seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const first = Array.from({ length: 20 }, () => a.nextUint32());
    const second = Array.from({ length: 20 }, () => b.nextUint32());
    expect(first).toEqual(second);
  });

  it("gives the same sequence for the same string seed", () => {
    const a = new Rng("autumn");
    const b = new Rng("autumn");
    expect(a.nextFloat()).toBe(b.nextFloat());
  });

  it("gives different sequences for different seeds", () => {
    const a = new Rng("autumn");
    const b = new Rng("winter");
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it("does not sit still on a zero seed", () => {
    const rng = new Rng(0);
    const values = Array.from({ length: 5 }, () => rng.nextUint32());
    expect(new Set(values).size).toBe(5);
  });

  it("refuses a seed that is not finite", () => {
    expect(() => new Rng(Number.NaN)).toThrow(/finite/);
  });
});

describe("ranges", () => {
  it("keeps floats in the unit range", () => {
    const rng = new Rng("range");
    for (let i = 0; i < 500; i += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps integers inside inclusive bounds", () => {
    const rng = new Rng("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      const value = rng.nextInt(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
  });

  it("handles a single value range", () => {
    expect(new Rng(1).nextInt(4, 4)).toBe(4);
  });

  it("refuses backwards or fractional bounds", () => {
    const rng = new Rng(1);
    expect(() => rng.nextInt(7, 3)).toThrow(/backwards/);
    expect(() => rng.nextInt(1.5, 3)).toThrow(/integer/);
  });

  it("keeps jitter inside the amount", () => {
    const rng = new Rng("jitter");
    for (let i = 0; i < 300; i += 1) {
      const value = rng.nextJitter(25);
      expect(Math.abs(value)).toBeLessThanOrEqual(25);
    }
  });

  it("gives zero jitter for zero amount", () => {
    expect(new Rng(1).nextJitter(0)).toBe(0);
  });

  it("refuses negative jitter", () => {
    expect(() => new Rng(1).nextJitter(-4)).toThrow(/negative/);
  });

  it("never fires an impossible chance and always fires a certain one", () => {
    const rng = new Rng("chance");
    for (let i = 0; i < 100; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});

describe("collections", () => {
  it("picks something from the list", () => {
    const rng = new Rng("pick");
    const items = ["peony", "willow", "palm"];
    for (let i = 0; i < 50; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it("refuses to pick from nothing", () => {
    expect(() => new Rng(1).pick([])).toThrow(/empty/);
  });

  it("shuffles without touching the input", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const rng = new Rng("shuffle");
    const shuffled = rng.shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it("actually moves things", () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    expect(new Rng("shuffle").shuffle(items)).not.toEqual(items);
  });

  it("samples distinct items", () => {
    const items = ["a", "b", "c", "d", "e"];
    const sample = new Rng("sample").sample(items, 3);
    expect(sample).toHaveLength(3);
    expect(new Set(sample).size).toBe(3);
  });

  it("caps a sample at the list length", () => {
    expect(new Rng(1).sample([1, 2], 10)).toHaveLength(2);
    expect(new Rng(1).sample([1, 2], -3)).toHaveLength(0);
  });
});

describe("forking", () => {
  it("gives unrelated streams for different labels", () => {
    const parent = new Rng("show");
    const a = parent.fork("fan.a");
    const b = parent.fork("fan.b");
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it("gives the same child for the same label", () => {
    const first = new Rng("show").fork("fan.a");
    const second = new Rng("show").fork("fan.a");
    expect(first.nextFloat()).toBe(second.nextFloat());
  });

  it("does not advance the parent", () => {
    const parent = new Rng("show");
    const before = parent.save();
    parent.fork("anything");
    expect(parent.save()).toBe(before);
  });
});

describe("save and restore", () => {
  it("replays from a snapshot", () => {
    const rng = new Rng("replay");
    rng.nextUint32();
    const point = rng.save();
    const expected = [rng.nextUint32(), rng.nextUint32()];
    rng.restore(point);
    expect([rng.nextUint32(), rng.nextUint32()]).toEqual(expected);
  });

  it("nudges a restored zero state off its fixed point", () => {
    const rng = new Rng(1);
    rng.restore(0);
    expect(rng.nextUint32()).not.toBe(0);
  });
});

describe("showRng", () => {
  it("is keyed to the show name", () => {
    expect(showRng("autumn").nextUint32()).toBe(showRng("autumn").nextUint32());
    expect(showRng("autumn").nextUint32()).not.toBe(
      showRng("spring").nextUint32(),
    );
  });
});
