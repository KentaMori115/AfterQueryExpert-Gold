/**
 * What the colliery asks the fan for, and how little of it arrives
 * where it was sent.
 *
 * The duty is the largest of three separate demands and the one that
 * decides it changes as a pit ages. What happens to the air after that
 * is a matter of square roots: it takes the easy road, so the short
 * level beside the shaft takes far more than its share and the far face
 * takes almost none, and nearly all of a ventilation plan is stopping
 * air going where it wants to go.
 */

import { describe, expect, it } from "vitest";
import {
  FRICTION,
  decidedBy,
  deepestVentilated,
  characteristic,
  fan,
  inSeries,
  operatingPoint,
  pressureFor,
  regulatorFor,
  resistance,
  shaftAirway,
  splitBetween,
  wanted,
} from "../src/air/index.ts";
import * as sheave from "../src/index.ts";
import { BRISK_AIR, airSpeed, comfortable, freeArea, shaft } from "../src/shaft/shaft.ts";
import { commandNamed, commands, run } from "../src/cli/main.ts";
import { WindingError } from "../src/errors.ts";

const downcast = shaft("No.2 Downcast", 7.3, 942, 2, 15, 42);

/** The quantity a refusal names, or the empty string if it did not refuse. */
function refusedOver(fn: () => unknown): string {
  try {
    fn();
  } catch (thrown) {
    return thrown instanceof WindingError ? thrown.quantity : "not a WindingError";
  }
  return "";
}

/** What the library says an installation of that description settles at. */
function settles(
  diameter: number,
  depth: number,
  width: number,
  across = 1.5,
  shutoff = 3500,
  delivery = 400,
  workings = 0.03,
): number {
  const one = shaft("the downcast", diameter, depth, 2);
  const circuit = inSeries([resistance(shaftAirway(one, width, across, 1.2, FRICTION)), workings]);
  return operatingPoint(fan("the fan", shutoff, delivery, 0.7), circuit).quantity;
}

/** Every number the command printed, however it chose to round them. */
function numbersIn(lines: readonly string[]): number[] {
  const found = lines.join(" ").match(/[0-9][0-9,]*(?:\.[0-9]+)?/g) ?? [];
  return found.map((each) => Number(each.replace(/,/g, "")));
}

/** Whether the report carried that figure, however it rounded it. */
function reported(lines: readonly string[], wants: number): boolean {
  return numbersIn(lines).some((each) => Math.abs(each - wants) <= 0.55);
}

/** The command run over one installation, with nothing left to a default. */
function reportOn(
  diameter: string,
  depth: string,
  width: string,
  across = "1.5m",
  shutoff = "3500",
  delivery = "400",
  workings = "0.03",
): { lines: string[]; code: number } {
  return run([
    "ventilation",
    "--diameter", diameter, "--depth", depth, "--width", width, "--across", across,
    "--shutoff", shutoff, "--delivery", delivery, "--workings", workings,
  ]);
}
const blowing = fan("the fan", 3500, 400, 0.7);

