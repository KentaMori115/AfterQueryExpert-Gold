import type { Calibre } from "./calibre.js";
import type { EffectId } from "../core/ids.js";
import type { Metres, Milliseconds } from "../core/units.js";
import { metres, ms, raw } from "../core/units.js";

/**
 * What a display is actually made of.
 *
 * The five kinds here are not a taxonomy for its own sake. They are the five
 * shapes that behave differently in the compiler. A shell has to be fired
 * early because it climbs. A cake fires itself once lit, so the panel only
 * touches its first shot. A mine has no climb at all and goes off at the
 * muzzle. A candle fires a slow train from one tube. A ground piece burns for
 * a fixed time and never leaves the deck. Everything else is a variation on
 * one of those.
 */

export type BreakStyle =
  | "peony"
  | "chrysanthemum"
  | "dahlia"
  | "willow"
  | "kamuro"
  | "palm"
  | "brocade"
  | "crossette"
  | "ring"
  | "strobe"
  | "salute";

export type GroundStyle =
  | "gerb"
  | "fountain"
  | "waterfall"
  | "lance"
  | "wheel"
  | "flame";

export const BREAK_STYLES: readonly BreakStyle[] = [
  "peony",
  "chrysanthemum",
  "dahlia",
  "willow",
  "kamuro",
  "palm",
  "brocade",
  "crossette",
  "ring",
  "strobe",
  "salute",
];

export const GROUND_STYLES: readonly GroundStyle[] = [
  "gerb",
  "fountain",
  "waterfall",
  "lance",
  "wheel",
  "flame",
];

export function isBreakStyle(value: string): value is BreakStyle {
  return (BREAK_STYLES as readonly string[]).includes(value);
}

export function isGroundStyle(value: string): value is GroundStyle {
  return (GROUND_STYLES as readonly string[]).includes(value);
}

export interface EffectBase {
  readonly id: EffectId;
  /** What the cue sheet prints, which is not always the catalogue name. */
  readonly name: string;
  readonly maker?: string;
}

export interface AerialShell extends EffectBase {
  readonly kind: "shell";
  readonly calibre: Calibre;
  readonly breakStyle: BreakStyle;
  /** How long the stars burn after the break. */
  readonly hangTime: Milliseconds;
  /** How wide the break opens, which the safety layer needs. */
  readonly breakDiameter: Metres;
  /** A lowered break, for a site that cannot take the full apogee. */
  readonly breakHeight?: Metres;
}

export interface Cake extends EffectBase {
  readonly kind: "cake";
  readonly calibre: Calibre;
  readonly shots: number;
  /** Gap between shots on the internal fuse. */
  readonly shotInterval: Milliseconds;
  /** A fanned cake throws its shots outward rather than straight up. */
  readonly fanAngle?: number;
  readonly hangTime: Milliseconds;
}

export interface Mine extends EffectBase {
  readonly kind: "mine";
  readonly calibre: Calibre;
  /** How wide the spray opens at its top. */
  readonly spreadAngle: number;
  readonly height: Metres;
  readonly hangTime: Milliseconds;
}

export interface RomanCandle extends EffectBase {
  readonly kind: "candle";
  readonly calibre: Calibre;
  readonly shots: number;
  readonly shotInterval: Milliseconds;
  readonly height: Metres;
}

export interface GroundPiece extends EffectBase {
  readonly kind: "ground";
  readonly style: GroundStyle;
  readonly duration: Milliseconds;
  readonly height: Metres;
}

export type Effect = AerialShell | Cake | Mine | RomanCandle | GroundPiece;
export type EffectKind = Effect["kind"];

export const EFFECT_KINDS: readonly EffectKind[] = [
  "shell",
  "cake",
  "mine",
  "candle",
  "ground",
];

export function isAerial(effect: Effect): effect is AerialShell {
  return effect.kind === "shell";
}

export function isCake(effect: Effect): effect is Cake {
  return effect.kind === "cake";
}

export function isMine(effect: Effect): effect is Mine {
  return effect.kind === "mine";
}

export function isCandle(effect: Effect): effect is RomanCandle {
  return effect.kind === "candle";
}

export function isGround(effect: Effect): effect is GroundPiece {
  return effect.kind === "ground";
}

/**
 * The calibre of an effect, where it has one. A ground piece has no bore, and
 * returning a made up zero there would put it in a separation distance
 * calculation as if it were a very small shell.
 */
export function calibreOf(effect: Effect): Calibre | undefined {
  return isGround(effect) ? undefined : effect.calibre;
}

/** How many separate reports an effect makes, for the shot count. */
export function shotCount(effect: Effect): number {
  if (isCake(effect) || isCandle(effect)) {
    return effect.shots;
  }
  return 1;
}

/** Whether the effect leaves the ground, which decides the airspace checks. */
export function goesUp(effect: Effect): boolean {
  return !isGround(effect);
}

/**
 * How high the effect reaches. For a shell this is where it breaks, which is
 * its own reduced height when the script asked for one. Everything else is
 * carrying its height already.
 */
export function reachOf(effect: Effect, fullApogee: Metres): Metres {
  switch (effect.kind) {
    case "shell":
      return effect.breakHeight ?? fullApogee;
    case "cake":
      return fullApogee;
    case "mine":
    case "candle":
      return effect.height;
    case "ground":
      return effect.height;
  }
}

/** The single number a cue sheet prints to describe the effect. */
export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case "shell":
      return `${effect.calibre.inchLabel}in ${effect.breakStyle}`;
    case "cake":
      return `${effect.shots} shot ${effect.calibre.inchLabel}in cake`;
    case "mine":
      return `${effect.calibre.inchLabel}in mine`;
    case "candle":
      return `${effect.shots} shot candle`;
    case "ground":
      return `${effect.style}, ${(raw(effect.duration) / 1000).toFixed(1)}s`;
  }
}

export interface ShellInit {
  readonly id: EffectId;
  readonly name: string;
  readonly calibre: Calibre;
  readonly breakStyle?: BreakStyle;
  readonly hangTime?: Milliseconds;
  readonly breakDiameter?: Metres;
  readonly maker?: string;
}

/**
 * Build a shell, filling in the numbers a catalogue usually leaves out. Break
 * diameter runs about a metre per millimetre of calibre and hang time about
 * two and a half seconds for a medium shell, both of which are close enough
 * for a first pass and both of which a catalogue entry can override.
 */
export function shell(init: ShellInit): AerialShell {
  const size = raw(init.calibre.size);
  const built: {
    kind: "shell";
    id: EffectId;
    name: string;
    calibre: Calibre;
    breakStyle: BreakStyle;
    hangTime: Milliseconds;
    breakDiameter: Metres;
    maker?: string;
  } = {
    kind: "shell",
    id: init.id,
    name: init.name,
    calibre: init.calibre,
    breakStyle: init.breakStyle ?? "peony",
    hangTime: init.hangTime ?? ms(Math.round(1200 + size * 8)),
    breakDiameter: init.breakDiameter ?? metres(Math.round(size * 0.9)),
  };
  if (init.maker !== undefined) {
    built.maker = init.maker;
  }
  return built;
}
