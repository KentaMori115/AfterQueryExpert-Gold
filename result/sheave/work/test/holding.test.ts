/**
 * What a brake is worth standing still.
 *
 * A winding installation is signed off on two brake figures and this is
 * the first of them: with the wind stopped and the engineman gone for
 * his tea, will the shoes hold the load where it is? The answer is not
 * the ordinary out-of-balance but the worst one anywhere in the wind,
 * three times over, and on a friction winder it is not the shoes at all
 * once the ropes have had their say.
 *
 * The fixtures are three installations that fail in different places: a
 * deep skip winder with a balance rope, whose brake holds by a whisker;
 * a shallow cage winder with no balance rope and shoes that were sized
 * for the payload rather than for the rope; and a four-rope friction
 * winder whose springs are far harder than anything the wheel will
 * pass, which is the case where the shoes stop being the answer.
 */

import { describe, expect, it } from "vitest";
import {
  brakeOf,
  forceFor,
  gripPull,
  heldPull,
  holds,
  pressure,
  torque,
} from "../src/safety/index.ts";
import { type Winder, dutyOf, parseWinder } from "../src/winder/index.ts";
import {
  atEnd,
  atStart,
  leastOutOfBalance,
  mostOutOfBalance,
  worstOutOfBalance,
} from "../src/power/index.ts";
import { tensions, workingRatio } from "../src/drum/koepe.ts";
import { gross } from "../src/cage/index.ts";
import { weightOf } from "../src/units/index.ts";
import { WindingError } from "../src/errors.ts";

/** A deep skip winder with a balance rope, and a brake that just holds it. */
const deep = `
winder Thoresby No.1
shaft North diameter=7.3m depth=900m conveyances=2 sump=15m headgear=42m
rope diameter=52mm construction=6x36 grade=1960 ropes=1
drum diameter=4.2m width=2.4m layers=2 lead=46m
rising skip loaded tare=5.04t payload=12t decks=1 width=2.2m across=1.8m
falling skip empty tare=5.04t payload=0t decks=1 width=2.2m across=1.8m
balance rate=9.94kg
cycle full=15mps accelerate=1 decelerate=1.1 creep=0.5mps creepfor=6m rest=25s
brake diameter=3.6m width=0.25m arc=60 shoes=4 friction=0.35 force=300kn
`;

/** A shallow cage winder with no balance rope and a brake too small for it. */
const shallow = `
winder Wheal Betsy
shaft Engine diameter=4.9m depth=380m conveyances=2 sump=4m headgear=24m
rope diameter=32mm construction=6x19 grade=1770 ropes=1
drum diameter=2.1m width=1.4m layers=1 lead=18m
rising cage full tare=6t payload=3t decks=2 width=1.9m across=1.2m
falling cage empty tare=6t payload=0t decks=2 width=1.9m across=1.2m
cycle full=9mps accelerate=0.9 decelerate=1 creep=0.5mps creepfor=6m rest=30s
brake diameter=2.4m width=0.2m arc=45 shoes=2 friction=0.35 force=90kn
`;

/** A four-rope friction winder whose shoes are far harder than its ropes grip. */
const wheel = `
winder Zollverein XII
shaft Schacht diameter=7.5m depth=1100m conveyances=2 sump=20m headgear=45m
rope diameter=42mm construction=locked grade=1770 ropes=4
koepe diameter=5.6m wrap=195 friction=0.25 ropes=4
rising skip full tare=8t payload=20t decks=1 width=2.4m across=2m
falling skip empty tare=8t payload=0t decks=1 width=2.4m across=2m
balance rate=32kg
cycle full=16mps accelerate=1.2 decelerate=1.2 creep=0.5mps creepfor=8m rest=20s
brake diameter=4.6m width=0.3m arc=70 shoes=6 friction=0.4 force=700kn
`;

/** What the shoes alone are worth at the rope, which the drive decides. */
function shoesPull(of: Winder): number {
  return torque(brakeOf(of)) / dutyOf(of).radius;
}

/** The same sheet with one figure on its brake line written differently. */
function sheet(text: string, key: string, value: string): string {
  return text.replace(new RegExp(`(^brake .*?\\b${key}=)\\S+`, "m"), `$1${value}`);
}

