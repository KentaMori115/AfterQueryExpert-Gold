import type { QuantisedSchedule } from "./quantise.js";
import type { FiringEvent, Schedule } from "./schedule.js";
import { groupBy } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { mean, stdDev } from "../core/numeric.js";
import { plural } from "../core/text.js";
import { formatShowTime } from "../core/timecode.js";
import { ms, raw } from "../core/units.js";
import type { Milliseconds } from "../core/units.js";
import { formatPin } from "../rig/pin.js";
import { chainInterval, chainsOf, isFused } from "./fusing.js";

/**
 * Firing a run from one output.
 *
 * A rack can be chain fused. One electric match lights a length of quickmatch
 * that runs along the rack, and each tube goes as the fire reaches it. The
 * whole run costs one pin instead of twelve, which on a rig with sixty four
 * outputs and a four hundred shot finale is the difference between a show that
 * fits and one that does not.
 *
 * The cost is that the interval is fixed by the quickmatch, not by the panel.
 * Roughly a hundred and twenty milliseconds per foot of fuse, which crews cut
 * to length, so a chain gives an even run at whatever interval was cut and
 * nothing else. A run whose interval varies cannot be chained, and neither can
 * one that has to hit a beat in the middle.
 */

/** Quickmatch burns at roughly this rate, which sets the interval. */
export const FUSE_MS_PER_METRE = 400;

/** A chain longer than this is unreliable, the far end often does not light. */
export const MAX_CHAIN_LENGTH = 24;

/** How much the intervals in a run may vary and still be one chain. */
export const INTERVAL_TOLERANCE_MS = 25;

export interface ChainCandidate {
  readonly events: readonly FiringEvent[];
  readonly position: string;
  readonly effectId: string;
  /** The even interval a chain would give. */
  readonly interval: Milliseconds;
  /** Metres of quickmatch to cut for that interval. */
  readonly fuseMetres: number;
  /** Pins saved by chaining this run. */
  readonly pinsSaved: number;
}

