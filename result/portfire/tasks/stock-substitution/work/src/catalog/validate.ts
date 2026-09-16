import { bandOf } from "./calibre.js";
import type { Effect } from "./effect.js";
import { isAerial, isCake, isCandle, isGround, isMine } from "./effect.js";
import { apogeeFor, tabulatedSizes } from "./lift.js";
import type { Catalog } from "./registry.js";
import { timingOf } from "./timing.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { raw } from "../core/units.js";

/**
 * Catching the catalog entries that are wrong before they reach a show.
 *
 * A catalog is typed in by hand, usually from a supplier's PDF, usually at
 * speed. The mistakes are always the same: a hang time entered in seconds into
 * a column that wanted milliseconds, a break diameter copied from the row
 * above, a cake whose shot interval would put the whole rack out in a tenth of
 * a second. None of these stop the compiler. All of them make the show wrong,
 * and the shooter finds out on the field.
 *
 * So these are warnings rather than errors, with one exception. A number that
 * cannot physically be true is an error, because carrying it forward makes
 * every downstream calculation nonsense rather than merely optimistic.
 */

export interface ValidationOptions {
  /** Largest bore the site can take, in millimetres. */
  readonly maxCalibreMm?: number;
}

export function validateEffect(
  effect: Effect,
  diagnostics: DiagnosticBag,
  options: ValidationOptions = {},
): void {
  const where = effect.id;

  if (isGround(effect)) {
    const seconds = raw(effect.duration) / 1000;
    if (seconds <= 0) {
      diagnostics.error({
        code: "PF1100",
        message: `${where} burns for no time at all`,
      });
    } else if (seconds > 600) {
      diagnostics.warning({
        code: "PF1101",
        message: `${where} burns for ${seconds.toFixed(0)}s, over ten minutes`,
        help: "check whether the duration column was in seconds",
      });
    }
    if (raw(effect.height) > 30) {
      diagnostics.warning({
        code: "PF1102",
        message: `${where} is a ground piece reaching ${raw(effect.height)}m`,
      });
    }
    return;
  }

  const size = raw(effect.calibre.size);
  const sizes = tabulatedSizes();
  const smallest = sizes[0] ?? 0;
  const largest = sizes[sizes.length - 1] ?? 0;
  if (size <= 0) {
    diagnostics.error({
      code: "PF1103",
      message: `${where} has a calibre of ${size}mm`,
    });
    return;
  }
  if (size > largest) {
    diagnostics.warning({
      code: "PF1104",
      message: `${where} is ${size}mm, past the largest measured lift`,
      help: `flight times above ${largest}mm are held flat, not extrapolated`,
    });
  }
  if (size < smallest && !isCake(effect) && !isCandle(effect)) {
    diagnostics.warning({
      code: "PF1105",
      message: `${where} is ${size}mm, below the smallest measured lift`,
    });
  }
  const limit = options.maxCalibreMm;
  if (limit !== undefined && size > limit) {
    diagnostics.warning({
      code: "PF1106",
      message: `${where} is ${size}mm and the site takes ${limit}mm`,
    });
  }

  if (isAerial(effect)) {
    const hang = raw(effect.hangTime);
    if (hang <= 0) {
      diagnostics.error({
        code: "PF1107",
        message: `${where} has no hang time`,
      });
    } else if (hang < 300) {
      diagnostics.warning({
        code: "PF1108",
        message: `${where} hangs for ${hang}ms`,
        help: "a hang time under 300ms usually means seconds were entered",
      });
    }
    const diameter = raw(effect.breakDiameter);
    if (diameter <= 0) {
      diagnostics.error({
        code: "PF1109",
        message: `${where} breaks to nothing`,
      });
    } else if (diameter > size * 2) {
      diagnostics.warning({
        code: "PF1110",
        message: `${where} breaks ${diameter}m wide on a ${size}mm shell`,
        help: "a break is about a metre per millimetre of calibre",
      });
    }
    const height = effect.breakHeight;
    if (height !== undefined && raw(height) > raw(apogeeFor(effect.calibre))) {
      diagnostics.warning({
        code: "PF1111",
        message: `${where} asks to break above its own apogee`,
        help: "the lowered break is ignored and the full climb is used",
      });
    }
    if (effect.breakStyle === "salute" && bandOf(effect.calibre) === "small") {
      diagnostics.warning({
        code: "PF1112",
        message: `${where} is a salute under 75mm, check the noise limit`,
      });
    }
  }

  if (isCake(effect) || isCandle(effect)) {
    if (effect.shots < 1 || !Number.isInteger(effect.shots)) {
      diagnostics.error({
        code: "PF1113",
        message: `${where} has ${effect.shots} shots`,
      });
    }
    const interval = raw(effect.shotInterval);
    if (interval <= 0) {
      diagnostics.error({
        code: "PF1114",
        message: `${where} fires every shot at once`,
      });
    } else if (interval < 40) {
      diagnostics.warning({
        code: "PF1115",
        message: `${where} fires a shot every ${interval}ms`,
        help: "under a frame apart, the whole rack reads as one report",
      });
    }
    const total = raw(timingOf(effect).duration) / 1000;
    if (total > 180) {
      diagnostics.warning({
        code: "PF1116",
        message: `${where} runs for ${total.toFixed(0)}s once lit`,
      });
    }
  }

  if (isMine(effect)) {
    if (effect.spreadAngle <= 0 || effect.spreadAngle > 180) {
      diagnostics.warning({
        code: "PF1117",
        message: `${where} spreads ${effect.spreadAngle} degrees`,
      });
    }
    if (raw(effect.height) > 80) {
      diagnostics.warning({
        code: "PF1118",
        message: `${where} is a mine reaching ${raw(effect.height)}m`,
        help: "a mine that climbs like that is really a shell",
      });
    }
  }
}

export function validateCatalog(
  catalog: Catalog,
  options: ValidationOptions = {},
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const seenNames = new Map<string, string[]>();
  for (const effect of catalog.all()) {
    validateEffect(effect, diagnostics, options);
    const key = effect.name.toLowerCase();
    const existing = seenNames.get(key);
    if (existing === undefined) {
      seenNames.set(key, [effect.id]);
    } else {
      existing.push(effect.id);
    }
  }
  for (const [name, ids] of seenNames) {
    if (ids.length > 1) {
      diagnostics.warning({
        code: "PF1119",
        message: `${ids.length} entries share the printed name ${name}`,
        help: `they are ${ids.join(", ")}, and a cue sheet cannot tell them apart`,
      });
    }
  }
  return diagnostics;
}