describe("what the colliery asks for", () => {
  it("names the argument a refusal was over", () => {
    expect(refusedOver(() => wanted(12.5, 0, 0))).toBe("men");
    expect(refusedOver(() => wanted(0, -1, 0))).toBe("tonnes");
    expect(refusedOver(() => wanted(0, 0, -1))).toBe("gas");
    expect(refusedOver(() => wanted(900, 3000, 1.5, 0))).toBe("limit");
  });

  it("wants a tenth of a cubic metre a second for every man underground", () => {
    expect(wanted(2000, 0, 0)).toBeCloseTo(200, 3);
    expect(wanted(0, 0, 0)).toBe(0);
    expect(() => wanted(12.5, 0, 0)).toThrow(WindingError);
    expect(() => wanted(-40, 0, 0)).toThrow(WindingError);
  });

  it("wants a twentieth of one for every tonne they send out in a day", () => {
    expect(wanted(0, 3000, 0)).toBeCloseTo(150, 3);
    expect(wanted(0, 6000, 0)).toBeCloseTo(300, 3);
    expect(() => wanted(0, -1, 0)).toThrow(WindingError);
  });

  it("dilutes the gas to the share the law allows and no more", () => {
    expect(wanted(0, 0, 1.5)).toBeCloseTo(1.5 / 0.0125, 2);
    expect(wanted(0, 0, 1.5, 0.02)).toBeCloseTo(1.5 / 0.02, 2);
    expect(() => wanted(0, 0, -1.5)).toThrow(WindingError);
  });

  it("refuses a gas limit that is not a share above nought", () => {
    expect(() => wanted(900, 3000, 1.5, 0)).toThrow(WindingError);
    expect(() => wanted(900, 3000, 1.5, 1.4)).toThrow(WindingError);
  });

  it("asks for the largest of the three and not for their sum", () => {
    const most = wanted(900, 3000, 1.5);
    expect(most).toBeCloseTo(Math.max(90, 150, 1.5 / 0.0125), 3);
    expect(most).toBeLessThan(90 + 150 + 1.5 / 0.0125);
  });

  it("says which of the three is the one asking", () => {
    expect(decidedBy(2000, 500, 0.1)).toBe("men");
    expect(decidedBy(200, 3000, 0.1)).toBe("coal");
    expect(decidedBy(200, 500, 3)).toBe("gas");
  });

  it("changes its answer with the gas and not with anything else about the pit", () => {
    expect(decidedBy(900, 3000, 1)).toBe("coal");
    expect(decidedBy(900, 3000, 3)).toBe("gas");
  });

});


describe("the air split between districts", () => {
  it("gives every road the same pressure and not the same quantity", () => {
    const shares = splitBetween(240, [0.02, 0.08]);
    expect(pressureFor(0.02, shares[0] as number)).toBeCloseTo(pressureFor(0.08, shares[1] as number), 0);
    expect(shares[0] as number).toBeGreaterThan(shares[1] as number);
  });

  it("shares out the whole of what was sent down", () => {
    const shares = splitBetween(240, [0.02, 0.05, 0.09]);
    expect(shares.reduce((sum, each) => sum + each, 0)).toBeCloseTo(240, 1);
  });

  it("gives two equal roads half each", () => {
    const shares = splitBetween(300, [0.04, 0.04]);
    expect(shares[0] as number).toBeCloseTo(150, 2);
    expect(shares[1] as number).toBeCloseTo(150, 2);
  });

  it("divides by the roots, so four times the resistance takes half the air", () => {
    const shares = splitBetween(300, [0.02, 0.08]);
    expect((shares[0] as number) / (shares[1] as number)).toBeCloseTo(2, 3);
  });

});

describe("the regulator", () => {
  it("adds whatever holds the road to the quantity it is meant to have", () => {
    const pressure = 900;
    const branch = 0.01;
    const added = regulatorFor(pressure, 200, branch);
    expect(pressureFor(branch + added, 200)).toBeCloseTo(pressure, 2);
  });

  it("comes out negative on a road that is already too tight for its share", () => {
    expect(regulatorFor(900, 200, 0.05)).toBeLessThan(0);
    expect(regulatorFor(900, 200, 0.01)).toBeGreaterThan(0);
  });

  it("wants nothing at all from the road that is exactly right", () => {
    const branch = 900 / (200 * 200);
    expect(regulatorFor(900, 200, branch)).toBeCloseTo(0, 6);
    expect(regulatorFor(1800, 200, branch)).toBeGreaterThan(0);
  });

  it("refuses a pressure, a quantity or a road that is not above nought, and says which", () => {
    expect(() => regulatorFor(0, 200, 0.01)).toThrow(WindingError);
    expect(refusedOver(() => regulatorFor(0, 200, 0.01))).toBe("pressure");
    expect(refusedOver(() => regulatorFor(900, 0, 0.01))).toBe("wanted");
    expect(refusedOver(() => regulatorFor(900, 200, 0))).toBe("branch");
  });
});

