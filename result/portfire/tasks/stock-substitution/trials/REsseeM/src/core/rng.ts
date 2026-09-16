/**
 * Reproducible randomness.
 *
 * Some parts of a script ask for scatter. A fan of twenty comets reads better
 * with a few milliseconds of jitter on each shot, and a mine field looks wrong
 * if every mine goes up on exactly the same tick. But a display has to compile
 * to the same firing table every time, or the table the shooter checked on
 * Thursday is not the table the panel runs on Saturday.
 *
 * So there is no `Math.random` anywhere in portfire. Streams are seeded from
 * the show name, and a stream can be forked by label so that adding a macro in
 * the middle of a script does not reshuffle the jitter of everything after it.
 */

const UINT32 = 0x100000000;

/** FNV-1a over the label, which is enough mixing to seed a stream. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    const numeric = typeof seed === "string" ? hashString(seed) : seed;
    if (!Number.isFinite(numeric)) {
      throw new RangeError("a seed has to be a finite number or a string");
    }
    // A state of zero is a fixed point for the mixer, so nudge it off.
    this.state = Math.trunc(numeric) >>> 0 || 0x9e3779b9;
  }

  /** The raw 32 bit step. Everything else is built on this one. */
  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x;
  }

  /** A float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / UINT32;
  }

  /** An integer in [min, max], inclusive at both ends. */
  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError("nextInt needs integer bounds");
    }
    if (max < min) {
      throw new RangeError(`nextInt bounds are backwards, ${min} to ${max}`);
    }
    const span = max - min + 1;
    return min + Math.floor(this.nextFloat() * span);
  }

  /** A float in [-amount, amount], the shape jitter always wants. */
  nextJitter(amount: number): number {
    if (amount < 0) {
      throw new RangeError("jitter cannot be negative");
    }
    // Adding zero collapses negative zero, which a jitter of zero otherwise
    // produces half the time and which then prints as -0 in a firing table.
    return (this.nextFloat() * 2 - 1) * amount + 0;
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.nextFloat() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError("cannot pick from an empty list");
    }
    const index = this.nextInt(0, items.length - 1);
    const item = items[index];
    if (item === undefined) {
      throw new RangeError("pick landed outside the list");
    }
    return item;
  }

  /** Fisher Yates, on a copy. The caller's list is never touched. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(0, i);
      const a = copy[i];
      const b = copy[j];
      if (a !== undefined && b !== undefined) {
        copy[i] = b;
        copy[j] = a;
      }
    }
    return copy;
  }

  /** Take `count` distinct items, or as many as there are. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, count));
  }

  /**
   * A child stream named by a label. Two macros that fork the same parent with
   * different labels get unrelated sequences, and either one can be edited
   * without moving the other.
   */
  fork(label: string): Rng {
    return new Rng((this.state ^ hashString(label)) >>> 0);
  }

  /** Snapshot the state, so a pass can be replayed from a known point. */
  save(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = state >>> 0 || 0x9e3779b9;
  }
}

/** The stream a show uses when the script does not name a seed. */
export function showRng(showName: string): Rng {
  return new Rng(`portfire:${showName}`);
}