/** And the same sheet with its whole brake line taken from another. */
function shoesOf(text: string, from: string): string {
  const line = from.split("\n").find((each) => each.startsWith("brake ")) as string;
  return text.replace(/^brake .*$/m, line);
}

const deepWinder = parseWinder(deep);
const shallowWinder = parseWinder(shallow);
const soundWinder = parseWinder(sheet(shallow, "shoes", "4"));
const wheelWinder = parseWinder(wheel);
const wheelWeakWinder = parseWinder(sheet(wheel, "force", "100kn"));
const bareWinder = parseWinder(deep.split("\n").filter((each) => !each.startsWith("balance ")).join("\n"));

describe("the brake as a machine", () => {
  it("takes its torque off the shoes and nothing else", () => {
    // Friction times the applied force is one shoe's drag, every shoe
    // drags at the same radius, so the shoes multiply and nothing else.
    expect(torque(brakeOf(deepWinder))).toBeCloseTo(0.35 * 300 * 4 * 1.8, 3);
    expect(torque(brakeOf(shallowWinder))).toBeCloseTo(0.35 * 90 * 2 * 1.2, 3);
  });

  it("refers that torque to the rope over the winding radius", () => {
    // A drum winder is held by its shoes and nothing else, so what it
    // holds is the torque over the radius the rope comes off at.
    expect(heldPull(deepWinder)).toBeCloseTo(756 / 2.1, 3);
    expect(heldPull(shallowWinder)).toBeCloseTo(torque(brakeOf(shallowWinder)) / 1.05, 3);
  });

  it("brakes a large drum worse than a small one with the same shoes", () => {
    const small = parseWinder(shoesOf(shallow, deep));
    expect(heldPull(small)).toBeGreaterThan(heldPull(deepWinder));
    expect(heldPull(small) / heldPull(deepWinder)).toBeCloseTo(
      dutyOf(deepWinder).radius / dutyOf(small).radius,
      3,
    );
  });

  it("refers it to the wheel radius on a friction winder", () => {
    // A koepe wheel is the drive as much as a drum is, and the shoes on
    // it are worth what the wheel's own radius makes of them.
    expect(torque(brakeOf(wheelWinder))).toBeCloseTo(0.4 * 700 * 6 * 2.3, 3);
    expect(dutyOf(wheelWinder).radius).toBeCloseTo(2.8, 6);
    expect(heldPull(wheelWeakWinder)).toBeCloseTo(shoesPull(wheelWeakWinder), 3);
  });

  it("presses a shoe over the strip of path it covers", () => {
    const swept = Math.PI * 3.6 * (60 / 360) * 0.25;
    expect(pressure(brakeOf(deepWinder))).toBeCloseTo(300 / (swept * 1000), 3);
    expect(pressure(brakeOf(shallowWinder))).toBeCloseTo(90 / (Math.PI * 2.4 * (45 / 360) * 0.2 * 1000), 3);
  });

  it("presses more gently the more path a shoe covers", () => {
    const narrow = brakeOf(parseWinder(sheet(deep, "arc", "40")));
    const wide = brakeOf(parseWinder(sheet(deep, "arc", "80")));
    expect(pressure(wide)).toBeCloseTo(pressure(narrow) / 2, 3);
    const broad = brakeOf(parseWinder(sheet(deep, "width", "0.5m")));
    expect(pressure(broad)).toBeCloseTo(pressure(brakeOf(deepWinder)) / 2, 3);
  });

  it("counts every shoe in the torque and none of them in the pressure", () => {
    const two = parseWinder(sheet(deep, "shoes", "2"));
    expect(torque(brakeOf(deepWinder))).toBeCloseTo(2 * torque(brakeOf(two)), 3);
    expect(pressure(brakeOf(deepWinder))).toBeCloseTo(pressure(brakeOf(two)), 6);
  });

  it("reads a figure the same however the sheet writes it", () => {
    // A path is a length and a spring is a force, so the fathom and the
    // ton force are as good as the metre and the kilonewton.
    const metres = parseWinder(sheet(deep, "diameter", "3600mm"));
    expect(torque(brakeOf(metres))).toBeCloseTo(torque(brakeOf(deepWinder)), 3);
    expect(pressure(brakeOf(metres))).toBeCloseTo(pressure(brakeOf(deepWinder)), 3);
  });

  it("puts the friction of the lining straight into the torque", () => {
    const glazed = parseWinder(sheet(deep, "friction", "0.175"));
    expect(torque(brakeOf(glazed))).toBeCloseTo(torque(brakeOf(deepWinder)) / 2, 3);
    expect(heldPull(glazed)).toBeCloseTo(heldPull(deepWinder) / 2, 3);
  });
});