describe("the depth a fan will carry", () => {
  const section = freeArea(downcast, 2.2);
  const perimeter = Math.PI * 7.3;

  it("stops where the crossing falls exactly on the quantity wanted", () => {
    const deepest = deepestVentilated(blowing, 12, 14, 200, 0.02, FRICTION);
    const aMetre = (FRICTION * 14) / (12 * 12 * 12);
    expect(operatingPoint(blowing, 0.02 + aMetre * deepest).quantity).toBeGreaterThanOrEqual(200);
    expect(operatingPoint(blowing, 0.02 + aMetre * (deepest + 50)).quantity).toBeLessThan(200);
  });

  it("goes deeper for a wider shaft, because the section comes in cubed", () => {
    const narrow = deepestVentilated(blowing, 10, 14, 200, 0.02, FRICTION);
    const wide = deepestVentilated(blowing, 14, 14, 200, 0.02, FRICTION);
    expect(wide).toBeGreaterThan(narrow);
  });

  it("never answers deeper than the deepest shaft this library will take", () => {
    expect(deepestVentilated(blowing, section, perimeter, 150, 0.03, FRICTION)).toBe(4200);
    expect(deepestVentilated(blowing, section, perimeter, 120, 0.02, FRICTION)).toBe(4200);
  });

});

describe("a colliery end to end", () => {
  it("puts a shaft, its workings and a fan together and gets a working point", () => {
    const down = shaftAirway(downcast, 2.2, 1.5, 1.2, FRICTION);
    const circuit = inSeries([resistance(down), 0.03]);
    const at = operatingPoint(blowing, circuit);
    expect(at.quantity).toBeGreaterThan(wanted(900, 3000, 1.5));
    expect(at.pressure).toBeCloseTo(pressureFor(circuit, at.quantity), 1);
    expect(airSpeed(downcast, at.quantity, 2.2)).toBeLessThan(BRISK_AIR);
  });

  it("is beaten by the same shaft once the gas has trebled", () => {
    const down = shaftAirway(downcast, 2.2, 1.5, 1.2, FRICTION);
    const circuit = inSeries([resistance(down), 0.03]);
    expect(operatingPoint(blowing, circuit).quantity).toBeLessThan(wanted(900, 3000, 4.5));
    expect(wanted(900, 3000, 4.5)).toBeGreaterThan(wanted(900, 3000, 1.5));
  });
});