function intervalsOf(events: readonly FiringEvent[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i += 1) {
    const previous = events[i - 1];
    const current = events[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    gaps.push(raw(current.ignitionAt) - raw(previous.ignitionAt));
  }
  return gaps;
}

/**
 * Runs that could be chained. A run is consecutive events at one position
 * firing one effect, evenly spaced within tolerance, at least three long.
 * Two is not worth a chain, since the saving is one pin and the cost is a cut
 * length of fuse and a knot.
 */
export function chainCandidates(
  schedule: Schedule | QuantisedSchedule,
  maxLength: number = MAX_CHAIN_LENGTH,
): ChainCandidate[] {
  // A run that is already chained is not a candidate for chaining.
  const byGroup = groupBy(
    schedule.events.filter((event) => !isFused(event)),
    (event) => `${event.position}|${event.effectId}`,
  );

  const candidates: ChainCandidate[] = [];
  for (const [key, group] of byGroup) {
    const ordered = [...group].sort(
      (a, b) => raw(a.ignitionAt) - raw(b.ignitionAt),
    );
    let run: FiringEvent[] = [];
    const flush = (): void => {
      if (run.length >= 3) {
        candidates.push(buildCandidate(key, run));
      }
      run = [];
    };
    for (const event of ordered) {
      if (run.length === 0) {
        run.push(event);
        continue;
      }
      const provisional = [...run, event];
      const gaps = intervalsOf(provisional);
      const spread = stdDev(gaps);
      if (spread <= INTERVAL_TOLERANCE_MS && provisional.length <= maxLength) {
        run = provisional;
        continue;
      }
      flush();
      run = [event];
    }
    flush();
  }
  return candidates.sort((a, b) => b.pinsSaved - a.pinsSaved);
}

function buildCandidate(
  key: string,
  run: readonly FiringEvent[],
): ChainCandidate {
  const [position = "", effectId = ""] = key.split("|");
  const interval = mean(intervalsOf(run));
  return {
    events: run,
    position,
    effectId,
    interval: ms(Math.round(interval)),
    fuseMetres: Number((interval / FUSE_MS_PER_METRE).toFixed(2)),
    pinsSaved: run.length - 1,
  };
}

/** Metres of quickmatch to cut for an interval, to the centimetre. */
export function fuseMetresFor(interval: Milliseconds): number {
  return Number((raw(interval) / FUSE_MS_PER_METRE).toFixed(2));
}

/**
 * The runs the script already chains, in the same shape as a candidate so a
 * pack can list what is fused beside what could be. The saving is real
 * here rather than proposed: the run holds one pin and would have held one
 * per shot.
 */
export function declaredChains(
  schedule: Schedule | QuantisedSchedule,
): ChainCandidate[] {
  const declared: ChainCandidate[] = [];
  for (const run of chainsOf(schedule.events).values()) {
    const first = run[0];
    if (first === undefined) {
      continue;
    }
    const interval = chainInterval(run);
    declared.push({
      events: run,
      position: first.position,
      effectId: first.effectId,
      interval,
      fuseMetres: fuseMetresFor(interval),
      pinsSaved: run.length - 1,
    });
  }
  return declared.sort(
    (a, b) =>
      raw(a.events[0]?.ignitionAt ?? ms(0)) -
      raw(b.events[0]?.ignitionAt ?? ms(0)),
  );
}

export function totalPinsSaved(candidates: readonly ChainCandidate[]): number {
  return candidates.reduce(
    (total, candidate) => total + candidate.pinsSaved,
    0,
  );
}

/**
 * How far each shot in a chain moves from where the script asked for it. A
 * chain is evenly spaced, so a run that was jittered or that drifted loses
 * that and this says by how much.
 */
export function chainDrift(candidate: ChainCandidate): number {
  const first = candidate.events[0];
  if (first === undefined) {
    return 0;
  }
  let worst = 0;
  candidate.events.forEach((event, index) => {
    const ideal = raw(first.ignitionAt) + index * raw(candidate.interval);
    worst = Math.max(worst, Math.abs(raw(event.ignitionAt) - ideal));
  });
  return worst;
}

export function suggestChains(
  schedule: Schedule | QuantisedSchedule,
  maxLength: number = MAX_CHAIN_LENGTH,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const candidates = chainCandidates(schedule, maxLength);
  for (const candidate of candidates) {
    const first = candidate.events[0];
    if (first === undefined) {
      continue;
    }
    diagnostics.note({
      code: "PF3500",
      message: `${candidate.events.length} shots of ${candidate.effectId} at ${candidate.position} from ${formatShowTime(first.ignitionAt)} could be one chain`,
      help: `cut ${candidate.fuseMetres}m of quickmatch for a ${raw(candidate.interval)}ms interval and save ${plural(candidate.pinsSaved, "pin")}`,
    });
  }
  return diagnostics;
}

/** A chain long enough that the far end may not light. */
export function overlongChains(
  schedule: Schedule | QuantisedSchedule,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const candidate of chainCandidates(schedule, Number.MAX_SAFE_INTEGER)) {
    if (candidate.events.length > MAX_CHAIN_LENGTH) {
      diagnostics.warning({
        code: "PF3501",
        message: `a chain of ${candidate.events.length} at ${candidate.position} is longer than ${MAX_CHAIN_LENGTH}`,
        help: "split it, the far end of a long chain often does not light",
      });
    }
  }
  return diagnostics;
}

export function describeChain(candidate: ChainCandidate): string {
  const first = candidate.events[0];
  const last = candidate.events[candidate.events.length - 1];
  const from = first === undefined ? "?" : formatPin(first.address);
  const to = last === undefined ? "?" : formatPin(last.address);
  return `${candidate.events.length} x ${candidate.effectId} at ${candidate.position}, ${from} to ${to}, ${raw(candidate.interval)}ms, saves ${candidate.pinsSaved}`;
}
