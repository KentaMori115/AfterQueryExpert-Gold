import { describe, expect, it } from "vitest";
import {
  SMPTE_24,
  SMPTE_25,
  SMPTE_2997,
  SMPTE_30,
  formatShowTime,
  formatTimecode,
  frameDuration,
  framesToTimecode,
  msToTimecode,
  parseShowTime,
  parseTimecode,
  quantiseToFrame,
  timecodeToFrames,
  timecodeToMs,
} from "../../src/core/timecode.js";
import { ms, raw } from "../../src/core/units.js";

describe("parseShowTime", () => {
  it("reads bare seconds", () => {
    expect(raw(parseShowTime("12")!)).toBe(12000);
  });

  it("reads seconds with a fraction", () => {
    expect(raw(parseShowTime("12.4")!)).toBe(12400);
    expect(raw(parseShowTime("12.45")!)).toBe(12450);
    expect(raw(parseShowTime("12.456")!)).toBe(12456);
  });

  it("reads minutes and seconds", () => {
    expect(raw(parseShowTime("1:23")!)).toBe(83000);
    expect(raw(parseShowTime("1:23.450")!)).toBe(83450);
  });

  it("reads minutes past sixty", () => {
    expect(raw(parseShowTime("12:00")!)).toBe(720000);
  });

  it("reads a millisecond suffix", () => {
    expect(raw(parseShowTime("250ms")!)).toBe(250);
    expect(raw(parseShowTime("40ms")!)).toBe(40);
    expect(raw(parseShowTime("33.4ms")!)).toBe(33);
  });

  it("does not read a millisecond suffix as minutes", () => {
    expect(raw(parseShowTime("250ms")!)).not.toBe(250 * 60000);
  });

  it("reads the compound form", () => {
    expect(raw(parseShowTime("4m30s")!)).toBe(270000);
    expect(raw(parseShowTime("90s")!)).toBe(90000);
    expect(raw(parseShowTime("2m")!)).toBe(120000);
    expect(raw(parseShowTime("1.5s")!)).toBe(1500);
  });

  it("trims", () => {
    expect(raw(parseShowTime("  12.4  ")!)).toBe(12400);
  });

  it("refuses nonsense rather than returning zero", () => {
    expect(parseShowTime("")).toBeUndefined();
    expect(parseShowTime("soon")).toBeUndefined();
    expect(parseShowTime("1:2:3")).toBeUndefined();
    expect(parseShowTime("12.4567")).toBeUndefined();
    expect(parseShowTime("-4")).toBeUndefined();
  });
});

describe("formatShowTime", () => {
  it("prints minutes, seconds and milliseconds", () => {
    expect(formatShowTime(ms(83450))).toBe("1:23.450");
    expect(formatShowTime(ms(400))).toBe("0:00.400");
    expect(formatShowTime(ms(60000))).toBe("1:00.000");
  });

  it("prints a negative time with a sign", () => {
    expect(formatShowTime(ms(-2400))).toBe("-0:02.400");
  });

  it("round trips", () => {
    const original = "3:07.125";
    expect(formatShowTime(parseShowTime(original)!)).toBe(original);
  });
});

describe("parseTimecode", () => {
  it("reads a non drop frame code", () => {
    expect(parseTimecode("00:01:23:11", SMPTE_25)).toEqual({
      hours: 0,
      minutes: 1,
      secs: 23,
      frames: 11,
    });
  });

  it("reads a drop frame code with a semicolon", () => {
    expect(parseTimecode("01:00:00;02", SMPTE_2997)?.frames).toBe(2);
  });

  it("refuses a semicolon on a non drop format", () => {
    expect(parseTimecode("00:01:23;11", SMPTE_25)).toBeUndefined();
  });

  it("refuses a frame number the rate cannot hold", () => {
    expect(parseTimecode("00:00:01:25", SMPTE_25)).toBeUndefined();
    expect(parseTimecode("00:00:01:24", SMPTE_25)?.frames).toBe(24);
    expect(parseTimecode("00:00:01:24", SMPTE_24)).toBeUndefined();
  });

  it("refuses malformed input", () => {
    expect(parseTimecode("nope", SMPTE_25)).toBeUndefined();
    expect(parseTimecode("00:99:00:00", SMPTE_25)).toBeUndefined();
  });
});

