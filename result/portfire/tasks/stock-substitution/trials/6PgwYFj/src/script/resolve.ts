import type { Shot } from "./expand.js";
import type { Effect } from "../catalog/effect.js";
import type { Catalog } from "../catalog/registry.js";
import { countBy } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import type { PinAddress } from "../rig/pin.js";
import { formatPin, pinKey } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";

/**
 * Tying a shot to a real effect and a real place on the field.
 *
 * Up to this point a shot is names. Resolution is where the names have to be
 * true, and it is the last stage at which a mistake is cheap. After this the
 * compiler is working with real calibres and real lift times, so a name that
 * quietly resolved to the wrong thing produces a plausible firing table with
 * the wrong shell in it.
 *
 * Nothing here throws. A show with forty unknown effect names should report
 * forty diagnostics, not the first one, because the usual cause is a catalog
 * that was never loaded and the shooter wants to see that at a glance.
 */

export interface ResolvedShot extends Shot {
  readonly resolved: Effect;
  /** Fixed only when the script named a pin. Allocation fills the rest in. */
  readonly fixedPin?: PinAddress;
  /**
   * The lot the unit was drawn from, once the show has been drawn out of a
   * magazine. Resolution never sets it, because resolution has no store to
   * draw from, and everything after this point only reads it.
   */
  readonly lot?: string;
  /**
   * What the script asked for, when the draw could not supply it and stood
   * something else in. The shot's own effect is then the stand in, because
   * every later stage has to time, place and check what will really go up.
   */
  readonly substitutedFor?: string;
}

export interface Resolution {
  readonly shots: readonly ResolvedShot[];
  readonly diagnostics: DiagnosticBag;
}

/** How close a misspelling has to be before it is worth suggesting. */
const SUGGEST_DISTANCE = 3;

/** Levenshtein, capped, because the catalog can be a few thousand entries. */
export function editDistance(a: string, b: string, cap = 4): number {
  if (Math.abs(a.length - b.length) > cap) {
    return cap + 1;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      row.push(value);
      if (value < best) {
        best = value;
      }
    }
    if (best > cap) {
      return cap + 1;
    }
    previous = row;
  }
  return previous[b.length] ?? cap + 1;
}

export function nearestName(
  wanted: string,
  candidates: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = SUGGEST_DISTANCE;
  for (const candidate of [...candidates].sort(compareIds)) {
    const distance = editDistance(wanted, candidate, SUGGEST_DISTANCE);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function resolveShots(
  shots: readonly Shot[],
  catalog: Catalog,
  rig: Rig,
): Resolution {
  const diagnostics = new DiagnosticBag();
  const resolved: ResolvedShot[] = [];
  const claimed = new Map<string, string>();
  const effectNames = catalog.ids();
  const positionNames = rig.positionIds();
  const reportedEffects = new Set<string>();
  const reportedPositions = new Set<string>();

  for (const shot of shots) {
    const effect = catalog.get(shot.effect);
    if (effect === undefined) {
      if (!reportedEffects.has(shot.effect)) {
        reportedEffects.add(shot.effect);
        const near = nearestName(shot.effect, effectNames);
        diagnostics.error({
          code: "PF2300",
          message: `no effect called ${shot.effect} in the catalog`,
          span: shot.origin,
          ...(near === undefined ? {} : { help: `did you mean ${near}` }),
        });
      }
      continue;
    }
    if (rig.position(shot.position) === undefined) {
      if (!reportedPositions.has(shot.position)) {
        reportedPositions.add(shot.position);
        const near = nearestName(shot.position, positionNames);
        diagnostics.error({
          code: "PF2301",
          message: `no firing position called ${shot.position} in the rig`,
          span: shot.origin,
          ...(near === undefined ? {} : { help: `did you mean ${near}` }),
        });
      }
      continue;
    }

    let fixed: PinAddress | undefined;
    if (shot.pin.kind === "fixed") {
      const address = { module: shot.pin.module, pin: shot.pin.pin };
      if (!rig.hasPin(address)) {
        diagnostics.error({
          code: "PF2302",
          message: `the rig has no pin ${formatPin(address)}`,
          span: shot.origin,
        });
        continue;
      }
      const at = rig.positionOf(address);
      if (at !== shot.position) {
        diagnostics.error({
          code: "PF2303",
          message: `pin ${formatPin(address)} is at ${at ?? "nowhere"}, not ${shot.position}`,
          span: shot.origin,
          help: "either move the cue to that position or let the pin be chosen",
        });
        continue;
      }
      const key = pinKey(address);
      const already = claimed.get(key);
      if (already !== undefined) {
        diagnostics.error({
          code: "PF2304",
          message: `pin ${formatPin(address)} is already taken by ${already}`,
          span: shot.origin,
        });
        continue;
      }
      claimed.set(key, shot.effect);
      fixed = address;
    }

    resolved.push({
      ...shot,
      resolved: effect,
      ...(fixed === undefined ? {} : { fixedPin: fixed }),
    });
  }

  return { shots: resolved, diagnostics };
}

/** Effects the show names, in reading order, for a shot list. */
export function effectsUsed(shots: readonly ResolvedShot[]): string[] {
  return [...new Set(shots.map((shot) => shot.effect))].sort(compareIds);
}

/** How many of each effect the show consumes. */
export function consumption(
  shots: readonly ResolvedShot[],
): Map<string, number> {
  return countBy(shots, (shot) => shot.effect);
}

/** How many shots each position carries, which is a load balance check. */
export function shotsPerPosition(
  shots: readonly ResolvedShot[],
): Map<string, number> {
  return countBy(shots, (shot) => shot.position);
}