describe("what a wind puts on it", () => {
  it("walks the out-of-balance from a least to a most", () => {
    const what = dutyOf(shallowWinder);
    expect(leastOutOfBalance(what)).toBeLessThan(mostOutOfBalance(what));
    expect(mostOutOfBalance(what)).toBeCloseTo(atStart(what), 2);
    expect(leastOutOfBalance(what)).toBeCloseTo(atEnd(what), 2);
  });

  it("reads the same figures at either end of the wind", () => {
    // The ropes are the only thing moving, so the line through the wind
    // is straight and the ends are where the two figures live.
    for (const one of [deepWinder, shallowWinder, wheelWinder, bareWinder]) {
      const what = dutyOf(one);
      expect(leastOutOfBalance(what)).toBeCloseTo(Math.min(atStart(what), atEnd(what)), 2);
      expect(mostOutOfBalance(what)).toBeCloseTo(Math.max(atStart(what), atEnd(what)), 2);
    }
  });

  it("leaves the two together where a balance rope is hung", () => {
    const what = dutyOf(deepWinder);
    expect(mostOutOfBalance(what) - leastOutOfBalance(what)).toBeLessThan(0.01);
  });

  it("counts the balance rope in what the brake has to hold", () => {
    // Same shaft, same skips, same shoes: the rope hung underneath is
    // the whole of the difference and it is not a small one.
    expect(worstOutOfBalance(dutyOf(bareWinder))).toBeGreaterThan(worstOutOfBalance(dutyOf(deepWinder)));
    expect(mostOutOfBalance(dutyOf(bareWinder))).toBeCloseTo(atStart(dutyOf(bareWinder)), 2);
    expect(leastOutOfBalance(dutyOf(bareWinder))).toBeCloseTo(atEnd(dutyOf(bareWinder)), 2);
  });

  it("counts the rope's own weight and not the payload alone", () => {
    // Twelve tonnes of coal is 117.7 kN of it and the rope on a nine
    // hundred metre shaft is most of another hundred.
    expect(worstOutOfBalance(dutyOf(bareWinder))).toBeGreaterThan(180);
    expect(holds(bareWinder)).toBe(false);
    expect(holds(deepWinder)).toBe(true);
  });

  it("takes the worst of the two whichever way it points", () => {
    for (const one of [deepWinder, shallowWinder, wheelWinder]) {
      const what = dutyOf(one);
      const worst = worstOutOfBalance(what);
      expect(worst).toBeCloseTo(Math.max(Math.abs(leastOutOfBalance(what)), Math.abs(mostOutOfBalance(what))), 2);
      expect(worst).toBeGreaterThan(0);
    }
  });
});

