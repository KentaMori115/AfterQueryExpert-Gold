import type { Lot, Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import type { Substitute, SubstituteOptions } from "./substitute.js";
import { substitutesFor } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing the show out of the magazine.
 *
 * A show is designed against a catalog and fired out of a store, and the two
 * never quite agree. Up to here every cue has whatever the script asked for,
 * because the catalog is a price list and a price list never runs out. The
 * magazine does, and the afternoon of a show the question is not what was
 * designed but what is on the shelf and what else will do.
 *
 * So the show is drawn rather than assumed. Every cue takes a unit of its own
 * effect in firing order while there is stock, and only once every cue has had
 * that chance do the ones left short go looking for a stand-in. Firing order
 * matters and script order does not: if there are eight of something and ten
 * cues want it, the two that go without should be the two at the end of the
 * show, not the two that happen to sit last in the file. Making every cue draw
 * its own first matters for the same reason. A stand-in taken early is a unit
 * of something else gone, and a later cue that could have had it is then short
 * as well, which turns one shortfall into two.
 *
 * A drawn cue carries its lot number from here on, because that is what a
 * recall pulls and what an investigation asks for, and a cue firing a stand-in
 * carries what the script asked for alongside what is actually going up the
 * tube. Everything downstream, pins and separation included, sees the stand-in,
 * because the stand-in is what will be in the mortar.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before anything is drawn, as a recall or a damaged
   * case means. They are gone for the whole draw rather than skipped once.
   */
  readonly pull?: readonly string[];
  /** How a stand-in is looked for. The defaults are what a crew would accept. */
  readonly substitute?: SubstituteOptions;
}

/** One asked-for effect covered by one stand-in, and what that cost. */
export interface StandIn {
  /** What the script asked for. */
  readonly effectId: string;
  /** What fires instead. */
  readonly standInId: string;
  readonly quality: "exact" | "near";
  /** How many cues it covers. */
  readonly shots: number;
  /** The lots those cues draw, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An asked-for effect with cues that nothing in the magazine could cover. */
export interface UncoveredLine {
  readonly effectId: string;
  readonly shots: number;
}

export interface Draw {
  /** The shots as they will be fired, stand-ins and lot numbers on them. */
  readonly shots: readonly ResolvedShot[];
  readonly standIns: readonly StandIn[];
  readonly uncovered: readonly UncoveredLine[];
  /** What the magazine holds afterwards, so a caller can see what is left. */
  readonly remaining: Magazine;
  readonly diagnostics: DiagnosticBag;
}

/** Firing order: when the audience sees it, then where it sits in the script. */
function firingOrder(
  shots: readonly ResolvedShot[],
): { shot: ResolvedShot; index: number }[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

/** A stand-in being counted up as the draw goes along. */
interface Tally {
  readonly effectId: string;
  readonly standInId: string;
  readonly quality: "exact" | "near";
  shots: number;
  readonly lots: string[];
}

function key(effectId: string, standInId: string): string {
  return `${effectId}|${standInId}`;
}

export function drawShow(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const remaining = magazine.copy();
  for (const lotNumber of options.pull ?? []) {
    remaining.quarantine(lotNumber.trim().toLowerCase());
  }

  const ordered = firingOrder(shots);
  const drawn = new Map<number, ResolvedShot>();
  const short: { shot: ResolvedShot; index: number }[] = [];

  for (const entry of ordered) {
    const lot = remaining.draw(entry.shot.resolved.id);
    if (lot === undefined) {
      short.push(entry);
      continue;
    }
    drawn.set(entry.index, { ...entry.shot, lot: lot.lotNumber });
  }

  const offers = new Map<string, Substitute[]>();
  const standIns = new Map<string, Tally>();
  const uncovered = new Map<string, number>();

  for (const entry of short) {
    const asked = entry.shot.resolved;
    let candidates = offers.get(asked.id);
    if (candidates === undefined) {
      candidates = substitutesFor(asked, catalog, options.substitute ?? {});
      offers.set(asked.id, candidates);
    }
    const found = firstInStock(candidates, remaining);
    if (found === undefined) {
      uncovered.set(asked.id, (uncovered.get(asked.id) ?? 0) + 1);
      continue;
    }
    const { candidate, lot } = found;
    drawn.set(entry.index, {
      ...entry.shot,
      effect: candidate.effect.id,
      resolved: candidate.effect,
      substitutedFor: entry.shot.effect,
      lot: lot.lotNumber,
    });
    const at = key(asked.id, candidate.effect.id);
    const held = standIns.get(at) ?? {
      effectId: asked.id,
      standInId: candidate.effect.id,
      quality: candidate.quality,
      shots: 0,
      lots: [],
    };
    held.shots += 1;
    if (!held.lots.includes(lot.lotNumber)) {
      held.lots.push(lot.lotNumber);
    }
    standIns.set(at, held);
  }

  const lines = [...standIns.values()]
    .map((held) => ({ ...held, lots: [...held.lots] }))
    .sort(
      (a, b) =>
        compareIds(a.effectId, b.effectId) ||
        compareIds(a.standInId, b.standInId),
    );
  const missing = [...uncovered.entries()]
    .map(([effectId, count]) => ({ effectId, shots: count }))
    .sort((a, b) => compareIds(a.effectId, b.effectId));

  return {
    shots: shots.map((shot, index) => drawn.get(index) ?? shot),
    standIns: lines,
    uncovered: missing,
    remaining,
    diagnostics: checkDraw(lines, missing),
  };
}

/**
 * The first candidate the magazine can actually supply one of, taken. A shell
 * lent to one cue is gone, so walking the list per cue rather than per shortfall
 * is what lets one shortfall be covered by two or three different stand-ins.
 */
function firstInStock(
  candidates: readonly Substitute[],
  magazine: Magazine,
): { candidate: Substitute; lot: Lot } | undefined {
  for (const candidate of candidates) {
    const lot = magazine.draw(candidate.effect.id);
    if (lot !== undefined) {
      return { candidate, lot };
    }
  }
  return undefined;
}

/**
 * What the draw has to say for itself. One line per pair rather than per cue,
 * because a finale short of forty shells would otherwise bury everything else
 * in the report, and the number of cues is on the line anyway.
 */
export function checkDraw(
  standIns: readonly StandIn[],
  uncovered: readonly UncoveredLine[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of standIns) {
    const message = `${line.effectId} ran out, ${plural(line.shots, "cue")} fire ${line.standInId} instead`;
    if (line.quality === "exact") {
      diagnostics.note({
        code: "PF1601",
        message,
        help: `${line.standInId} is the same calibre, from ${line.lots.join(", ")}`,
      });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${line.standInId} is a different calibre in the same band, from ${line.lots.join(", ")}, so check the separation and the timing`,
      });
    }
  }
  for (const line of uncovered) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId} on ${plural(line.shots, "cue")}`,
      help: "redesign the cue, or buy in",
    });
  }
  return diagnostics;
}
