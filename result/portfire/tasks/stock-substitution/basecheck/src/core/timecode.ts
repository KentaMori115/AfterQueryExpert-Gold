import type { Milliseconds } from "./units.js";
import { ms, raw } from "./units.js";

/**
 * Show clock arithmetic.
 *
 * Two clocks matter on a display site. The show clock is a plain elapsed time
 * from the first cue, and the shooter writes it as `1:23.450`. The timecode
 * clock is SMPTE coming off the audio playback, written `00:01:23:11`, and it
 * counts frames rather than milliseconds. Cues get written against either, and
 * the compiler has to hold both without letting the rounding drift.
 */

export type FrameRate = 24 | 25 | 30;

export interface TimecodeFormat {
  readonly rate: FrameRate;
  /**
   * NTSC drop frame. Only meaningful at 30, where the real rate is 29.97 and
   * two frame numbers are skipped every minute except every tenth minute so
   * the clock stays close to wall time.
   */
  readonly dropFrame: boolean;
}

export const SMPTE_25: TimecodeFormat = { rate: 25, dropFrame: false };
export const SMPTE_30: TimecodeFormat = { rate: 30, dropFrame: false };
export const SMPTE_2997: TimecodeFormat = { rate: 30, dropFrame: true };
export const SMPTE_24: TimecodeFormat = { rate: 24, dropFrame: false };

const DROPPED_PER_MINUTE = 2;

function frameMillis(format: TimecodeFormat): number {
  return format.dropFrame ? 1001 / 30 : 1000 / format.rate;
}

export interface Timecode {
  readonly hours: number;
  readonly minutes: number;
  readonly secs: number;
  readonly frames: number;
}

const SHOW_TIME = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/;
const TIMECODE = /^(\d{1,2}):([0-5]\d):([0-5]\d)([:;])(\d{1,2})$/;
const COMPOUND = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/;
const MILLIS = /^(\d+(?:\.\d+)?)ms$/;

/**
 * Parse a show time. Accepts `12`, `12.4`, `1:23`, `1:23.450`, `4m30s`, `90s`
 * and `250ms`. Anything else is a parse failure rather than a silent zero,
 * because a cue that quietly lands at zero fires during the safety brief.
 *
 * The millisecond suffix is checked first and on its own. It has to be,
 * because `250ms` also looks like the start of the compound form and reading
 * it as two hundred and fifty minutes is the kind of mistake that only shows
 * up once the firing table is four hours long.
 */
export function parseShowTime(input: string): Milliseconds | undefined {
  const text = input.trim();
  if (text.length === 0) {
    return undefined;
  }
  const millisMatch = MILLIS.exec(text);
  if (millisMatch) {
    return ms(Math.round(Number(millisMatch[1])));
  }
  const showMatch = SHOW_TIME.exec(text);
  if (showMatch) {
    const minutes = Number(showMatch[1] ?? "0");
    const secs = Number(showMatch[2] ?? "0");
    const fraction = (showMatch[3] ?? "").padEnd(3, "0");
    return ms(minutes * 60000 + secs * 1000 + Number(fraction));
  }
  const compoundMatch = COMPOUND.exec(text);
  if (compoundMatch && (compoundMatch[1] ?? compoundMatch[2]) !== undefined) {
    const minutes = Number(compoundMatch[1] ?? "0");
    const secs = Number(compoundMatch[2] ?? "0");
    return ms(Math.round(minutes * 60000 + secs * 1000));
  }
  return undefined;
}

/** Render a show time the way a cue sheet prints it. */
export function formatShowTime(value: Milliseconds): string {
  const total = raw(value);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(Math.round(total));
  const minutes = Math.floor(abs / 60000);
  const secs = Math.floor((abs % 60000) / 1000);
  const millis = abs % 1000;
  const padded = String(secs).padStart(2, "0");
  return `${sign}${minutes}:${padded}.${String(millis).padStart(3, "0")}`;
}

export function parseTimecode(
  input: string,
  format: TimecodeFormat,
): Timecode | undefined {
  const match = TIMECODE.exec(input.trim());
  if (!match) {
    return undefined;
  }
  const separator = match[4];
  if (separator === ";" && !format.dropFrame) {
    return undefined;
  }
  const frames = Number(match[5]);
  if (frames >= format.rate) {
    return undefined;
  }
  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
    secs: Number(match[3]),
    frames,
  };
}

export function formatTimecode(code: Timecode, format: TimecodeFormat): string {
  const separator = format.dropFrame ? ";" : ":";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [pad(code.hours), pad(code.minutes), pad(code.secs)]
    .join(":")
    .concat(separator, pad(code.frames));
}

/** Total frame count from the start of the timecode day. */
export function timecodeToFrames(
  code: Timecode,
  format: TimecodeFormat,
): number {
  const rate = format.rate;
  let count =
    ((code.hours * 60 + code.minutes) * 60 + code.secs) * rate + code.frames;
  if (format.dropFrame) {
    const totalMinutes = code.hours * 60 + code.minutes;
    count -=
      DROPPED_PER_MINUTE * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return count;
}

export function framesToTimecode(
  frames: number,
  format: TimecodeFormat,
): Timecode {
  const rate = format.rate;
  const clamped = Math.max(0, Math.round(frames));
  if (!format.dropFrame) {
    const totalSeconds = Math.floor(clamped / rate);
    return {
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      secs: totalSeconds % 60,
      frames: clamped % rate,
    };
  }
  // Drop frame runs the counter forward over the numbers that were skipped,
  // then reads the result as if nothing had been dropped. Eighteen numbers go
  // missing every ten minutes, two in each of the nine minutes that are not
  // the tenth, so the correction is a whole ten minute block plus whatever
  // part of the current block has already gone by.
  const framesPerTenMinutes = 17982;
  const framesPerMinute = 1798;
  const blocks = Math.floor(clamped / framesPerTenMinutes);
  const inBlock = clamped % framesPerTenMinutes;
  let counter = clamped + DROPPED_PER_MINUTE * 9 * blocks;
  if (inBlock >= DROPPED_PER_MINUTE) {
    counter +=
      DROPPED_PER_MINUTE *
      Math.floor((inBlock - DROPPED_PER_MINUTE) / framesPerMinute);
  }
  return {
    hours: Math.floor(counter / 108000),
    minutes: Math.floor(counter / 1800) % 60,
    secs: Math.floor(counter / 30) % 60,
    frames: counter % 30,
  };
}

export function timecodeToMs(
  code: Timecode,
  format: TimecodeFormat,
): Milliseconds {
  return ms(Math.round(timecodeToFrames(code, format) * frameMillis(format)));
}

export function msToTimecode(
  value: Milliseconds,
  format: TimecodeFormat,
): Timecode {
  const frames = Math.round(raw(value) / frameMillis(format));
  return framesToTimecode(frames, format);
}

/** Snap a time onto the nearest frame boundary of a format. */
export function quantiseToFrame(
  value: Milliseconds,
  format: TimecodeFormat,
): Milliseconds {
  const step = frameMillis(format);
  const snapped = Math.round(raw(value) / step) * step;
  // Frame lengths at 24 and 29.97 are not exact in binary, so the product
  // carries float dust that later equality tests trip over. Six decimal
  // places is far below a microsecond and well inside what a panel resolves.
  return ms(Math.round(snapped * 1e6) / 1e6);
}

export function frameDuration(format: TimecodeFormat): Milliseconds {
  return ms(frameMillis(format));
}
