/**
 * The physical quantities a display is measured in.
 *
 * Every number that crosses a module boundary in portfire carries a unit in
 * its type. The reason is not tidiness. A shell caliber is quoted in inches by
 * shooters and in millimetres by importers, lift time is quoted in seconds by
 * catalogues and in milliseconds by firing panels, and separation distance is
 * quoted in feet by the American standards and in metres by the European ones.
 * Mixing any two of those pairs produces a number that looks reasonable and is
 * wrong by a factor that will not show up until the show is on the field.
 */

const brand = Symbol("portfire.unit");

type Branded<K extends string> = number & { readonly [brand]: K };

/** Bore diameter of a mortar or the nominal size of a shell, millimetres. */
export type Millimetres = Branded<"mm">;
/** Ground distance or break altitude, metres. */
export type Metres = Branded<"m">;
/** Any time offset or duration inside a show, milliseconds. */
export type Milliseconds = Branded<"ms">;
/** Firing current drawn through a rail, amperes. */
export type Amperes = Branded<"A">;
/** Bridge wire or loop resistance, ohms. */
export type Ohms = Branded<"ohm">;
/** Wind speed at the firing site, metres per second. */
export type MetresPerSecond = Branded<"m/s">;

const MM_PER_INCH = 25.4;
const M_PER_FOOT = 0.3048;

function finite(value: number, unit: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${unit} value must be finite, got ${value}`);
  }
}

function nonNegative(value: number, unit: string): void {
  finite(value, unit);
  if (value < 0) {
    throw new RangeError(`${unit} value must not be negative, got ${value}`);
  }
}

export function mm(value: number): Millimetres {
  nonNegative(value, "millimetre");
  return value as Millimetres;
}

export function metres(value: number): Metres {
  nonNegative(value, "metre");
  return value as Metres;
}

/**
 * Milliseconds are allowed to be negative. A cue's ignition offset routinely
 * lands before the show clock starts when a large shell has to break on the
 * downbeat of bar one, and clamping that to zero silently moves the break.
 */
export function ms(value: number): Milliseconds {
  finite(value, "millisecond");
  return value as Milliseconds;
}

export function amperes(value: number): Amperes {
  nonNegative(value, "ampere");
  return value as Amperes;
}

export function ohms(value: number): Ohms {
  nonNegative(value, "ohm");
  return value as Ohms;
}

export function metresPerSecond(value: number): MetresPerSecond {
  nonNegative(value, "wind speed");
  return value as MetresPerSecond;
}

/** Strip the brand. Use only at the edges, where a plain number is wanted. */
export function raw(value: Branded<string>): number {
  return value as number;
}

export function inches(value: number): Millimetres {
  return mm(value * MM_PER_INCH);
}

export function toInches(value: Millimetres): number {
  return (value as number) / MM_PER_INCH;
}

export function feet(value: number): Metres {
  return metres(value * M_PER_FOOT);
}

export function toFeet(value: Metres): number {
  return (value as number) / M_PER_FOOT;
}

export function seconds(value: number): Milliseconds {
  return ms(value * 1000);
}

export function toSeconds(value: Milliseconds): number {
  return (value as number) / 1000;
}

export function addMs(a: Milliseconds, b: Milliseconds): Milliseconds {
  return ms((a as number) + (b as number));
}

export function subMs(a: Milliseconds, b: Milliseconds): Milliseconds {
  return ms((a as number) - (b as number));
}

export function scaleMs(a: Milliseconds, factor: number): Milliseconds {
  finite(factor, "scale factor");
  return ms((a as number) * factor);
}

export function addMetres(a: Metres, b: Metres): Metres {
  return metres((a as number) + (b as number));
}

export function addAmperes(a: Amperes, b: Amperes): Amperes {
  return amperes((a as number) + (b as number));
}

export function maxMs(...values: readonly Milliseconds[]): Milliseconds {
  if (values.length === 0) {
    throw new RangeError("maxMs needs at least one value");
  }
  return values.reduce((best, next) => (next > best ? next : best));
}

export function minMs(...values: readonly Milliseconds[]): Milliseconds {
  if (values.length === 0) {
    throw new RangeError("minMs needs at least one value");
  }
  return values.reduce((best, next) => (next < best ? next : best));
}

/**
 * Round a caliber to the nearest size that mortars are actually made in.
 * Catalogues quote 2.5 inch, 3 inch and so on, and importers convert those to
 * 63, 75 and 100 millimetres with enough rounding noise that an equality test
 * on the raw conversion never matches.
 */
const NOMINAL_CALIBRES_MM = [
  25, 30, 38, 50, 63, 75, 100, 125, 150, 200, 250, 300, 350, 400,
] as const;

export function nominalCalibre(value: Millimetres): Millimetres {
  let best: number = NOMINAL_CALIBRES_MM[0];
  let bestGap = Math.abs(best - (value as number));
  for (const candidate of NOMINAL_CALIBRES_MM) {
    const gap = Math.abs(candidate - (value as number));
    if (gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return mm(best);
}

export function nominalCalibres(): readonly Millimetres[] {
  return NOMINAL_CALIBRES_MM.map((value) => mm(value));
}
