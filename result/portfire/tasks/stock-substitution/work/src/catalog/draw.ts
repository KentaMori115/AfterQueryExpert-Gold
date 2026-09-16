import type { Effect } from "./effect.js";
import { calibreOf } from "./effect.js";
import { Magazine } from "./inventory.js";
import type { Lot } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { substitutesFor } from "./substitute.js";
import type { Substitute, SubstituteOptions } from "./substitute.js";
import { timingOf } from "./timing.js";
import { countBy, sortedEntries } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { plural, renderTable } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Firing from what the magazine actually holds.
 *
 * A show is designed against the catalog and fired against the stock, and
 * the two drift apart in the last week: a case is short, a lot gets pulled,
 * somebody borrowed twenty of the three inch for the Saturday job. The
 * inventory command says what is missing. This says what happens to the
 * show because of it, cue by cue, which is the question the crew has on the
 * afternoon of the show with the racks half loaded.
 *
 * Two orders matter and they are not the same order. Shots draw in firing
 * order, so when an effect runs out it is the last cues that go without,
 * which is what a designer would choose anyway: the opener matters more than
 * the fourth ripple in the build. But nothing is lent to another effect
 * until every cue of its own has drawn, whatever the clock says. A six inch
 * palm at ten seconds must not be given a six inch willow that a cue at
 * fifty seconds was going to need, or the shortfall has just been moved to a
 * later cue where nobody is looking for it.
 *
 * Lots drain oldest first. Composition ages, and the magazine book exists so
 * that a shell can be traced back to its lot when it misbehaves, so the lot
 * each cue drew from goes onto the cue sheet rather than into a spreadsheet
 * nobody reconciles afterwards.
 */

/** A shot with the stock it will fire, which may not be what was written. */
export interface DrawnShot extends ResolvedShot {
  /** The lot the shot draws from, when stock covered it. */
  readonly lot?: string;
  /** What the script asked for, when a stand-in fires instead. */
  readonly substitutedFor?: string;
}

export interface DrawOptions {
  readonly magazine: Magazine;
  /** Lot numbers to pull from stock before anything is drawn. */
  readonly pull?: readonly string[];
  /** How a stand-in is chosen. The defaults are the substitute module's own. */
  readonly substitute?: SubstituteOptions;
}

/** One asked-for effect covered by one stand-in, however many shots. */
export interface Cover {
  readonly asked: string;
  readonly used: string;
  readonly quality: Substitute["quality"];
  readonly count: number;
  readonly leadDifferenceMs: number;
}

export interface Shortfall {
  readonly effectId: string;
  /** Shots that neither their own effect nor any stand-in could cover. */
  readonly uncovered: number;
}

export interface DrawResult {
  readonly shots: readonly DrawnShot[];
  readonly diagnostics: DiagnosticBag;
  readonly covers: readonly Cover[];
  readonly short: readonly Shortfall[];
  /** Units taken out of each lot, in lot order. */
  readonly drawn: ReadonlyMap<string, number>;
  /** Units that left the magazine with a pulled lot. */
  readonly pulled: ReadonlyMap<string, number>;
}

/**
 * Oldest lot first. A lot with no received date sorts after every dated one,
 * because the usual reason a row has no date is that it predates the book,
 * and guessing it is fresher than a dated lot is the wrong way to be wrong
 * about ageing composition. Equal dates, or two undated lots, go by number.
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
  return a.lotNumber < b.lotNumber ? -1 : a.lotNumber > b.lotNumber ? 1 : 0;
}

interface Shelf {
  readonly lot: Lot;
  left: number;
}

/** The stock of one effect, as a queue of lots in drawing order. */
class Bin {
  private readonly shelves: Shelf[];

  constructor(lots: readonly Lot[]) {
    this.shelves = [...lots]
      .sort(compareLots)
      .map((lot) => ({ lot, left: lot.quantity }));
  }

  get left(): number {
    return this.shelves.reduce((total, shelf) => total + shelf.left, 0);
  }

  /** Take one unit from the oldest lot that still has any. */
  take(): string | undefined {
    for (const shelf of this.shelves) {
      if (shelf.left > 0) {
        shelf.left -= 1;
        return shelf.lot.lotNumber;
      }
    }
    return undefined;
  }
}

