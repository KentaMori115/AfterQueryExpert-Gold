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

  /**
   * A working copy. Drawing a show spends stock, and the book a caller handed
   * in is a legal record rather than scratch paper, so anything that draws
   * works on one of these and leaves the original as it found it.
   */
  clone(): Magazine {
    return Magazine.from(this.lots);
  }

  /**
   * The lots of one effect in the order they should be issued: oldest stock
   * first, because a shell that has sat in a magazine for three summers is the
   * one to fire while it still fires. A lot with no received date goes last
   * rather than first, since an undated row is usually one somebody has not
   * finished writing and guessing it is ancient would empty it first. Ties go
   * by lot number, so two deliveries on one day always draw the same way.
   */
  issueOrder(effectId: string): Lot[] {
    return this.lotsFor(effectId).sort((a, b) => {
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
    });
  }

  /**
   * Take one unit of an effect out and say which lot it came from. Nothing
   * comes back when there is none left, which is the answer a draw needs
   * before it goes looking for something to stand in.
   */
  draw(effectId: string): Lot | undefined {
    const next = this.issueOrder(effectId).find((lot) => lot.quantity > 0);
    if (next === undefined) {
      return undefined;
    }
    const index = this.lots.indexOf(next);
    this.lots[index] = { ...next, quantity: next.quantity - 1 };
    return next;
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
