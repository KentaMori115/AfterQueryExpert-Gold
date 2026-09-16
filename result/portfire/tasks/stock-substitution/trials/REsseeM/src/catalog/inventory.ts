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
 * The order a draw takes lots in: the earliest received first, so the oldest
 * stock leaves the store first; a lot with no received date last, because it
 * cannot be placed in that queue; and the lot number to break a tie, so two
 * runs of the same show draw the same shells.
 */
export function compareDrawOrder(a: Lot, b: Lot): number {
  const received = a.received ?? "";
  const other = b.received ?? "";
  if (received !== other) {
    if (received === "") {
      return 1;
    }
    if (other === "") {
      return -1;
    }
    return received < other ? -1 : 1;
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
   * A magazine holding the same lots, so a show can be drawn from stock
   * without the book it was drawn against changing under anybody. A compile
   * that emptied the caller's magazine would give a different answer the
   * second time it ran, which is the worst kind of wrong.
   */
  copy(): Magazine {
    return Magazine.from(this.lots);
  }

  /** The lots for an effect, in the order a draw should empty them. */
  drawOrder(effectId: string): Lot[] {
    return this.lotsFor(effectId)
      .filter((lot) => lot.quantity > 0)
      .sort(compareDrawOrder);
  }

  /**
   * Take one unit of an effect out of the oldest lot that still holds any, and
   * say which lot it came from. Nothing on hand means nothing drawn, which is
   * a shortfall rather than an error, because a shortfall is answered by
   * standing something else in.
   *
   * The emptied row stays in the book at zero. A lot that has been fired is
   * still a lot the paperwork has to account for.
   */
  draw(effectId: string): string | undefined {
    const next = this.drawOrder(effectId)[0];
    if (next === undefined) {
      return undefined;
    }
    const at = this.lots.findIndex(
      (lot) =>
        lot.lotNumber === next.lotNumber && lot.effectId === next.effectId,
    );
    const held = this.lots[at];
    if (held === undefined) {
      return undefined;
    }
    this.lots[at] = { ...held, quantity: held.quantity - 1 };
    return held.lotNumber;
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