describe("how the ventilation is wired into the rest of it", () => {
  it("is a namespace on the library the same as the others", () => {
    expect(typeof sheave.air.resistance).toBe("function");
    expect(typeof sheave.air.operatingPoint).toBe("function");
    expect(typeof sheave.air.wanted).toBe("function");
  });

  it("has a command of its own, and the command line knows it", () => {
    expect(commandNamed("ventilation").says.length).toBeGreaterThan(20);
    expect(commands().some((each) => each.name === "ventilation")).toBe(true);
  });

  it("runs that command and reports on the shaft it is given", () => {
    const found = run(["ventilation"]);
    expect(found.code).toBe(0);
    expect(found.lines.length).toBeGreaterThan(5);
  });

  it("names the one of the three that is asking, and changes its mind with the pit", () => {
    const gassy = run(["ventilation", "--men", "200", "--tonnes", "500", "--gas", "3"]);
    const coaly = run(["ventilation", "--men", "200", "--tonnes", "6000", "--gas", "0.1"]);
    const crowded = run(["ventilation", "--men", "4000", "--tonnes", "100", "--gas", "0.1"]);
    expect(gassy.lines.join(" ")).toContain(decidedBy(200, 500, 3));
    expect(coaly.lines.join(" ")).toContain(decidedBy(200, 6000, 0.1));
    expect(crowded.lines.join(" ")).toContain(decidedBy(4000, 100, 0.1));
  });

  it("reports the working point the library gives for the shaft it was handed", () => {
    const found = reportOn("7.3m", "942m", "2.2m");
    expect(found.code).toBe(0);
    expect(reported(found.lines, settles(7.3, 942, 2.2))).toBe(true);
  });

  it("gets less air down a deeper shaft, because the resistance grows with it", () => {
    const shallow = reportOn("7.3m", "600m", "2.2m");
    const deep = reportOn("7.3m", "1400m", "2.2m");
    expect((settles(7.3, 1400, 2.2))).toBeLessThan((settles(7.3, 600, 2.2)));
    expect(reported(shallow.lines, settles(7.3, 600, 2.2))).toBe(true);
    expect(reported(deep.lines, settles(7.3, 1400, 2.2))).toBe(true);
  });

  it("gets more air down a wider shaft, and reports that too", () => {
    const narrow = reportOn("6m", "942m", "2.2m");
    const wide = reportOn("7.3m", "942m", "2.2m");
    expect((settles(6, 942, 2.2))).toBeLessThan((settles(7.3, 942, 2.2)));
    expect(reported(narrow.lines, settles(6, 942, 2.2))).toBe(true);
    expect(reported(wide.lines, settles(7.3, 942, 2.2))).toBe(true);
  });

  it("loses air to a conveyance that hangs deeper in the shaft", () => {
    const deeper = reportOn("7.3m", "942m", "2.2m", "2.4m");
    expect((settles(7.3, 942, 2.2, 2.4))).toBeLessThan((settles(7.3, 942, 2.2)));
    expect(reported(deeper.lines, settles(7.3, 942, 2.2, 2.4))).toBe(true);
  });

  it("works to the fan it is given rather than to one of its own", () => {
    const stronger = reportOn("7.3m", "942m", "2.2m", "1.5m", "6000");
    const bigger = reportOn("7.3m", "942m", "2.2m", "1.5m", "3500", "600");
    expect((settles(7.3, 942, 2.2, 1.5, 6000))).toBeGreaterThan((settles(7.3, 942, 2.2)));
    expect((settles(7.3, 942, 2.2, 1.5, 3500, 600))).toBeGreaterThan((settles(7.3, 942, 2.2)));
    expect(reported(stronger.lines, settles(7.3, 942, 2.2, 1.5, 6000))).toBe(true);
    expect(reported(bigger.lines, settles(7.3, 942, 2.2, 1.5, 3500, 600))).toBe(true);
  });

  it("puts the workings it is told about behind the shaft", () => {
    const slack = reportOn("7.3m", "942m", "2.2m", "1.5m", "3500", "400", "0.01");
    const tight = reportOn("7.3m", "942m", "2.2m", "1.5m", "3500", "400", "0.08");
    expect((settles(7.3, 942, 2.2, 1.5, 3500, 400, 0.08))).toBeLessThan(
      (settles(7.3, 942, 2.2, 1.5, 3500, 400, 0.01)),
    );
    expect(reported(slack.lines, settles(7.3, 942, 2.2, 1.5, 3500, 400, 0.01))).toBe(true);
    expect(reported(tight.lines, settles(7.3, 942, 2.2, 1.5, 3500, 400, 0.08))).toBe(true);
  });

  it("reports a different working point for a shaft with less room in it", () => {
    const roomy = reportOn("7.3m", "942m", "2.2m");
    const tight = reportOn("7.3m", "942m", "2.8m");
    expect((settles(7.3, 942, 2.8))).toBeLessThan((settles(7.3, 942, 2.2)));
    expect(tight.lines.join("\n")).not.toBe(roomy.lines.join("\n"));
  });

  it("refuses a shaft the conveyances leave no air in at all", () => {
    const found = run(["ventilation", "--diameter", "3.4m", "--width", "3m"]);
    expect(found.code).toBe(1);
    expect(found.lines.length).toBeGreaterThan(0);
  });

  it("refuses an option that command does not take, the way the others do", () => {
    const found = run(["ventilation", "--dimeter", "7.3m"]);
    expect(found.code).toBe(1);
    expect(found.lines[0]).toContain("dimeter");
  });
});

describe("the figures the duty is worked from", () => {
  it("keeps them where a colliery can argue with them", () => {
    expect(wanted(1, 0, 0)).toBeCloseTo(0.1, 6);
    expect(wanted(0, 1, 0)).toBeCloseTo(0.05, 6);
    expect(wanted(0, 100, 0)).toBeLessThan(wanted(100, 0, 0));
  });

  it("takes a gas limit from the caller as well as from the law", () => {
    expect(wanted(200, 500, 1, 0.02)).toBeCloseTo(1 / 0.02, 3);
    expect(wanted(200, 500, 1, 0.02)).toBeLessThan(wanted(200, 500, 1));
    expect(decidedBy(200, 500, 1, 0.05)).not.toBe("gas");
  });

  it("gives a pit with nobody in it and nothing coming out of it the gas figure", () => {
    expect(wanted(0, 0, 0.5)).toBeCloseTo(0.5 / 0.0125, 3);
    expect(decidedBy(0, 0, 0.5)).toBe("gas");
  });
});

