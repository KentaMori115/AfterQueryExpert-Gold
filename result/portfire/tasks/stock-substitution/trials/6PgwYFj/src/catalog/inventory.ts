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
 * The order stock gets used in: whatever came in earliest goes out first, a
 * lot with no received date last of all, and the lot number to settle a tie.
 *
 * Oldest first is not a preference. Stock ages, and a crew that leaves one
 * case at the back of the store for three seasons finds out about it on a
 * field in front of an audience.
 */
export function compareLots(a: Lot, b: Lot): number {
  if (a.received !== b.received) {
    if (a.received === undefined) {
      return 1;
    }
    if (b.received === undefined) {
      return -1;
    }
    return a.received < b.received ? -1 : 1;
  }
  return compareIds(a.lotNumber, b.lotNumber);
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

  /**
   * The order the lots of one effect get used in, oldest stock first. An empty
   * lot is left out, because a lot with nothing in it is a piece of paperwork
   * rather than something a crew can carry to the field.
   */
  drawOrder(effectId: string): Lot[] {
    return this.lotsFor(effectId)
      .filter((lot) => lot.quantity > 0)
      .sort(compareLots);
  }

  /**
   * Take one unit out, from the oldest lot that has any. Returns the lot it
   * came from, so the caller can write it on the cue sheet, which is the whole
   * reason stock is held by lot rather than by effect.
   */
  issue(effectId: string): Lot | undefined {
    const first = this.drawOrder(effectId)[0];
    if (first === undefined) {
      return undefined;
    }
    const index = this.lots.findIndex(
      (held) =>
        held.lotNumber === first.lotNumber && held.effectId === first.effectId,
    );
    const held = this.lots[index];
    if (held === undefined) {
      return undefined;
    }
    this.lots[index] = { ...held, quantity: held.quantity - 1 };
    return { ...held, quantity: 1 };
  }

  /**
   * An independent copy. A draw spends stock as it goes and the book it was
   * handed has to read the same afterwards as it did before, because it is a
   * legal record of what is in the store rather than a scratch pad.
   */
  copy(): Magazine {
    return Magazine.from(this.lots);
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