class Store {
  private readonly bins = new Map<string, Bin>();

  constructor(magazine: Magazine) {
    for (const line of magazine.stock()) {
      this.bins.set(line.effectId, new Bin(line.lots));
    }
  }

  left(effectId: string): number {
    return this.bins.get(effectId)?.left ?? 0;
  }

  take(effectId: string): string | undefined {
    return this.bins.get(effectId)?.take();
  }
}

/**
 * A copy of the book with the pulled lots gone, so the caller's magazine is
 * untouched and a quarantine here does not become a quarantine everywhere.
 */
function afterPulling(
  magazine: Magazine,
  pull: readonly string[],
): { magazine: Magazine; pulled: Map<string, number> } {
  const copy = Magazine.from(magazine.stock().flatMap((line) => line.lots));
  const pulled = new Map<string, number>();
  for (const lotNumber of pull) {
    const key = lotNumber.trim().toLowerCase();
    if (key.length === 0) {
      continue;
    }
    pulled.set(key, (pulled.get(key) ?? 0) + copy.quarantine(key));
  }
  return { magazine: copy, pulled };
}

/** Firing order: when the audience sees it, then the order it was written. */
function inFiringOrder(shots: readonly ResolvedShot[]): ResolvedShot[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index)
    .map((entry) => entry.shot);
}

function coverKey(asked: string, used: string): string {
  return `${asked} ${used}`;
}

export function drawStock(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  options: DrawOptions,
): DrawResult {
  const diagnostics = new DiagnosticBag();
  const { magazine, pulled } = afterPulling(
    options.magazine,
    options.pull ?? [],
  );
  const store = new Store(magazine);
  const ordered = inFiringOrder(shots);

  // First pass: every shot draws its own effect while the bin lasts. Nothing
  // is lent yet, so a later cue of the same effect is never robbed by an
  // earlier cue of a different one.
  const drawn = new Map<ResolvedShot, DrawnShot>();
  const waiting: ResolvedShot[] = [];
  for (const shot of ordered) {
    const lot = store.take(shot.effect);
    if (lot === undefined) {
      waiting.push(shot);
    } else {
      drawn.set(shot, { ...shot, lot });
    }
  }

  // Second pass: cover what went without, in the same order, from whatever
  // is left. The candidate list is the substitute module's own ranking; the
  // only thing added here is that a unit lent is gone for the next shot, so
  // a shortfall of ten may take six of one stand-in and four of another.
  const candidates = new Map<string, readonly Substitute[]>();
  const covers = new Map<string, Cover>();
  const uncovered = new Map<string, number>();
  for (const shot of waiting) {
    let list = candidates.get(shot.effect);
    if (list === undefined) {
      list = substitutesFor(shot.resolved, catalog, options.substitute ?? {});
      candidates.set(shot.effect, list);
    }
    const chosen = list.find(
      (candidate) => store.left(candidate.effect.id) > 0,
    );
    const lot = chosen === undefined ? undefined : store.take(chosen.effect.id);
    if (chosen === undefined || lot === undefined) {
      uncovered.set(shot.effect, (uncovered.get(shot.effect) ?? 0) + 1);
      drawn.set(shot, { ...shot });
      continue;
    }
    drawn.set(shot, {
      ...shot,
      effect: chosen.effect.id,
      resolved: chosen.effect,
      substitutedFor: shot.effect,
      lot,
    });
    const key = coverKey(shot.effect, chosen.effect.id);
    const held = covers.get(key);
    covers.set(
      key,
      held === undefined
        ? {
            asked: shot.effect,
            used: chosen.effect.id,
            quality: chosen.quality,
            count: 1,
            leadDifferenceMs: chosen.leadDifferenceMs,
          }
        : { ...held, count: held.count + 1 },
    );
  }

  const result: DrawnShot[] = shots.map((shot) => {
    const held = drawn.get(shot);
    if (held === undefined) {
      throw new Error(`a shot of ${shot.effect} was lost while drawing`);
    }
    return held;
  });
  const coverList = [...covers.values()].sort(
    (a, b) => compareIds(a.asked, b.asked) || compareIds(a.used, b.used),
  );
  const short: Shortfall[] = sortedEntries(uncovered, compareIds).map(
    ([effectId, count]) => ({ effectId, uncovered: count }),
  );
  diagnostics.addAll(drawDiagnostics(coverList, short).all());

  return {
    shots: result,
    diagnostics,
    covers: coverList,
    short,
    drawn: lotsDrawn(result),
    pulled,
  };
}