describe("three districts on one fan", () => {
  const districts = [0.02, 0.05, 0.09];
  const shares = splitBetween(300, districts);

  it("sends most of it down the short level and least to the far face", () => {
    expect(shares[0] as number).toBeGreaterThan(shares[1] as number);
    expect(shares[1] as number).toBeGreaterThan(shares[2] as number);
  });

  it("carries one pressure across all three of them", () => {
    const first = pressureFor(districts[0] as number, shares[0] as number);
    expect(pressureFor(districts[1] as number, shares[1] as number)).toBeCloseTo(first, 0);
    expect(pressureFor(districts[2] as number, shares[2] as number)).toBeCloseTo(first, 0);
  });

  it("wants a door on every road but the tightest one", () => {
    const pressure = pressureFor(districts[2] as number, 100);
    expect(regulatorFor(pressure, 100, districts[2] as number)).toBeCloseTo(0, 6);
    expect(regulatorFor(pressure, 100, districts[0] as number)).toBeGreaterThan(0);
    expect(regulatorFor(pressure, 100, districts[0] as number)).toBeGreaterThan(
      regulatorFor(pressure, 100, districts[1] as number),
    );
  });

  it("passes exactly the wanted quantity down each of them once the doors are on", () => {
    const pressure = pressureFor(districts[2] as number, 100);
    for (const each of districts) {
      const added = Math.max(0, regulatorFor(pressure, 100, each));
      expect(pressureFor(each + added, 100)).toBeCloseTo(pressure, 1);
    }
  });

  it("leaves one road alone when there is only one road", () => {
    expect(splitBetween(240, [0.04])).toEqual([240]);
  });
});


describe("the depth, worked from the section it is given", () => {
  it("works the depth from the friction it is given", () => {
    const aMetre = (FRICTION * 14) / (12 * 12 * 12);
    const stiffest = characteristic(blowing, 200) / (200 * 200);
    const deepest = deepestVentilated(blowing, 12, 14, 200, 0.02, FRICTION);
    expect(deepest).toBeCloseTo(Math.floor((stiffest - 0.02) / aMetre), 0);
  });

  it("is shallower for a rougher shaft of the same section", () => {
    expect(deepestVentilated(blowing, 12, 14, 200, 0.02, 0.012)).toBeLessThan(
      deepestVentilated(blowing, 12, 14, 200, 0.02, FRICTION),
    );
  });

  it("is shallower again for a colliery asking for more air", () => {
    expect(deepestVentilated(blowing, 12, 14, 260, 0.02, FRICTION)).toBeLessThan(
      deepestVentilated(blowing, 12, 14, 200, 0.02, FRICTION),
    );
  });

  it("answers a whole number of metres", () => {
    const deepest = deepestVentilated(blowing, 12, 14, 200, 0.02, FRICTION);
    expect(Number.isInteger(deepest)).toBe(true);
  });

  it("names the argument a refusal was over", () => {
    expect(refusedOver(() => deepestVentilated(blowing, 0, 14, 200, 0.02, FRICTION))).toBe("section");
    expect(refusedOver(() => deepestVentilated(blowing, 12, 0, 200, 0.02, FRICTION))).toBe("perimeter");
    expect(refusedOver(() => deepestVentilated(blowing, 12, 14, 0, 0.02, FRICTION))).toBe("wanted");
    expect(refusedOver(() => deepestVentilated(blowing, 12, 14, 200, -0.02, FRICTION))).toBe("workings");
    expect(refusedOver(() => deepestVentilated(blowing, 12, 14, 200, 0.02, 0))).toBe("friction");
  });

  it("refuses a section, a perimeter or a workings that is not a number it can use", () => {
    expect(() => deepestVentilated(blowing, 12, 0, 200, 0.02, FRICTION)).toThrow(WindingError);
    expect(() => deepestVentilated(blowing, 12, 14, 200, -0.02, FRICTION)).toThrow(WindingError);
    expect(() => deepestVentilated(blowing, 12, 14, 0, 0.02, FRICTION)).toThrow(WindingError);
  });
});
