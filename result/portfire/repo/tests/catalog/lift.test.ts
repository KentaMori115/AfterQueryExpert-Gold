import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import {
  IGNITION_DELAY,
  apogeeFor,
  leadTimeFor,
  liftProfile,
  muzzleVelocityFor,
  riseTimeFor,
  riseTimeToHeight,
  tabulatedSizes,
} from "../../src/catalog/lift.js";
import { metres, mm, raw } from "../../src/core/units.js";

const six = calibre(mm(150));
const three = calibre(mm(75));

describe("apogeeFor", () => {
  it("matches the table at a tabulated size", () => {
    expect(raw(apogeeFor(six))).toBe(180);
    expect(raw(apogeeFor(three))).toBe(90);
  });

  it("interpolates between table entries", () => {
    const apogee = raw(apogeeFor(calibre(mm(175))));
    expect(apogee).toBeGreaterThan(180);
    expect(apogee).toBeLessThan(240);
  });

  it("scales down below the smallest entry", () => {
    expect(raw(apogeeFor(calibre(mm(25))))).toBe(30);
  });

  it("stops climbing past the largest entry", () => {
    expect(raw(apogeeFor(calibre(mm(500))))).toBe(
      raw(apogeeFor(calibre(mm(400)))),
    );
  });

  it("rises with calibre all the way up", () => {
    const sizes = [50, 75, 100, 150, 200, 300];
    const heights = sizes.map((size) => raw(apogeeFor(calibre(mm(size)))));
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    }
  });
});

describe("riseTimeFor", () => {
  it("matches the table", () => {
    expect(raw(riseTimeFor(six))).toBe(4000);
    expect(raw(riseTimeFor(three))).toBe(2400);
  });

  it("interpolates", () => {
    const rise = raw(riseTimeFor(calibre(mm(175))));
    expect(rise).toBeGreaterThan(4000);
    expect(rise).toBeLessThan(4800);
  });

  it("gives a bigger shell a longer climb", () => {
    expect(raw(riseTimeFor(calibre(mm(300))))).toBeGreaterThan(
      raw(riseTimeFor(six)),
    );
  });
});

describe("riseTimeToHeight", () => {
  it("matches the full rise at full apogee", () => {
    expect(raw(riseTimeToHeight(six, apogeeFor(six)))).toBe(
      raw(riseTimeFor(six)),
    );
  });

  it("takes less time to a lower break", () => {
    const low = raw(riseTimeToHeight(six, metres(45)));
    expect(low).toBeLessThan(raw(riseTimeFor(six)));
    expect(low).toBe(2000);
  });

  it("clamps a height above apogee", () => {
    expect(raw(riseTimeToHeight(six, metres(900)))).toBe(raw(riseTimeFor(six)));
  });

  it("gives no flight time at ground level", () => {
    expect(raw(riseTimeToHeight(six, metres(0)))).toBe(0);
  });
});

describe("leadTimeFor", () => {
  it("adds the ignition delay to the rise", () => {
    expect(raw(leadTimeFor(six))).toBe(raw(riseTimeFor(six)) + 30);
  });

  it("uses the same delay for every calibre", () => {
    expect(raw(leadTimeFor(three)) - raw(riseTimeFor(three))).toBe(
      raw(IGNITION_DELAY),
    );
  });
});

describe("muzzleVelocityFor", () => {
  it("is in the range a mortar actually throws", () => {
    const speed = muzzleVelocityFor(six);
    expect(speed).toBeGreaterThan(60);
    expect(speed).toBeLessThan(120);
  });

  it("rises with calibre", () => {
    expect(muzzleVelocityFor(calibre(mm(300)))).toBeGreaterThan(
      muzzleVelocityFor(three),
    );
  });
});

describe("liftProfile", () => {
  it("collects the four numbers a cue needs", () => {
    const profile = liftProfile(six);
    expect(raw(profile.apogee)).toBe(180);
    expect(raw(profile.rise)).toBe(4000);
    expect(raw(profile.lead)).toBe(4030);
    expect(profile.muzzleVelocity).toBeCloseTo(90, 0);
  });
});

describe("tabulatedSizes", () => {
  it("lists the measured calibres in order", () => {
    const sizes = tabulatedSizes();
    expect(sizes[0]).toBe(50);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });
});