/**
 * The codes are the substitute module's, so a crew that already reads
 * PF1601 and PF1602 off an inventory plan reads the same thing here. An
 * exact match is a note: same calibre, same lift, the sheet changes and
 * nothing else does. A band match is a warning, because the separation
 * distance moved and somebody has to look at it. Nothing to stand in is an
 * error, because a cue with no shell behind it is a hole in the show.
 */
export function drawDiagnostics(
  covers: readonly Cover[],
  short: readonly Shortfall[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const cover of covers) {
    const message = `${cover.asked} short, ${cover.used} stands in for ${plural(cover.count, "shot")}`;
    if (cover.quality === "exact") {
      diagnostics.note({ code: "PF1601", message });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${cover.used} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  for (const line of short) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${plural(line.uncovered, "shot")} of ${line.effectId}`,
      help: "redesign the cue, or buy in",
    });
  }
  return diagnostics;
}

/**
 * The one line for the top of a report: how much fired as written, how much
 * a stand-in covered, how much nothing could. A crew reads this before the
 * table, and if the last number is not zero they stop reading the table.
 */
export function stockSummary(result: DrawResult): string {
  const own = result.shots.filter(
    (shot) => shot.lot !== undefined && shot.substitutedFor === undefined,
  ).length;
  const covered = substituted(result.shots).length;
  const short = uncoveredShots(result.shots).length;
  const parts = [`${plural(own, "shot")} as written`];
  if (covered > 0) {
    parts.push(`${covered} covered by a stand-in`);
  }
  if (short > 0) {
    parts.push(`${short} with nothing to fire`);
  }
  if (result.pulled.size > 0) {
    const gone = [...result.pulled.values()].reduce((a, b) => a + b, 0);
    parts.push(
      `${plural(result.pulled.size, "lot")} pulled, ${plural(gone, "unit")} gone`,
    );
  }
  return parts.join(", ");
}

/** How many units of each effect actually fire, stand-ins counted as themselves. */
export function drawnByEffect(
  shots: readonly DrawnShot[],
): Map<string, number> {
  const counts = countBy(
    shots.filter((shot) => shot.lot !== undefined),
    (shot) => shot.effect,
  );
  return new Map(sortedEntries(counts, compareIds));
}

/** The covers that touch one effect, asked for or standing in. */
export function coversFor(result: DrawResult, effectId: string): Cover[] {
  return result.covers.filter(
    (cover) => cover.asked === effectId || cover.used === effectId,
  );
}

/**
 * The book after the show: every lot less what the show drew from it, and
 * the pulled lots gone. Written back with `writeMagazine`, this is the
 * record the next show is checked against, so the arithmetic is done here
 * once rather than by hand on the night. A lot drawn down to nothing stays
 * in the book at zero, because the row is the audit trail for that lot.
 */
export function bookAfter(magazine: Magazine, result: DrawResult): Magazine {
  const after = new Magazine();
  for (const line of magazine.stock()) {
    for (const lot of line.lots) {
      if (result.pulled.has(lot.lotNumber)) {
        continue;
      }
      const drawn = drawnFromLot(result.shots, lot);
      after.receive({ ...lot, quantity: Math.max(0, lot.quantity - drawn) });
    }
  }
  return after;
}

function drawnFromLot(shots: readonly DrawnShot[], lot: Lot): number {
  return shots.filter(
    (shot) => shot.lot === lot.lotNumber && shot.effect === lot.effectId,
  ).length;
}

/**
 * Stock the catalog cannot name is stock the compile can never draw, and
 * the usual cause is a renamed effect: the book still says `shell.6.palm`
 * and the catalog moved on to `shell.150.palm`. That is a warning rather
 * than an error because the book is a legal record and a row in it is not
 * wrong for being unreachable, but a crew wants to know before the night.
 */
export function checkBook(magazine: Magazine, catalog: Catalog): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const effectId of magazine.orphans(catalog)) {
    const lots = magazine.lotsFor(effectId).map((lot) => lot.lotNumber);
    diagnostics.warning({
      code: "PF1603",
      message: `the book holds ${plural(magazine.onHand(effectId), "unit")} of ${effectId}, which the catalog does not define`,
      help: `lots ${lots.join(", ")}; rename the row or add the effect to the catalog`,
    });
  }
  return diagnostics;
}

/** Shots that will fire something other than what the script named. */
export function substituted(shots: readonly DrawnShot[]): DrawnShot[] {
  return shots.filter((shot) => shot.substitutedFor !== undefined);
}

/** Shots nothing in the magazine could cover, own effect or stand-in. */
export function uncoveredShots(shots: readonly DrawnShot[]): DrawnShot[] {
  return shots.filter((shot) => shot.lot === undefined);
}

/** How many units each lot number gives up, in lot order. */
export function lotsDrawn(shots: readonly DrawnShot[]): Map<string, number> {
  const counts = countBy(
    shots.filter((shot) => shot.lot !== undefined),
    (shot) => shot.lot ?? "",
  );
  return new Map(sortedEntries(counts));
}

/** How much longer or shorter the panel has to allow for a stand-in. */
export function leadShift(from: Effect, to: Effect): number {
  return raw(timingOf(to).lead) - raw(timingOf(from).lead);
}

function calibreLabel(effect: Effect): string {
  const size = calibreOf(effect);
  return size === undefined ? "ground" : `${raw(size.size).toFixed(0)}mm`;
}

/** The stand-in table for a pack or a report. */
export function describeCovers(
  covers: readonly Cover[],
  catalog: Catalog,
): string {
  if (covers.length === 0) {
    return "every cue fires what the script names";
  }
  return renderTable(
    [
      { header: "asked for" },
      { header: "stands in" },
      { header: "shots", align: "right" },
      { header: "match" },
      { header: "calibre" },
      { header: "lead", align: "right" },
    ],
    covers.map((cover) => {
      const used = catalog.get(cover.used);
      return [
        cover.asked,
        cover.used,
        String(cover.count),
        cover.quality,
        used === undefined ? "" : calibreLabel(used),
        `${cover.leadDifferenceMs.toFixed(0)}ms`,
      ];
    }),
  );
}

/** One line per lot the show draws on, in the order the book drains them. */
export function describeLots(result: DrawResult): string {
  const rows = [...result.drawn.entries()].map(([lot, count]) => [
    lot,
    String(count),
  ]);
  for (const [lot, count] of result.pulled) {
    rows.push([lot, `pulled, ${plural(count, "unit")} gone`]);
  }
  if (rows.length === 0) {
    return "nothing drawn";
  }
  return renderTable(
    [{ header: "lot" }, { header: "drawn", align: "right" }],
    rows,
  );
}

/**
 * The cues that will not fire what the script says, one row each, in the
 * order the show fires them. This is the list a crew walks the field with,
 * because a stand-in is loaded into the same mortar as the shell it replaces
 * and the person loading it has to know which mortars those are.
 */
export function describeChangedCues(shots: readonly DrawnShot[]): string {
  const changed = inFiringOrder(shots).filter(
    (shot): shot is DrawnShot =>
      (shot as DrawnShot).substitutedFor !== undefined ||
      (shot as DrawnShot).lot === undefined,
  );
  if (changed.length === 0) {
    return "every cue fires what the script names, from stock";
  }
  return renderTable(
    [
      { header: "at", align: "right" },
      { header: "position" },
      { header: "asked for" },
      { header: "fires" },
      { header: "lot" },
    ],
    changed.map((shot) => [
      `${(raw(shot.at) / 1000).toFixed(1)}s`,
      shot.position,
      shot.substitutedFor ?? shot.effect,
      shot.lot === undefined ? "nothing" : shot.effect,
      shot.lot ?? "",
    ]),
  );
}

export function describeDraw(result: DrawResult, catalog: Catalog): string {
  const lines = [
    stockSummary(result),
    "",
    describeCovers(result.covers, catalog),
  ];
  for (const line of result.short) {
    lines.push(
      `${line.effectId}: ${plural(line.uncovered, "shot")} with nothing to fire`,
    );
  }
  lines.push("", describeChangedCues(result.shots), "", describeLots(result));
  return lines.join("\n");
}
