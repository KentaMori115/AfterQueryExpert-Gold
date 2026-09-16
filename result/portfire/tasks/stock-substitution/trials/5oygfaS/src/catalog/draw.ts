import type { Magazine } from "./inventory.js";
import { withoutLots } from "./inventory.js";
import type { Catalog } from "./registry.js";
import type { Substitute } from "./substitute.js";
import { substitutesFor } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing the show out of the magazine.
 *
 * A show is designed against the house catalog and fired from whatever the
 * magazine holds, and the two agree far less often than a designer would like.
 * Up to here the compiler has been working from the catalog, which is a list of
 * what exists rather than of what is in the store. This is the stage that hands
 * every cue a physical shell.
 *
 * The order matters more than it looks. Cues are drawn in firing order, so the
 * shells go to the cues that fire first and it is the later cues that go
 * without, which is what a crew loading a field would do anyway. Every cue gets
 * a chance at what the script actually asked for before any of them is offered
 * a stand-in, because covering cue four with something else while cue ninety
 * still holds the real thing is how a show ends up with the wrong shell in the
 * wrong place.
 *
 * A stand-in is spent stock like anything else, so one shortfall can end up
 * spread across several of them, and a cue nothing covers keeps what the script
 * wrote and takes the show out of service until somebody decides what to do.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before anything is drawn. A recall, a wet case or a
   * lot somebody wants kept for another date, all of which are decisions about
   * this show rather than changes to the book.
   */
  readonly pull?: readonly string[];
}

export interface StandIn {
  /** What the script asked for. */
  readonly effectId: string;
  /** What was fired instead. */
  readonly substitute: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  /** How many shots were drawn as this stand-in. */
  readonly shots: number;
  /** The lots they came out of, in the order they were drawn. */
  readonly lots: readonly string[];
}

export interface ShortLine {
  readonly effectId: string;
  /** How many shots were left holding what the script wrote. */
  readonly shots: number;
}

export interface DrawResult {
  /** The shots as they will be fired, in the order they were handed in. */
  readonly shots: readonly ResolvedShot[];
  readonly standIns: readonly StandIn[];
  /** What nothing in the magazine could cover. */
  readonly short: readonly ShortLine[];
  readonly diagnostics: DiagnosticBag;
  /** What is left in the store once the show is drawn. */
  readonly remaining: Magazine;
}

interface Pending {
  readonly shot: ResolvedShot;
  readonly index: number;
}

interface Tally {
  readonly effectId: string;
  readonly substitute: string;
  readonly quality: "exact" | "near";
  shots: number;
  readonly lots: string[];
}

/** Firing order: when the audience sees it, then the order the script wrote. */
function firingOrder(shots: readonly ResolvedShot[]): Pending[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

export function drawShow(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): DrawResult {
  const working = withoutLots(
    magazine,
    (options.pull ?? []).map((lotNumber) => lotNumber.trim().toLowerCase()),
  );
  const drawn = new Map<number, ResolvedShot>();
  const waiting: Pending[] = [];

  for (const entry of firingOrder(shots)) {
    const lot = working.drawOne(entry.shot.effect);
    if (lot === undefined) {
      waiting.push(entry);
      continue;
    }
    drawn.set(entry.index, { ...entry.shot, lot });
  }

  const tallies = new Map<string, Tally>();
  const short = new Map<string, number>();
  const offered = new Map<string, Substitute[]>();

  for (const entry of waiting) {
    const asked = entry.shot.effect;
    let candidates = offered.get(asked);
    if (candidates === undefined) {
      candidates = substitutesFor(entry.shot.resolved, catalog);
      offered.set(asked, candidates);
    }
    let covered = false;
    for (const candidate of candidates) {
      const lot = working.drawOne(candidate.effect.id);
      if (lot === undefined) {
        continue;
      }
      drawn.set(entry.index, {
        ...entry.shot,
        effect: candidate.effect.id,
        resolved: candidate.effect,
        substitutedFor: asked,
        lot,
      });
      record(tallies, asked, candidate, lot);
      covered = true;
      break;
    }
    if (!covered) {
      short.set(asked, (short.get(asked) ?? 0) + 1);
    }
  }

  const standIns = [...tallies.values()]
    .map((tally) => ({ ...tally, lots: [...tally.lots] }))
    .sort(
      (a, b) =>
        compareIds(a.effectId, b.effectId) ||
        compareIds(a.substitute, b.substitute),
    );
  const shortLines = [...short.entries()]
    .map(([effectId, count]) => ({ effectId, shots: count }))
    .sort((a, b) => compareIds(a.effectId, b.effectId));

  return {
    shots: shots.map((shot, index) => drawn.get(index) ?? shot),
    standIns,
    short: shortLines,
    diagnostics: checkDraw(standIns, shortLines),
    remaining: working,
  };
}

function record(
  tallies: Map<string, Tally>,
  asked: string,
  candidate: Substitute,
  lot: string,
): void {
  const key = `${asked} ${candidate.effect.id}`;
  const held = tallies.get(key);
  if (held === undefined) {
    tallies.set(key, {
      effectId: asked,
      substitute: candidate.effect.id,
      quality: candidate.quality,
      shots: 1,
      lots: [lot],
    });
    return;
  }
  held.shots += 1;
  if (!held.lots.includes(lot)) {
    held.lots.push(lot);
  }
}

function lotPhrase(lots: readonly string[]): string {
  return `${lots.length === 1 ? "lot" : "lots"} ${lots.join(", ")}`;
}

/** One line a crew can read out, for a stand-in under its shortfall. */
export function describeStandIn(standIn: StandIn): string {
  return `${plural(standIn.shots, "shot")} drawn as ${standIn.substitute} from ${lotPhrase(standIn.lots)}`;
}

/**
 * What a draw is worth saying about. One line per asked for effect and stand-in
 * pair rather than one per cue, because a finale covered forty shots deep is
 * one decision to check and forty identical notes would bury the one cue that
 * nothing covered.
 */
export function checkDraw(
  standIns: readonly StandIn[],
  short: readonly ShortLine[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const asked = [
    ...new Set([
      ...standIns.map((standIn) => standIn.effectId),
      ...short.map((line) => line.effectId),
    ]),
  ].sort(compareIds);

  for (const effectId of asked) {
    for (const standIn of standIns.filter(
      (entry) => entry.effectId === effectId,
    )) {
      const message = `${effectId} short, ${plural(standIn.shots, "shot")} drawn as ${standIn.substitute}`;
      if (standIn.quality === "exact") {
        diagnostics.note({
          code: "PF1601",
          message,
          help: `from ${lotPhrase(standIn.lots)}`,
        });
      } else {
        diagnostics.warning({
          code: "PF1602",
          message,
          help: `${standIn.substitute} is a different calibre in the same band, so check the separation`,
        });
      }
    }
    const line = short.find((entry) => entry.effectId === effectId);
    if (line !== undefined) {
      diagnostics.error({
        code: "PF1600",
        message: `nothing in stock can stand in for ${effectId}, ${plural(line.shots, "shot")} left as written`,
        help: "redesign the cue, buy in, or pull the cue from the show",
      });
    }
  }
  return diagnostics;
}

/** How many shots each lot gave the show, for the paperwork after it. */
export function lotsDrawn(shots: readonly ResolvedShot[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    if (shot.lot !== undefined) {
      counts.set(shot.lot, (counts.get(shot.lot) ?? 0) + 1);
    }
  }
  return counts;
}
