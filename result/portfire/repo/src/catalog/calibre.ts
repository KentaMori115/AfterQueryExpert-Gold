import type { Millimetres } from "../core/units.js";
import { inches, mm, nominalCalibre, raw, toInches } from "../core/units.js";

/**
 * Shell and mortar sizes.
 *
 * Calibre is the one number a shooter quotes about a shell, and everything
 * else follows from it. Apogee, break diameter, separation distance, the
 * mortar the shell goes in and the rack that holds the mortar are all read off
 * the calibre. It arrives written half a dozen ways, because importers label
 * in millimetres, catalogues label in inches, and crews say `a six`.
 */

export type CalibreBand = "small" | "medium" | "large" | "salute-class";

export interface Calibre {
  readonly size: Millimetres;
  /** The inch figure a crew says out loud, rounded to a catalogue size. */
  readonly inchLabel: string;
}

const INCH_LABELS: readonly (readonly [number, string])[] = [
  [25, "1"],
  [30, "1.2"],
  [38, "1.5"],
  [50, "2"],
  [63, "2.5"],
  [75, "3"],
  [100, "4"],
  [125, "5"],
  [150, "6"],
  [200, "8"],
  [250, "10"],
  [300, "12"],
  [350, "14"],
  [400, "16"],
];

const PATTERN =
  /^\s*(\d+(?:\.\d+)?)\s*(mm|millimetres?|millimeters?|in|inch|inches|")?\s*$/i;

/**
 * How far a size may sit from a catalogue size and still take its label. A
 * shell bought as a six comes in anywhere from 148 to 152 millimetres, so the
 * label has to survive that. A 175 is not a six by any measure, and calling it
 * one on a cue sheet would put it in the wrong mortar.
 */
const LABEL_TOLERANCE_MM = 3;

export function calibre(size: Millimetres): Calibre {
  const nominal = nominalCalibre(size);
  const close = Math.abs(raw(nominal) - raw(size)) <= LABEL_TOLERANCE_MM;
  const label = close
    ? (INCH_LABELS.find(([value]) => value === raw(nominal))?.[1] ??
      trimZeros(toInches(size).toFixed(1)))
    : trimZeros(toInches(size).toFixed(1));
  return { size, inchLabel: label };
}

function trimZeros(value: string): string {
  return value.replace(/\.0$/, "");
}

/**
 * Read a calibre written any of the usual ways. A bare number is read as
 * millimetres when it is 20 or more and as inches below that, because nobody
 * writes a 4 millimetre shell and everybody writes a 4 inch one.
 */
export function parseCalibre(text: string): Calibre | undefined {
  const match = PATTERN.exec(text);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const unit = (match[2] ?? "").toLowerCase();
  if (unit.startsWith("mm") || unit.startsWith("milli")) {
    return calibre(mm(value));
  }
  if (unit.length > 0) {
    return calibre(inches(value));
  }
  return calibre(value >= 20 ? mm(value) : inches(value));
}

export function formatCalibre(value: Calibre): string {
  return `${raw(value.size).toFixed(0)}mm`;
}

/** What a crew calls it, such as `6in`. */
export function spokenCalibre(value: Calibre): string {
  return `${value.inchLabel}in`;
}

/**
 * The band a calibre sits in. The boundaries are the ones that matter
 * operationally rather than any published class, since 75mm is where hand
 * racks give way to fixed racks and 150mm is where a display needs a larger
 * separation than most municipal sites can offer.
 */
export function bandOf(value: Calibre): CalibreBand {
  const size = raw(value.size);
  if (size < 75) {
    return "small";
  }
  if (size < 150) {
    return "medium";
  }
  if (size < 250) {
    return "large";
  }
  return "salute-class";
}

export function compareCalibres(a: Calibre, b: Calibre): number {
  return raw(a.size) - raw(b.size);
}

export function sameCalibre(a: Calibre, b: Calibre): boolean {
  return raw(a.size) === raw(b.size);
}

/**
 * The mortar a shell of this calibre goes in. Mortars are made a little wider
 * than the shell so it drops freely, and the gap is what the lift charge has
 * to seal against, so it is not a rounding detail.
 */
export function mortarBore(value: Calibre): Millimetres {
  const size = raw(value.size);
  const clearance = size < 100 ? 2 : size < 200 ? 3 : 5;
  return mm(size + clearance);
}

export function fitsMortar(shell: Calibre, bore: Millimetres): boolean {
  const gap = raw(bore) - raw(shell.size);
  return gap >= 1 && gap <= 12;
}

export function standardCalibres(): Calibre[] {
  return INCH_LABELS.map(([size]) => calibre(mm(size)));
}
