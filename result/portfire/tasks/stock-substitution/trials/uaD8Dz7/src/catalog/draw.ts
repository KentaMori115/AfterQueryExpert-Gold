import type { Effect } from "./effect.js";
import type { Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import type { Substitute, SubstituteOptions } from "./substitute.js";
import { substitutesFor } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import type { Span } from "../core/span.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing the show out of the magazine.
 *
 * A show is designed against the house catalog and fired out of whatever the
 * magazine holds, and the gap between those two is where a display goes wrong
 * on the afternoon of the show. Until now the compiler resolved every cue
 * against the catalog and never asked whether the shell existed, so a crew
 * found out at the racks. This is the step that asks.
 *
 * Two passes, and the order is the whole point. Every cue first draws the
 * shell it was written for, in firing order, so the shots that go up early
 * keep what the designer chose and it is the tail of a long ripple that gets
 * stood in for. Only when every cue has had its own turn does the compiler go
 * back for the ones left short, again in firing order, because a stand-in
 * drawn for cue four is a shell cue forty cannot have.
 *
 * Nothing here is a suggestion. A drawn shot names the shell that will
 * actually be in the mortar, so the pin allocation, the timing and every
 * safety check downstream see the stand-in rather than the design.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before anything is drawn, which is what a recall or
   * a damaged case means. Given as lot numbers rather than effects, because
   * that is what the notice from the importer names.
   */
  readonly pull?: readonly string[];
  /** How far to look for a stand-in. The defaults are the usual answer. */
  readonly substitutes?: SubstituteOptions;
}

/** One line of what the draw did, counted over the cues it covered. */
export interface DrawLine {
  /** What the script asked for. */
  readonly effectId: string;
  /** What was drawn instead, absent when nothing could be. */
  readonly substitute?: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality?: "exact" | "near";
  /** How many cues this line covers. */
  readonly count: number;
  /** The first cue affected, for a diagnostic that points at the script. */
  readonly origin?: Span;
}

export interface Draw {
  /** Every shot, in the order it was given, now naming what will be fired. */
  readonly shots: readonly ResolvedShot[];
  /** One line per asked for and stand-in pair, in effect order. */
  readonly substitutions: readonly DrawLine[];
  /** One line per effect no stand-in covered, in effect order. */
  readonly short: readonly DrawLine[];
  /** What is left in the magazine afterwards. The book itself is untouched. */
  readonly remaining: Magazine;
  readonly diagnostics: DiagnosticBag;
}

/**
 * A copy of a magazine with the given lot numbers set aside. Lot numbers are
 * matched the way the book stores them, so a notice written in capitals still
 * pulls the right cases.
 */
export function setAside(
  magazine: Magazine,
  lots: readonly string[],
): Magazine {
  const held = magazine.copy();
  for (const lotNumber of lots) {
    held.quarantine(lotNumber.trim().toLowerCase());
  }
  return held;
}

interface Cue {
  readonly shot: ResolvedShot;
  /** Where the shot sat in the list, so the draw can hand it back in place. */
  readonly index: number;
}

/**
 * Firing order, which is what the audience sees rather than what was typed.
 * Visible time decides it, and script order breaks a tie so two cues on the
 * same beat draw in the order they were written.
 */
function drawOrder(shots: readonly ResolvedShot[]): Cue[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index);
}

interface Tally {
  count: number;
  origin?: Span;
  quality?: "exact" | "near";
  substitute?: string;
}

function record(
  into: Map<string, Tally>,
  key: string,
  origin: Span,
  extra: { quality?: "exact" | "near"; substitute?: string } = {},
): void {
  const held = into.get(key);
  if (held === undefined) {
    into.set(key, { count: 1, origin, ...extra });
    return;
  }
  held.count += 1;
}

