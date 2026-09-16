import type { Effect } from "./effect.js";
import { isAerial, isCake, isGround, isMine } from "./effect.js";
import { apogeeFor } from "./lift.js";
import type { Metres } from "../core/units.js";
import { metres, raw } from "../core/units.js";

/**
 * The space an effect takes up.
 *
 * Two envelopes matter and they are not the same shape. The break envelope is
 * the ball of burning stars in the sky, and it decides whether two effects
 * will collide or wash each other out. The fallout envelope is the disc on the
 * ground where the spent casing and any unburnt star will land, and it decides
 * where the audience cannot stand.
 *
 * The fallout disc is always wider than the break, because a star that is
 * still lit when it stops burning outward keeps travelling, and because the
 * casing itself falls from apogee under nothing but gravity and whatever wind
 * is doing at three hundred feet.
 */

export interface Envelope {
  /** Height of the centre of the effect above the firing point. */
  readonly centreHeight: Metres;
  /** Radius of the lit ball, or of the ground piece's spray. */
  readonly radius: Metres;
  /** Radius on the ground within which debris is expected to land. */
  readonly falloutRadius: Metres;
}

/**
 * How much wider the fallout disc is than the break. A star that burns out at
 * the edge of the break still has outward speed, and a casing tumbles. One and
 * a half is the figure crews use when nothing better is known.
 */
const FALLOUT_FACTOR = 1.5;

/** The smallest fallout disc worth quoting, in metres. */
const MIN_FALLOUT = 10;

export function envelopeOf(effect: Effect, apogee?: Metres): Envelope {
  if (isGround(effect)) {
    const height = raw(effect.height);
    return {
      centreHeight: metres(height / 2),
      radius: metres(Math.max(2, height)),
      falloutRadius: metres(Math.max(MIN_FALLOUT, height * 2)),
    };
  }
  if (isMine(effect)) {
    const height = raw(effect.height);
    // A mine is a cone standing on its point, so the widest part is at the
    // top and the radius comes off the spread angle rather than the calibre.
    const spread = Math.tan((effect.spreadAngle * Math.PI) / 360) * height;
    return {
      centreHeight: metres(height / 2),
      radius: metres(Math.max(2, spread)),
      falloutRadius: metres(Math.max(MIN_FALLOUT, spread * FALLOUT_FACTOR)),
    };
  }
  if (isCake(effect)) {
    const top = raw(apogee ?? apogeeFor(effect.calibre));
    const fan = effect.fanAngle ?? 0;
    const spread = Math.tan((fan * Math.PI) / 360) * top;
    const radius = Math.max(6, spread);
    return {
      centreHeight: metres(top / 2),
      radius: metres(radius),
      falloutRadius: metres(Math.max(MIN_FALLOUT, (top / 2 + radius) * 0.8)),
    };
  }
  if (isAerial(effect)) {
    const top = raw(effect.breakHeight ?? apogee ?? apogeeFor(effect.calibre));
    const radius = raw(effect.breakDiameter) / 2;
    return {
      centreHeight: metres(top),
      radius: metres(radius),
      falloutRadius: metres(Math.max(MIN_FALLOUT, radius * FALLOUT_FACTOR)),
    };
  }
  // A candle is the remaining kind, a narrow column to its own height.
  const height = raw(effect.height);
  return {
    centreHeight: metres(height / 2),
    radius: metres(4),
    falloutRadius: metres(Math.max(MIN_FALLOUT, height * 0.5)),
  };
}

/** The top of the lit ball, which is what an airspace ceiling cares about. */
export function ceilingOf(envelope: Envelope): Metres {
  return metres(raw(envelope.centreHeight) + raw(envelope.radius));
}

/** The bottom, which is what the audience below cares about. */
export function floorOf(envelope: Envelope): Metres {
  return metres(Math.max(0, raw(envelope.centreHeight) - raw(envelope.radius)));
}

/**
 * Whether two effects fired from the same point would run into each other.
 * Two breaks that intersect are not automatically a fault, since a deliberate
 * pair does exactly that, but the compiler should be able to say it happened.
 */
export function envelopesIntersect(
  a: Envelope,
  b: Envelope,
  horizontalGap = 0,
): boolean {
  const dz = raw(a.centreHeight) - raw(b.centreHeight);
  const distance = Math.hypot(dz, horizontalGap);
  return distance < raw(a.radius) + raw(b.radius);
}

/** How far apart two effects have to be fired to keep their breaks clear. */
export function clearanceBetween(a: Envelope, b: Envelope): Metres {
  const dz = raw(a.centreHeight) - raw(b.centreHeight);
  const wanted = raw(a.radius) + raw(b.radius);
  if (wanted <= Math.abs(dz)) {
    return metres(0);
  }
  return metres(Math.sqrt(wanted * wanted - dz * dz));
}

export function describeEnvelope(envelope: Envelope): string {
  const centre = raw(envelope.centreHeight).toFixed(0);
  const radius = raw(envelope.radius).toFixed(0);
  const fallout = raw(envelope.falloutRadius).toFixed(0);
  return `${radius}m ball at ${centre}m, fallout ${fallout}m`;
}
