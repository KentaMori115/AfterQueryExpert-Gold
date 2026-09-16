/**
 * What winding costs, and the chain the winder is one link of.
 *
 * The rope is a tenth of what a rope change costs and the colliery
 * standing is the other nine tenths, which is why a works will pay a
 * great deal for a rope that lasts longer and nothing at all for one
 * that is cheaper. And lengthening the shortest link of a chain is
 * worth nothing beyond the point where the second shortest binds.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  aDay,
  aDayDown,
  biggerDrumWorth,
  changeCost,
  changeEvery,
  describeCost,
  energyAYear,
  lines,
  menPerTonne,
  perTonne,
  powerAYear,
  powerPerTonne,
  prices,
  ropeCost,
  ropePerTonne,
  secondWorth,
} from "../src/costing/works.ts";
import {
  aDay as linkADay,
  afterManWinding,
  arrivalsAnHour,
  asLink,
  betweenArrivals,
  bunkerFor,
  chainOutput,
  closeBehind,
  describeChain,
  despatched,
  link,
  manWindingCosts,
  manWindingHours,
  shiftBunker,
  shiftsFor,
  shortest,
  spare,
  stockingDays,
  wagonsADay,
  wastedLengthening,
  wholeShifts,
  worthOfLengthening,
} from "../src/works/output.ts";
import { parseWinder } from "../src/winder/parse.ts";
import { outputPerDay, ropeWanted } from "../src/winder/index.ts";
import { WindingError } from "../src/errors.ts";

const one = parseWinder(readFileSync("examples/bolsover.winder", "utf8"));
const at = prices();

describe("the cost of winding", () => {
  it("comes to a shilling or two a tonne", () => {
    expect(perTonne(one, at)).toBeGreaterThan(10);
    expect(perTonne(one, at)).toBeLessThan(400);
  });

  it("adds its three lines to the whole", () => {
    const found = lines(one, at);
    expect((found.power ?? 0) + (found.rope ?? 0) + (found.men ?? 0)).toBeCloseTo(perTonne(one, at), 3);
  });

  it("makes the rope the smallest of the three", () => {
    const found = lines(one, at);
    expect(found.rope).toBeLessThan(found.power as number);
    expect(found.rope).toBeLessThan(found.men as number);
  });

  it("rises with every price it is given", () => {
    expect(powerPerTonne(one, prices({ power: 18 }))).toBeCloseTo(2 * powerPerTonne(one, at), 3);
    expect(menPerTonne(one, prices({ men: 1280 }))).toBeCloseTo(2 * menPerTonne(one, at), 3);
    expect(ropePerTonne(one, prices({ rope: 4800 }))).toBeGreaterThan(ropePerTonne(one, at));
  });

  it("refuses a price of nothing", () => {
    expect(() => prices({ power: 0 })).toThrow(WindingError);
  });
});

describe("the rope as a capital item", () => {
  it("makes the rope a small part of what changing one costs", () => {
    const whole = changeCost(one.rope, ropeWanted(one), at);
    expect(ropeCost(one.rope, ropeWanted(one), at) / whole).toBeLessThan(0.35);
  });

  it("changes it less often on a bigger drum", () => {
    expect(changeEvery(one, at)).toBeGreaterThan(100);
    expect(biggerDrumWorth(one, 0.1, at)).toBeGreaterThan(0);
    expect(biggerDrumWorth(one, 0.2, at)).toBeGreaterThan(biggerDrumWorth(one, 0.1, at));
  });

  it("makes a day down worth more than a day of winding", () => {
    expect(aDayDown(at)).toBeGreaterThan(aDay(one, at));
  });

  it("makes a second off the standing time worth a great deal a year", () => {
    expect(secondWorth(one, 8, at)).toBeGreaterThan(10_000);
    expect(secondWorth(one, 16, at)).toBeCloseTo(2 * secondWorth(one, 8, at), -1);
  });

  it("prices the electricity for a year", () => {
    expect(energyAYear(one, 300)).toBeGreaterThan(1e6);
    expect(powerAYear(one, at, 300)).toBeGreaterThan(1000);
    expect(describeCost(one, at)).toContain("a tonne");
  });
});

describe("the chain", () => {
  const chain = [
    asLink(one),
    link("faces", 420, 18),
    link("pit bottom", 500, 20),
    link("screens", 380, 20),
    link("rapid loader", 900, 8),
  ];

  it("passes what its shortest link passes", () => {
    expect(chainOutput(chain)).toBe(linkADay(shortest(chain)));
    for (const each of chain) expect(linkADay(each)).toBeGreaterThanOrEqual(chainOutput(chain));
  });

  it("compares on the day and not the hour", () => {
    // The rapid loader is the fastest link an hour and works eight
    // hours, so it is not the shortest link a day.
    expect(shortest(chain).name).not.toBe("rapid loader");
  });

  it("gives every link a spare over the shortest", () => {
    const found = spare(chain);
    expect(found[shortest(chain).name]).toBe(0);
    for (const value of Object.values(found)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it("stops paying for a longer shortest link at the second shortest", () => {
    const worth = worthOfLengthening(chain, 2);
    expect(worth).toBeGreaterThan(0);
    expect(wastedLengthening(chain, 2)).toBeGreaterThan(0.3);
    expect(wastedLengthening(chain, 0.05)).toBeLessThan(0.2);
  });

  it("counts the links close behind the shortest", () => {
    expect(closeBehind(chain, 1)).toBeGreaterThan(0);
    expect(closeBehind(chain, 0.001)).toBe(1);
  });

  it("refuses a chain with nothing in it", () => {
    expect(() => shortest([])).toThrow(WindingError);
  });

  it("describes itself in a line", () => {
    expect(describeChain(chain)).toContain("held by");
  });
});

describe("the bank and the men", () => {
  it("sizes a bunker on the cycle and a larger one on the shift change", () => {
    expect(bunkerFor(one)).toBeGreaterThan(0);
    expect(shiftBunker(one)).toBeGreaterThan(bunkerFor(one));
  });

  it("counts the arrivals and the gap between them", () => {
    expect(arrivalsAnHour(one)).toBeGreaterThan(10);
    expect(betweenArrivals(one)).toBeCloseTo(3600 / arrivalsAnHour(one), 2);
  });

  it("charges the coal day for winding the men", () => {
    expect(manWindingHours(one, 400, 39)).toBeGreaterThan(0.5);
    expect(manWindingCosts(one, 400, 39)).toBeGreaterThan(0);
    expect(afterManWinding(one, 400, 39)).toBeLessThan(outputPerDay(one));
  });

  it("refuses when winding the men takes the whole day", () => {
    expect(() => afterManWinding(one, 40_000, 39)).toThrow(WindingError);
  });

  it("counts the wagons and what a stocking ground holds", () => {
    expect(wagonsADay(5557)).toBe(Math.ceil(5557 / 21));
    expect(despatched(5557)).toBeLessThanOrEqual(5557 + 21);
    expect(stockingDays(20_000, 5557)).toBeGreaterThan(3);
  });

  it("counts the shifts a tonnage takes", () => {
    expect(shiftsFor(5557, one)).toBeGreaterThan(1);
    expect(wholeShifts(5557, one)).toBe(Math.ceil(shiftsFor(5557, one)));
  });
});
