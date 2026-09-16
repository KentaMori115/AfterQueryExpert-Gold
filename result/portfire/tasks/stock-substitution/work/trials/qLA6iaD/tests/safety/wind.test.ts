import { describe, expect, it } from "vitest";
import {
  CASING_DESCENT,
  CAUTION_SPEED,
  DUD_DESCENT,
  HOLD_SPEED,
  checkWind,
  compassName,
  describeWind,
  descentTime,
  driftDistance,
  driftedCentre,
  inflatedRadius,
  maxHeightFor,
  usableSpeed,
  windVerdict,
  wind,
} from "../../src/safety/wind.js";
import { point } from "../../src/safety/site.js";
import { metres, metresPerSecond, raw } from "../../src/core/units.js";

const breeze = wind(metresPerSecond(8), 90);

describe("wind", () => {
  it("normalises the direction into a compass bearing", () => {
    expect(wind(metresPerSecond(4), 450).towards).toBe(90);
    expect(wind(metresPerSecond(4), -90).towards).toBe(270);
  });

  it("refuses a direction that is not a number", () => {
    expect(() => wind(metresPerSecond(4), Number.NaN)).toThrow(/degrees/);
  });
});

describe("descent", () => {
  it("takes eighteen seconds to come down from a six inch break", () => {
    expect(raw(descentTime(metres(180))) / 1000).toBe(18);
  });

  it("brings a dud down much faster", () => {
    expect(raw(descentTime(metres(180), DUD_DESCENT))).toBeLessThan(
      raw(descentTime(metres(180), CASING_DESCENT)),
    );
  });

  it("refuses a descent rate of zero", () => {
    expect(() => descentTime(metres(10), metresPerSecond(0))).toThrow(
      /above zero/,
    );
  });
});

describe("drift", () => {
  it("moves debris further than most people expect", () => {
    expect(raw(driftDistance(metres(180), breeze))).toBe(144);
  });

  it("scales with wind speed and with height", () => {
    expect(raw(driftDistance(metres(180), wind(metresPerSecond(4), 90)))).toBe(
      72,
    );
    expect(raw(driftDistance(metres(90), breeze))).toBe(72);
  });

  it("moves nothing in still air", () => {
    expect(raw(driftDistance(metres(180), wind(metresPerSecond(0), 0)))).toBe(
      0,
    );
  });

  it("moves a dud less, because it is down sooner", () => {
    expect(raw(driftDistance(metres(180), breeze, DUD_DESCENT))).toBeLessThan(
      raw(driftDistance(metres(180), breeze)),
    );
  });
});

describe("driftedCentre", () => {
  it("moves east when the wind blows east", () => {
    const moved = driftedCentre(point(0, 0), metres(180), breeze);
    expect(moved.east).toBeCloseTo(144, 5);
    expect(moved.north).toBeCloseTo(0, 5);
  });

  it("moves north when the wind blows north", () => {
    const moved = driftedCentre(
      point(0, 0),
      metres(180),
      wind(metresPerSecond(8), 0),
    );
    expect(moved.north).toBeCloseTo(144, 5);
  });

  it("leaves the centre alone in still air", () => {
    const moved = driftedCentre(
      point(5, 7),
      metres(180),
      wind(metresPerSecond(0), 90),
    );
    expect(moved).toEqual({ east: 5, north: 7 });
  });
});

describe("inflatedRadius", () => {
  it("grows the disc by the drift", () => {
    expect(raw(inflatedRadius(metres(60), metres(180), breeze))).toBe(204);
  });
});

describe("verdicts", () => {
  it("is clear in a light breeze", () => {
    expect(windVerdict(wind(metresPerSecond(3), 0))).toBe("clear");
  });

  it("is caution in the band", () => {
    expect(windVerdict(wind(CAUTION_SPEED, 0))).toBe("caution");
  });

  it("holds at the hold speed", () => {
    expect(windVerdict(wind(HOLD_SPEED, 0))).toBe("hold");
    expect(windVerdict(wind(metresPerSecond(20), 0))).toBe("hold");
  });
});

describe("maxHeightFor", () => {
  it("says how high the crew can still break", () => {
    expect(raw(maxHeightFor(metres(100), breeze))).toBe(125);
  });

  it("allows anything in still air", () => {
    expect(raw(maxHeightFor(metres(100), wind(metresPerSecond(0), 0)))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe("checkWind", () => {
  it("stops the show over the hold speed", () => {
    const diagnostics = checkWind(wind(metresPerSecond(15), 90), {
      allowance: metres(200),
      worstHeight: metres(180),
    });
    expect(diagnostics.byCode("PF4000")).toHaveLength(1);
    expect(diagnostics.size).toBe(1);
  });

  it("warns inside the caution band", () => {
    const diagnostics = checkWind(wind(metresPerSecond(10), 90), {
      allowance: metres(400),
      worstHeight: metres(180),
    });
    expect(diagnostics.byCode("PF4001")).toHaveLength(1);
  });

  it("errors when the drift is past the room available", () => {
    const diagnostics = checkWind(breeze, {
      allowance: metres(100),
      worstHeight: metres(180),
    });
    expect(diagnostics.byCode("PF4002")[0]?.help).toContain("upwind");
  });

  it("warns when the drift is close to the room available", () => {
    const diagnostics = checkWind(breeze, {
      allowance: metres(180),
      worstHeight: metres(180),
    });
    expect(diagnostics.byCode("PF4003")).toHaveLength(1);
  });

  it("says nothing on a still evening with room to spare", () => {
    const diagnostics = checkWind(wind(metresPerSecond(2), 90), {
      allowance: metres(400),
      worstHeight: metres(180),
    });
    expect(diagnostics.size).toBe(0);
  });
});

describe("reporting", () => {
  it("names the compass point", () => {
    expect(compassName(0)).toBe("north");
    expect(compassName(90)).toBe("east");
    expect(compassName(225)).toBe("south west");
    expect(compassName(359)).toBe("north");
  });

  it("reads as one line", () => {
    expect(describeWind(breeze)).toBe("8.0m/s towards the east, clear");
  });

  it("clamps a nonsense gust reading", () => {
    expect(raw(usableSpeed(-4))).toBe(0);
    expect(raw(usableSpeed(400))).toBe(60);
  });
});
