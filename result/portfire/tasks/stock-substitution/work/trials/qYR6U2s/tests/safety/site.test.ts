import { describe, expect, it } from "vitest";
import {
  boundary,
  clearances,
  distanceToAudience,
  distanceToBoundary,
  distanceToSegment,
  falloutClears,
  point,
  positionPoint,
  site,
  straightLine,
  tightestClearance,
} from "../../src/safety/site.js";
import { positionId } from "../../src/core/ids.js";
import { metres, raw } from "../../src/core/units.js";
import { firingPosition } from "../../src/rig/rig.js";

const audience = straightLine(
  "spectator line",
  point(-200, -130),
  point(200, -130),
);
const river = boundary(
  "river",
  [point(-200, 90), point(0, 110), point(200, 90)],
  true,
);
const field = site("water meadow", audience, [river]);

const padA = firingPosition(positionId("pad.a"), 0, 0);
const padB = firingPosition(positionId("pad.b"), 0, 60);

describe("point and boundary", () => {
  it("refuses a coordinate that is not finite", () => {
    expect(() => point(Number.NaN, 0)).toThrow(/finite/);
  });

  it("refuses a boundary with one point", () => {
    expect(() => boundary("edge", [point(0, 0)])).toThrow(/two points/);
  });

  it("marks a hard boundary", () => {
    expect(river.hard).toBe(true);
    expect(audience.hard).toBe(false);
  });
});

describe("distanceToSegment", () => {
  it("measures the perpendicular where it lands on the segment", () => {
    expect(distanceToSegment(point(0, 0), point(-10, 5), point(10, 5))).toBe(5);
  });

  it("measures to an endpoint where the perpendicular misses", () => {
    expect(distanceToSegment(point(20, 0), point(-10, 0), point(10, 0))).toBe(
      10,
    );
  });

  it("handles a segment of no length", () => {
    expect(distanceToSegment(point(3, 4), point(0, 0), point(0, 0))).toBe(5);
  });

  it("is zero on the segment itself", () => {
    expect(distanceToSegment(point(0, 0), point(-1, 0), point(1, 0))).toBe(0);
  });
});

describe("distanceToBoundary", () => {
  it("measures square onto a slanted segment, not to its nearest corner", () => {
    // The river runs up from (-200, 90) to (0, 110), so the perpendicular
    // from the origin lands short of the 110 the corner alone would suggest.
    expect(raw(distanceToBoundary(point(0, 0), river))).toBeCloseTo(109.45, 1);
  });

  it("measures a straight line", () => {
    expect(raw(distanceToBoundary(point(0, 0), audience))).toBe(130);
  });

  it("measures from a point past the end of the line", () => {
    expect(raw(distanceToBoundary(point(400, -130), audience))).toBe(200);
  });
});

describe("positions", () => {
  it("reads a position as a point", () => {
    expect(positionPoint(padB)).toEqual({ east: 0, north: 60 });
  });

  it("measures a position to the audience", () => {
    expect(raw(distanceToAudience(padA, field))).toBe(130);
    expect(raw(distanceToAudience(padB, field))).toBe(190);
  });
});

describe("clearances", () => {
  it("lists every boundary closest first", () => {
    const list = clearances(padA, field);
    expect(list[0]?.boundary).toBe("river");
    expect(list[1]?.boundary).toBe("spectator line");
    expect(list).toHaveLength(2);
  });

  it("marks which are hard", () => {
    const list = clearances(padB, field);
    expect(list.find((entry) => entry.boundary === "river")?.hard).toBe(true);
  });

  it("finds the tightest clearance on the whole site", () => {
    const tightest = tightestClearance([padA, padB], field);
    expect(tightest?.position).toBe("pad.b");
    expect(tightest?.clearance.boundary).toBe("river");
    expect(raw(tightest?.clearance.distance ?? metres(0))).toBeLessThan(60);
  });

  it("finds nothing when there are no positions", () => {
    expect(tightestClearance([], field)).toBeUndefined();
  });
});

describe("falloutClears", () => {
  it("names a hard boundary the fallout would cross", () => {
    expect(falloutClears(padB, field, metres(80))).toEqual(["river"]);
  });

  it("names nothing when the disc stays inside", () => {
    expect(falloutClears(padB, field, metres(20))).toEqual([]);
  });

  it("ignores the spectator line, which the separation rule covers", () => {
    expect(falloutClears(padA, field, metres(300))).toEqual(["river"]);
  });
});
