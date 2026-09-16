import type { Effect } from "./effect.js";
import { isAerial, isCake, isCandle, isGround, isMine } from "./effect.js";
import { IGNITION_DELAY, riseTimeFor, riseTimeToHeight } from "./lift.js";
import type { Interval } from "../core/interval.js";
import { fromDuration } from "../core/interval.js";
import type { Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";

/**
 * When an effect has to be fired for it to be seen when it should be.
 *
 * Every effect has three moments, and confusing any two of them is the classic
 * way to build a show that runs late. There is the moment the panel closes the
 * circuit, the moment the audience first sees something, and the moment the
 * last light goes out. A cue in a script names the middle one. The firing
 * table holds the first. The safety and density checks work on the window
 * between the first and the last.
 */

export interface EffectTiming {
  /** Ignition to the first visible moment. Zero for a ground piece. */
  readonly lead: Milliseconds;
  /** Ignition to the last light out. */
  readonly duration: Milliseconds;
  /** Ignition to the loudest and brightest instant, for density weighting. */
  readonly peak: Milliseconds;
}

/**
 * A cake's own fuse runs the whole rack once lit, so the panel fires it once
 * and the rest is out of the compiler's hands. That is exactly why a cake is a
 * poor thing to hang a musical hit on.
 */
function cakeSpan(shots: number, interval: Milliseconds): number {
  return Math.max(0, shots - 1) * raw(interval);
}

export function timingOf(effect: Effect): EffectTiming {
  if (isAerial(effect)) {
    const rise =
      effect.breakHeight === undefined
        ? riseTimeFor(effect.calibre)
        : riseTimeToHeight(effect.calibre, effect.breakHeight);
    const lead = raw(IGNITION_DELAY) + raw(rise);
    return {
      lead: ms(lead),
      duration: ms(lead + raw(effect.hangTime)),
      peak: ms(lead),
    };
  }
  if (isCake(effect)) {
    // A cake's first shot still climbs, but only a little, and the whole rack
    // matters more than the first tube, so the peak sits in the middle.
    const rise = raw(riseTimeFor(effect.calibre));
    const lead = raw(IGNITION_DELAY) + rise;
    const span = cakeSpan(effect.shots, effect.shotInterval);
    return {
      lead: ms(lead),
      duration: ms(lead + span + raw(effect.hangTime)),
      peak: ms(lead + span / 2),
    };
  }
  if (isMine(effect)) {
    // A mine goes off at the muzzle, so there is nothing to compensate for
    // beyond the match itself. This is what makes mines the reliable thing to
    // put on a downbeat.
    const lead = raw(IGNITION_DELAY);
    return {
      lead: ms(lead),
      duration: ms(lead + raw(effect.hangTime)),
      peak: ms(lead),
    };
  }
  if (isCandle(effect)) {
    const lead = raw(IGNITION_DELAY) + 250;
    const span = cakeSpan(effect.shots, effect.shotInterval);
    return {
      lead: ms(lead),
      duration: ms(lead + span + 900),
      peak: ms(lead + span / 2),
    };
  }
  const lead = raw(IGNITION_DELAY);
  return {
    lead: ms(lead),
    duration: ms(lead + raw(effect.duration)),
    peak: ms(lead + raw(effect.duration) / 2),
  };
}

/**
 * The moment to fire so the effect is seen at `wantedAt`. This can land before
 * zero on the show clock, and that is not an error. It means the shell has to
 * be in the air before the music starts, which is ordinary for a large opener
 * and something the panel handles with a pre roll.
 */
export function ignitionTimeFor(
  effect: Effect,
  wantedAt: Milliseconds,
): Milliseconds {
  return ms(raw(wantedAt) - raw(timingOf(effect).lead));
}

/** The reverse, for reading a firing table back into a script. */
export function visibleTimeFor(
  effect: Effect,
  ignitedAt: Milliseconds,
): Milliseconds {
  return ms(raw(ignitedAt) + raw(timingOf(effect).lead));
}

/** The window from ignition to the last light out. */
export function occupancyOf(effect: Effect, ignitedAt: Milliseconds): Interval {
  return fromDuration(ignitedAt, timingOf(effect).duration);
}

/** The window the audience actually sees something, which starts later. */
export function visibleWindowOf(
  effect: Effect,
  ignitedAt: Milliseconds,
): Interval {
  const timing = timingOf(effect);
  const start = ms(raw(ignitedAt) + raw(timing.lead));
  return fromDuration(start, ms(raw(timing.duration) - raw(timing.lead)));
}

/**
 * How far ahead of the show the earliest cue has to fire. A show whose first
 * shell is a twelve inch needs six seconds of pre roll before the music, and
 * a panel that cannot pre roll has to start the music late instead.
 */
export function preRollFor(effects: Iterable<Effect>): Milliseconds {
  let worst = 0;
  for (const effect of effects) {
    const lead = raw(timingOf(effect).lead);
    if (lead > worst) {
      worst = lead;
    }
  }
  return ms(worst);
}

/** Whether an effect is precise enough to hang a musical hit on. */
export function isTightOnCue(effect: Effect): boolean {
  if (isGround(effect)) {
    return true;
  }
  if (isMine(effect)) {
    return true;
  }
  return raw(timingOf(effect).lead) <= 2500;
}