export function drawShow(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const held = setAside(magazine, options.pull ?? []);
  const order = drawOrder(shots);
  const drawn = new Map<number, ResolvedShot>();
  const wanting: Cue[] = [];

  for (const cue of order) {
    const lot = held.draw(cue.shot.resolved.id);
    if (lot === undefined) {
      wanting.push(cue);
      continue;
    }
    drawn.set(cue.index, { ...cue.shot, lot });
  }

  // The candidate list only depends on the effect asked for, and a finale can
  // ask for the same shell two hundred times, so it is worked out once.
  const candidates = new Map<string, readonly Substitute[]>();
  const optionsFor = (wanted: Effect): readonly Substitute[] => {
    const already = candidates.get(wanted.id);
    if (already !== undefined) {
      return already;
    }
    const found = substitutesFor(wanted, catalog, options.substitutes ?? {});
    candidates.set(wanted.id, found);
    return found;
  };

  const substitutions = new Map<string, Tally>();
  const short = new Map<string, Tally>();

  for (const { shot, index } of wanting) {
    let taken: { substitute: Substitute; lot: string } | undefined;
    for (const candidate of optionsFor(shot.resolved)) {
      const lot = held.draw(candidate.effect.id);
      if (lot !== undefined) {
        taken = { substitute: candidate, lot };
        break;
      }
    }
    if (taken === undefined) {
      record(short, shot.resolved.id, shot.origin);
      continue;
    }
    const stand = taken.substitute.effect;
    drawn.set(index, {
      ...shot,
      effect: stand.id,
      resolved: stand,
      lot: taken.lot,
      substitutedFor: shot.resolved.id,
    });
    record(substitutions, `${shot.resolved.id}\u0000${stand.id}`, shot.origin, {
      quality: taken.substitute.quality,
      substitute: stand.id,
    });
  }

  const lines = (tallies: Map<string, Tally>): DrawLine[] =>
    [...tallies.entries()]
      .map(([key, tally]) => {
        const asked = key.split("\u0000")[0] ?? key;
        return {
          effectId: asked,
          ...(tally.substitute === undefined
            ? {}
            : { substitute: tally.substitute }),
          ...(tally.quality === undefined ? {} : { quality: tally.quality }),
          count: tally.count,
          ...(tally.origin === undefined ? {} : { origin: tally.origin }),
        };
      })
      .sort(
        (a, b) =>
          compareIds(a.effectId, b.effectId) ||
          compareIds(a.substitute ?? "", b.substitute ?? ""),
      );

  const substituted = lines(substitutions);
  const missing = lines(short);

  return {
    shots: shots.map((shot, index) => drawn.get(index) ?? shot),
    substitutions: substituted,
    short: missing,
    remaining: held,
    diagnostics: checkDraw(substituted, missing),
  };
}

/**
 * What the draw has to say for itself. One line per pair rather than per cue,
 * because a ripple standing in forty shells is one decision a shooter has to
 * agree with and forty copies of it would bury everything else.
 */
export function checkDraw(
  substitutions: readonly DrawLine[],
  short: readonly DrawLine[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of substitutions) {
    const message = `${line.effectId} short ${line.count}, drawing ${line.substitute ?? "nothing"} instead`;
    if (line.quality === "near") {
      diagnostics.warning({
        code: "PF1602",
        message,
        ...(line.origin === undefined ? {} : { span: line.origin }),
        help: `${line.substitute ?? "the stand-in"} is a different calibre in the same band, so check the separation`,
      });
    } else {
      diagnostics.note({
        code: "PF1601",
        message,
        ...(line.origin === undefined ? {} : { span: line.origin }),
      });
    }
  }
  for (const line of short) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}, ${line.count} left short`,
      ...(line.origin === undefined ? {} : { span: line.origin }),
      help: "redesign the cue, or buy in",
    });
  }
  return diagnostics;
}

/** A one line verdict, for the top of a report. */
export function describeDraw(draw: Draw): string {
  const stood = draw.substitutions.reduce((sum, line) => sum + line.count, 0);
  const missing = draw.short.reduce((sum, line) => sum + line.count, 0);
  if (stood === 0 && missing === 0) {
    return "every cue drew the shell it was written for";
  }
  const parts: string[] = [];
  if (stood > 0) {
    parts.push(`${stood} cues drew a stand-in`);
  }
  if (missing > 0) {
    parts.push(`${missing} cues have nothing to fire`);
  }
  return parts.join(", ");
}