describe("formatTimecode", () => {
  it("pads every field", () => {
    const code = { hours: 1, minutes: 2, secs: 3, frames: 4 };
    expect(formatTimecode(code, SMPTE_25)).toBe("01:02:03:04");
  });

  it("uses a semicolon for drop frame", () => {
    const code = { hours: 0, minutes: 0, secs: 0, frames: 0 };
    expect(formatTimecode(code, SMPTE_2997)).toBe("00:00:00;00");
  });
});

describe("frame arithmetic", () => {
  it("counts frames from the start of the day", () => {
    const code = { hours: 0, minutes: 1, secs: 0, frames: 0 };
    expect(timecodeToFrames(code, SMPTE_25)).toBe(1500);
  });

  it("round trips a non drop code through frames", () => {
    const code = { hours: 2, minutes: 34, secs: 56, frames: 7 };
    const frames = timecodeToFrames(code, SMPTE_30);
    expect(framesToTimecode(frames, SMPTE_30)).toEqual(code);
  });

  it("skips the dropped frame numbers", () => {
    const atMinute = { hours: 0, minutes: 1, secs: 0, frames: 2 };
    expect(timecodeToFrames(atMinute, SMPTE_2997)).toBe(1800);
  });

  it("keeps the tenth minute whole", () => {
    const atTen = { hours: 0, minutes: 10, secs: 0, frames: 0 };
    expect(timecodeToFrames(atTen, SMPTE_2997)).toBe(17982);
  });

  it("round trips a drop frame code", () => {
    const code = { hours: 0, minutes: 13, secs: 12, frames: 9 };
    const frames = timecodeToFrames(code, SMPTE_2997);
    expect(framesToTimecode(frames, SMPTE_2997)).toEqual(code);
  });

  it("clamps a negative frame count", () => {
    expect(framesToTimecode(-30, SMPTE_25).frames).toBe(0);
  });
});

describe("milliseconds", () => {
  it("converts a code to milliseconds", () => {
    const code = { hours: 0, minutes: 0, secs: 10, frames: 0 };
    expect(raw(timecodeToMs(code, SMPTE_25))).toBe(10000);
  });

  it("keeps a drop frame hour within a few frames of wall time", () => {
    const code = { hours: 1, minutes: 0, secs: 0, frames: 0 };
    const millis = raw(timecodeToMs(code, SMPTE_2997));
    expect(Math.abs(millis - 3600000)).toBeLessThan(35);
  });

  it("shows what an hour of undropped frames would cost", () => {
    const code = { hours: 1, minutes: 0, secs: 0, frames: 0 };
    const dropped = timecodeToFrames(code, SMPTE_2997);
    const undropped = timecodeToFrames(code, SMPTE_30);
    expect(undropped - dropped).toBe(108);
  });

  it("round trips milliseconds through a code", () => {
    const value = ms(83440);
    expect(raw(timecodeToMs(msToTimecode(value, SMPTE_25), SMPTE_25))).toBe(
      83440,
    );
  });
});

describe("quantiseToFrame", () => {
  it("snaps to the nearest frame at 25", () => {
    expect(raw(quantiseToFrame(ms(83), SMPTE_25))).toBe(80);
    expect(raw(quantiseToFrame(ms(105), SMPTE_25))).toBe(120);
  });

  it("leaves a value already on a frame alone", () => {
    expect(raw(quantiseToFrame(ms(1000), SMPTE_30))).toBe(1000);
  });

  it("reports the frame length", () => {
    expect(raw(frameDuration(SMPTE_25))).toBe(40);
    expect(raw(frameDuration(SMPTE_24))).toBeCloseTo(41.6667, 3);
    expect(raw(frameDuration(SMPTE_2997))).toBeCloseTo(33.3667, 3);
  });
});