describe("what it holds", () => {
  it("holds where the pull at the rope is three times the worst", () => {
    expect(heldPull(deepWinder)).toBeGreaterThan(3 * worstOutOfBalance(dutyOf(deepWinder)));
    expect(holds(deepWinder)).toBe(true);
    expect(holds(soundWinder)).toBe(true);
  });

  it("does not hold where it is not", () => {
    expect(heldPull(shallowWinder)).toBeLessThan(3 * worstOutOfBalance(dutyOf(shallowWinder)));
    expect(holds(shallowWinder)).toBe(false);
    expect(holds(wheelWinder)).toBe(false);
  });

  it("gives the shoe force that just holds it", () => {
    const wanted = forceFor(shallowWinder);
    expect(wanted).toBeGreaterThan(brakeOf(shallowWinder).force);
    expect(holds(parseWinder(sheet(shallow, "force", `${wanted * 1.001}kn`)))).toBe(true);
    expect(holds(parseWinder(sheet(shallow, "force", `${wanted * 0.999}kn`)))).toBe(false);
  });

  it("asks a balanced winder for less spring than a bare one", () => {
    // The balance rope is worth more to the brake than any spring is:
    // it takes the rope out of the out-of-balance and the brake was
    // being sized on the rope.
    expect(forceFor(deepWinder)).toBeLessThan(forceFor(bareWinder));
    expect(forceFor(deepWinder)).toBeLessThan(brakeOf(deepWinder).force);
  });

  it("asks the shoes for that force and not the ropes", () => {
    // On a friction winder no spring buys anything past what the wheel
    // passes, so the force asked for is the shoes' own figure and the
    // winder still will not hold once it is wound on.
    const wanted = forceFor(wheelWeakWinder);
    const sprung = parseWinder(sheet(wheel, "force", `${wanted}kn`));
    expect(shoesPull(sprung)).toBeCloseTo(3 * worstOutOfBalance(dutyOf(wheelWeakWinder)), 2);
    expect(holds(sprung)).toBe(false);
  });

  it("holds by the shoes alone on a drum winder", () => {
    for (const one of [deepWinder, shallowWinder, soundWinder]) {
      expect(heldPull(one)).toBeCloseTo(shoesPull(one), 3);
    }
  });
});

describe("what the ropes will pass", () => {
  it("passes the slack side times one less than the working ratio", () => {
    const allowed = workingRatio({ diameter: 5.6, wrap: 195, friction: 0.25, ropes: 4 });
    const rising = weightOf(gross(wheelWinder.rising));
    const falling = weightOf(gross(wheelWinder.falling));
    let least = Number.POSITIVE_INFINITY;
    for (let at = 0; at <= 100; at += 1) {
      const found = tensions(wheelWinder.rope, 1100, rising, falling, (1100 * at) / 100, 4, wheelWinder.balance);
      least = Math.min(least, found.slack * (allowed - 1));
    }
    expect(gripPull(wheelWinder)).toBeCloseTo(least, 2);
  });

  it("refuses a drum winder that question", () => {
    expect(() => gripPull(deepWinder)).toThrow(WindingError);
    expect(() => gripPull(shallowWinder)).toThrow(WindingError);
  });

  it("takes the lesser of the shoes and the grip on a friction winder", () => {
    expect(shoesPull(wheelWinder)).toBeGreaterThan(gripPull(wheelWinder));
    expect(heldPull(wheelWinder)).toBeCloseTo(gripPull(wheelWinder), 2);
  });

  it("leaves the shoes in charge where they are the weaker", () => {
    expect(shoesPull(wheelWeakWinder)).toBeLessThan(gripPull(wheelWeakWinder));
    expect(heldPull(wheelWeakWinder)).toBeCloseTo(shoesPull(wheelWeakWinder), 2);
  });

  it("leaves what the ropes pass alone when the springs change", () => {
    // The grip is a property of the wheel, the ropes and the wind. What
    // the engine house does to the springs has nothing to do with it.
    expect(gripPull(wheelWinder)).toBeCloseTo(gripPull(wheelWeakWinder), 4);
    expect(heldPull(wheelWeakWinder)).toBeLessThan(gripPull(wheelWinder));
  });

  it("narrows a wheel to its ropes and a drum to its shoes", () => {
    // Two winders, two answers, and the reason a friction winder's
    // brake is designed round the capstan equation and a drum winder's
    // is designed round the springs.
    expect(heldPull(wheelWinder)).toBeLessThan(shoesPull(wheelWinder));
    expect(heldPull(deepWinder)).toBeCloseTo(shoesPull(deepWinder), 4);
    expect(heldPull(bareWinder)).toBeCloseTo(shoesPull(bareWinder), 4);
  });

  it("buys nothing on a wheel from a spring past what the ropes grip", () => {
    const harder = parseWinder(sheet(wheel, "force", "1400kn"));
    expect(heldPull(harder)).toBeCloseTo(heldPull(wheelWinder), 3);
  });
});
