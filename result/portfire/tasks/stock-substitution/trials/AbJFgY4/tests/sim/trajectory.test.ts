import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { apogeeFor } from "../../src/catalog/lift.js";
import {
  agreesWithTable,
  flightTime,
  heightAt,
  speedAt,
  timeToHeight,
  trajectoryFor,
} from "../../src/sim/trajectory.js";
import { metres, mm, ms, raw } from "../../src/core/units.js";

const six = calibre(mm(150));
const three = calibre(mm(75));

describe("trajectoryFor", () => {
  it("starts on the ground", () => {
    const trajectory = trajectoryFor(six);
    expect(raw(trajectory.points[0]!.height)).toBe(0);
  });

  it("reaches the apogee the lift table quotes", () => {
    const trajectory = trajectoryFor(six);
    expect(raw(trajectory.apogee)).toBeCloseTo(raw(apogeeFor(six)), -1);
  });

  it("agrees with the table across the range", () => {
    for (const size of [50, 75, 100, 150, 200, 250, 300]) {
      expect(agreesWithTable(calibre(mm(size)))).toBe(true);
    }
  });

  it("fits a drag term above zero", () => {
    expect(trajectoryFor(six).drag).toBeGreaterThan(0);
  });

  it("reaches the apogee at the time the table quotes", () => {
    const trajectory = trajectoryFor(six);
    expect(raw(trajectory.apogeeAt)).toBeCloseTo(4000, -2);
  });

  it("climbs then falls", () => {
    const trajectory = trajectoryFor(three);
    const top = raw(trajectory.apogeeAt);
    expect(raw(heightAt(trajectory, ms(top / 2)))).toBeLessThan(
      raw(trajectory.apogee),
    );
    expect(raw(heightAt(trajectory, ms(top + 2000)))).toBeLessThan(
      raw(trajectory.apogee),
    );
  });

  it("gets a bigger shell higher", () => {
    expect(raw(trajectoryFor(six).apogee)).toBeGreaterThan(
      raw(trajectoryFor(three).apogee),
    );
  });
});

describe("heightAt", () => {
  const trajectory = trajectoryFor(six);

  it("is zero at launch and before it", () => {
    expect(raw(heightAt(trajectory, ms(0)))).toBe(0);
    expect(raw(heightAt(trajectory, ms(-500)))).toBe(0);
  });

  it("interpolates between steps", () => {
    const low = raw(heightAt(trajectory, ms(1000)));
    const middle = raw(heightAt(trajectory, ms(1005)));
    const high = raw(heightAt(trajectory, ms(1010)));
    expect(middle).toBeGreaterThan(low);
    expect(middle).toBeLessThan(high);
  });

  it("rises monotonically up to the apogee", () => {
    let last = -1;
    for (let t = 0; t <= raw(trajectory.apogeeAt); t += 200) {
      const height = raw(heightAt(trajectory, ms(t)));
      expect(height).toBeGreaterThanOrEqual(last);
      last = height;
    }
  });

  it("holds the last point past the end of the curve", () => {
    expect(raw(heightAt(trajectory, ms(999999)))).toBeGreaterThanOrEqual(0);
  });
});

describe("speedAt", () => {
  const trajectory = trajectoryFor(six);

  it("leaves the mortar fast and upward", () => {
    expect(speedAt(trajectory, ms(0))).toBeGreaterThan(80);
  });

  it("is near zero at the apogee", () => {
    expect(Math.abs(speedAt(trajectory, trajectory.apogeeAt))).toBeLessThan(2);
  });

  it("is downward after the apogee", () => {
    expect(
      speedAt(trajectory, ms(raw(trajectory.apogeeAt) + 1000)),
    ).toBeLessThan(0);
  });

  it("gives zero past the end of the curve", () => {
    expect(speedAt(trajectory, ms(999999))).toBe(0);
  });
});

describe("timeToHeight", () => {
  const trajectory = trajectoryFor(six);

  it("finds when the shell passes a height on the way up", () => {
    const at = timeToHeight(trajectory, metres(90));
    expect(at).toBeDefined();
    expect(raw(at!)).toBeGreaterThan(0);
    expect(raw(at!)).toBeLessThan(raw(trajectory.apogeeAt));
  });

  it("finds nothing for a height it never reaches", () => {
    expect(timeToHeight(trajectory, metres(5000))).toBeUndefined();
  });

  it("finds zero for the ground", () => {
    expect(raw(timeToHeight(trajectory, metres(0))!)).toBe(0);
  });

  it("takes longer to reach a greater height", () => {
    const low = raw(timeToHeight(trajectory, metres(50))!);
    const high = raw(timeToHeight(trajectory, metres(150))!);
    expect(high).toBeGreaterThan(low);
  });
});

describe("flightTime", () => {
  it("runs well past the apogee", () => {
    const trajectory = trajectoryFor(six);
    expect(raw(flightTime(trajectory))).toBeGreaterThan(
      raw(trajectory.apogeeAt),
    );
  });
});
