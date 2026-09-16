import type { Effect } from "./effect.js";
import type { Catalog } from "./registry.js";
import { countBy } from "../core/collect.js";
import { compareIds } from "../core/ids.js";
import { plural } from "../core/text.js";

/**
 * What is actually in the magazine.
 *
 * Stock is tracked by lot rather than by effect, and that is a legal
 * requirement rather than a nicety. Every case of shells carries a lot number,
 * and if a shell malfunctions the whole lot has to be traceable and pulled.
 * So a crew does not hold "forty six inch palms", it holds "twenty from lot
 * VN2405 and twenty six from lot VN2413", and those are different things the
 * moment one of them misbehaves.
 */

export interface Lot {
  /** The maker's lot number, which is what the paperwork tracks. */
  readonly lotNumber: string;
  readonly effectId: string;
  readonly quantity: number;
  /** When the lot was received, as an ISO date. */
  readonly received?: string;
  readonly note?: string;
}

export interface StockLine {
  readonly effectId: string;
  readonly onHand: number;
  readonly lots: readonly Lot[];
}

/**
 * The order a store issues from, which is oldest first.
 *
 * Stock rotates. A lot that has sat in the magazine two years goes out before
 * one that arrived last week, because propellant and fuse do not improve with
 * keeping and because the old lot is the one whose paperwork is about to become
 * somebody's problem. A row with no received date sorts last rather than first.
 * An undated row is usually an old row typed up from memory, but guessing that
 * it is the oldest would issue it ahead of stock that is known to be older, and
 * the tie is broken by lot number so two undated rows draw in the same order
 * every time.
 */
export function compareLots(a: Lot, b: Lot): number {
  const dateA = a.received;
  const dateB = b.received;
  if (dateA !== dateB) {
    if (dateA === undefined) {
      return 1;
    }
    if (dateB === undefined) {
      return -1;
    }
    return dateA < dateB ? -1 : 1;
  }
  if (a.lotNumber !== b.lotNumber) {
    return a.lotNumber < b.lotNumber ? -1 : 1;
  }
  return 0;
}

export class Magazine {
  private readonly lots: Lot[] = [];

  static from(lots: Iterable<Lot>): Magazine {
    const magazine = new Magazine();
    for (const lot of lots) {
      magazine.receive(lot);
    }
    return magazine;
  }

  /**
   * Take a lot in. Two deliveries of the same lot number for the same effect
   * are one lot with a larger count, which is how a split delivery arrives.
   */
  receive(lot: Lot): this {
    if (lot.quantity < 0 || !Number.isInteger(lot.quantity)) {
      throw new RangeError(
        `lot ${lot.lotNumber} has a quantity of ${lot.quantity}`,
      );
    }
    const existing = this.lots.findIndex(
      (held) =>
        held.lotNumber === lot.lotNumber && held.effectId === lot.effectId,
    );
    if (existing === -1) {
      this.lots.push(lot);
    } else {
      const held = this.lots[existing];
      if (held !== undefined) {
        this.lots[existing] = {
          ...held,
          quantity: held.quantity + lot.quantity,
        };
      }
    }
    return this;
  }

  get lotCount(): number {
    return this.lots.length;
  }

  onHand(effectId: string): number {
    return this.lots
      .filter((lot) => lot.effectId === effectId)
      .reduce((total, lot) => total + lot.quantity, 0);
  }

  lotsFor(effectId: string): Lot[] {
    return this.lots.filter((lot) => lot.effectId === effectId);
  }

  /** Every lot held, in the order the rows came in. */
  allLots(): Lot[] {
    return [...this.lots];
  }

  /** A copy, so a caller can draw from the stock without spending it. */
  clone(): Magazine {
    return Magazine.from(this.lots);
  }

  /**
   * The lots of one effect in the order they should be issued, which is what a
   * draw walks.
   */
  issueOrder(effectId: string): Lot[] {
    return this.lotsFor(effectId).sort(compareLots);
  }

  /**
   * Take units of an effect out of the book, oldest lot first, and say which
   * lots they came from. A lot emptied by the draw leaves the book, because a
   * row reading zero is not stock and would print on a re-exported book as
   * though it were.
   *
   * Fewer than asked for is not an error here. The caller knows what it wanted
   * and can compare the total against it, which is exactly what a show does
   * when it decides a cue needs a stand in.
   */
  draw(effectId: string, count = 1): Lot[] {
    if (count < 0 || !Number.isInteger(count)) {
      throw new RangeError(`cannot draw ${count} of ${effectId}`);
    }
    const taken: Lot[] = [];
    let left = count;
    for (const lot of this.issueOrder(effectId)) {
      if (left === 0) {
        break;
      }
      const units = Math.min(left, lot.quantity);
      if (units === 0) {
        continue;
      }
      left -= units;
      taken.push({ ...lot, quantity: units });
      const index = this.lots.indexOf(lot);
      if (index === -1) {
        continue;
      }
      if (lot.quantity === units) {
        this.lots.splice(index, 1);
      } else {
        this.lots[index] = { ...lot, quantity: lot.quantity - units };
      }
    }
    return taken;
  }

  /** Every lot with the given number, across effects. */
  byLotNumber(lotNumber: string): Lot[] {
    return this.lots.filter((lot) => lot.lotNumber === lotNumber);
  }

  effectIds(): string[] {
    return [...new Set(this.lots.map((lot) => lot.effectId))].sort(compareIds);
  }

  stock(): StockLine[] {
    return this.effectIds().map((effectId) => ({
      effectId,
      onHand: this.onHand(effectId),
      lots: this.lotsFor(effectId),
    }));
  }

  /**
   * Pull a lot from stock entirely, which is what a recall means. Returns how
   * many units went, so the caller can say what a show has just lost.
   */
  quarantine(lotNumber: string): number {
    let removed = 0;
    for (let i = this.lots.length - 1; i >= 0; i -= 1) {
      const lot = this.lots[i];
      if (lot !== undefined && lot.lotNumber === lotNumber) {
        removed += lot.quantity;
        this.lots.splice(i, 1);
      }
    }
    return removed;
  }

  /** Stock held for effects the catalog does not define. */
  orphans(catalog: Catalog): string[] {
    return this.effectIds().filter((effectId) => !catalog.has(effectId));
  }
}

export interface ShortfallLine {
  readonly effectId: string;
  readonly needed: number;
  readonly onHand: number;
  readonly short: number;
}

/** What a shot list needs that the magazine cannot supply. */
export function shortfall(
  needed: ReadonlyMap<string, number>,
  magazine: Magazine,
): ShortfallLine[] {
  const lines: ShortfallLine[] = [];
  for (const [effectId, count] of needed) {
    const onHand = magazine.onHand(effectId);
    if (onHand < count) {
      lines.push({ effectId, needed: count, onHand, short: count - onHand });
    }
  }
  return lines.sort((a, b) => compareIds(a.effectId, b.effectId));
}

/** Stock that no show in the given list touches. */
export function unusedStock(
  needed: ReadonlyMap<string, number>,
  magazine: Magazine,
): string[] {
  return magazine.effectIds().filter((effectId) => !needed.has(effectId));
}

export function describeShortfall(lines: readonly ShortfallLine[]): string {
  if (lines.length === 0) {
    return "everything on the shot list is in stock";
  }
  const parts = lines.map(
    (line) => `${line.effectId} short by ${plural(line.short, "unit")}`,
  );
  return parts.join("\n");
}

/** Count what a list of effects would consume, one unit each. */
export function tally(effects: Iterable<Effect>): Map<string, number> {
  return countBy(effects, (effect) => effect.id);
}
