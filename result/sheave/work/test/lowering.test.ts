/**
 * What a brake is worth with the wind moving, and what the sheet says
 * about it.
 *
 * The second of the two brake figures, and the one an inspector asks
 * for. Winding, the load is already pulling backwards on the drum and
 * the shoes are only asked for the rest; lowering, the same load is
 * driving and has to be taken off before a single metre a second
 * squared appears. Nobody who has only ever seen the first figure has
 * seen the brake.
 *
 * The rest of it is the sheet. A `brake` line is six figures off a
 * maker's plate and none of them can be guessed at, so the reader wants
 * all six or none, and a certificate that says nothing about a brake is
 * a certificate nobody has measured rather than a winder without one.
 * The audit is told to leave those alone, which is the difference
 * between an audit somebody reads and an audit somebody learns to
 * ignore.
 */

import { describe, expect, it } from "vitest";
import {
  brakeOf,
  heldPull,
  torque,
  pressure,
  retardationFor,
  retardationLowering,
  retardationWinding,
  stopsAnOverwind,
} from "../src/safety/index.ts";
import { auditWinder, dutyOf, parseWinder } from "../src/winder/index.ts";
import { leastOutOfBalance, mostOutOfBalance, movingMass } from "../src/power/index.ts";
import { parseForce, parseLength } from "../src/units/index.ts";
import { overwindRoom } from "../src/shaft/index.ts";
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

/**
 * A deep cage winder with no balance rope, where the rope drives at the
 * end of the wind and the out-of-balance goes through nought into the
 * other side of it.
 */
const cages = `
winder Clipstone No.2
shaft Top Hard diameter=6.7m depth=850m conveyances=2 sump=14m headgear=40m
rope diameter=48mm construction=6x36 grade=1960 ropes=1
drum diameter=4m width=2.2m layers=2 lead=40m
rising cage loaded tare=11t payload=4t decks=2 width=2.4m across=1.5m
falling cage empty tare=11t payload=0t decks=2 width=2.4m across=1.5m
cycle full=12mps accelerate=1 decelerate=1.1 creep=0.5mps creepfor=6m rest=25s
brake diameter=3.4m width=0.26m arc=55 shoes=4 friction=0.35 force=240kn
`;

/** The same sheet with one figure on its brake line written differently. */
function sheet(text: string, key: string, value: string): string {
  return text.replace(new RegExp(`(^brake .*?\\b${key}=)\\S+`, "m"), `$1${value}`);
}

/** The deep winder as most certificates have it, with no brake line at all. */
const unmeasured = deep.split("\n").filter((each) => !each.startsWith("brake ")).join("\n");

/** The same shallow shaft with twice the shoes, which is enough of a brake. */
const sound = sheet(shallow, "shoes", "4");

const deepWinder = parseWinder(deep);
const shallowWinder = parseWinder(shallow);
const soundWinder = parseWinder(sound);
const wheelWinder = parseWinder(wheel);
const quietWinder = parseWinder(unmeasured);
const cageWinder = parseWinder(cages);

function brakeSaid(text: string) {
  return auditWinder(parseWinder(text)).filter((each) => each.part === "brake");
}

describe("the two retardations", () => {
  it("adds the least out-of-balance winding and takes the most off lowering", () => {
    const what = dutyOf(shallowWinder);
    const mass = movingMass(what);
    const held = heldPull(shallowWinder);
    expect(retardationWinding(shallowWinder)).toBeCloseTo(((held + leastOutOfBalance(what)) * 1000) / mass, 3);
    expect(retardationLowering(shallowWinder)).toBeCloseTo(((held - mostOutOfBalance(what)) * 1000) / mass, 3);
  });

  it("takes a negative least off the winding figure and does not add it", () => {
    // At the end of a deep cage wind the rope on the falling side
    // outweighs everything the rising side carries, so the load has
    // stopped helping the brake and started fighting it. The sign is
    // the whole of the arithmetic and there is nothing to take an
    // absolute value of.
    const what = dutyOf(cageWinder);
    const mass = movingMass(what);
    const held = heldPull(cageWinder);
    expect(leastOutOfBalance(what)).toBeLessThan(0);
    expect(retardationWinding(cageWinder)).toBeCloseTo(((held + leastOutOfBalance(what)) * 1000) / mass, 3);
    expect(retardationWinding(cageWinder)).toBeLessThan((held * 1000) / mass);
  });

  it("gives nought winding as well, where the rope drives harder than the shoes hold", () => {
    // The other end of the same rule. A cage winder finishing its wind
    // on an unbalanced rope is being driven backwards, and a brake too
    // small to take that off does not retard the wind by a negative
    // amount, it does not retard it at all.
    const weak = parseWinder(sheet(cages, "force", "20kn"));
    const what = dutyOf(weak);
    expect(heldPull(weak) + leastOutOfBalance(what)).toBeLessThan(0);
    expect(retardationWinding(weak)).toBe(0);
    expect(retardationLowering(weak)).toBe(0);
  });

  it("puts lowering below winding wherever the load is not balanced out", () => {
    for (const one of [deepWinder, shallowWinder, soundWinder]) {
      expect(retardationLowering(one)).toBeLessThan(retardationWinding(one));
    }
  });

  it("keeps the two apart by twice the load even on a balanced winder", () => {
    const what = dutyOf(deepWinder);
    const apart = retardationWinding(deepWinder) - retardationLowering(deepWinder);
    const load = leastOutOfBalance(what) + mostOutOfBalance(what);
    expect(apart).toBeCloseTo((load * 1000) / movingMass(what), 3);
  });

  it("gives nought lowering where the load is more than the brake holds", () => {
    const weak = parseWinder(sheet(shallow, "force", "20kn"));
    expect(heldPull(weak)).toBeLessThan(mostOutOfBalance(dutyOf(weak)));
    expect(retardationLowering(weak)).toBe(0);
    expect(retardationWinding(weak)).toBeGreaterThan(0);
  });

  it("spreads both figures over everything the wind moves", () => {
    // Twice the brake is not twice the retardation, because the load is
    // in the sum as well and the mass under it does not change.
    const harder = parseWinder(sheet(sound, "force", "180kn"));
    const mass = movingMass(dutyOf(soundWinder));
    const gained = retardationWinding(harder) - retardationWinding(soundWinder);
    expect(gained).toBeCloseTo((heldPull(soundWinder) * 1000) / mass, 3);
  });

  it("takes the most off lowering on a friction winder as well", () => {
    // The figure the shoes are held to is the grip, and the load comes
    // off that rather than off what the springs would have given.
    const what = dutyOf(wheelWinder);
    const mass = movingMass(what);
    const held = heldPull(wheelWinder);
    expect(retardationLowering(wheelWinder)).toBeCloseTo(((held - mostOutOfBalance(what)) * 1000) / mass, 3);
    expect(retardationWinding(wheelWinder)).toBeCloseTo(((held + leastOutOfBalance(what)) * 1000) / mass, 3);
  });

  it("holds a friction winder to what the ropes pass and no further", () => {
    const harder = parseWinder(sheet(wheel, "force", "2100kn"));
    expect(retardationWinding(harder)).toBeCloseTo(retardationWinding(wheelWinder), 3);
  });
});

describe("the overwind", () => {
  it("answers it with the winding figure and not the lowering one", () => {
    // This brake is the case the two figures were separated for: it
    // stops an overwind comfortably and would not stop the same wind
    // going the other way.
    const wanted = retardationFor(soundWinder.profile.full, overwindRoom(soundWinder.shaft));
    expect(retardationLowering(soundWinder)).toBeLessThan(wanted);
    expect(retardationWinding(soundWinder)).toBeGreaterThan(wanted);
    expect(stopsAnOverwind(soundWinder)).toBe(true);
  });

  it("is stopped where the winding figure covers the room the headgear leaves", () => {
    const wanted = retardationFor(soundWinder.profile.full, overwindRoom(soundWinder.shaft));
    expect(retardationWinding(soundWinder)).toBeGreaterThan(wanted);
    expect(stopsAnOverwind(soundWinder)).toBe(true);
  });

  it("is not where it does not", () => {
    for (const one of [deepWinder, shallowWinder, wheelWinder]) {
      const wanted = retardationFor(one.profile.full, overwindRoom(one.shaft));
      expect(retardationWinding(one)).toBeLessThan(wanted);
      expect(stopsAnOverwind(one)).toBe(false);
    }
  });
});

describe("a brake line on a winder file", () => {
  it("reads all six figures off it and uses every one", () => {
    // Six keys, and each of them moves the figure it belongs to: the
    // three that make torque, and the three that make the strip of path
    // a shoe bears on.
    const said = brakeOf(deepWinder);
    expect(torque(brakeOf(parseWinder(sheet(deep, "force", "600kn"))))).toBeCloseTo(2 * torque(said), 3);
    expect(torque(brakeOf(parseWinder(sheet(deep, "shoes", "8"))))).toBeCloseTo(2 * torque(said), 3);
    expect(torque(brakeOf(parseWinder(sheet(deep, "friction", "0.175"))))).toBeCloseTo(torque(said) / 2, 3);
    expect(torque(brakeOf(parseWinder(sheet(deep, "diameter", "7.2m"))))).toBeCloseTo(2 * torque(said), 3);
    expect(pressure(brakeOf(parseWinder(sheet(deep, "arc", "120"))))).toBeCloseTo(pressure(said) / 2, 3);
    expect(pressure(brakeOf(parseWinder(sheet(deep, "width", "0.5m"))))).toBeCloseTo(pressure(said) / 2, 3);
  });

  it("wants every one of the six", () => {
    for (const key of ["diameter", "width", "arc", "shoes", "friction", "force"]) {
      const short = deep
        .split("\n")
        .map((line) => (line.startsWith("brake ") ? line.replace(new RegExp(`\\s${key}=\\S+`), "") : line))
        .join("\n");
      expect(() => parseWinder(short), key).toThrow(WindingError);
    }
  });

  it("refuses a word a brake line does not take", () => {
    expect(() => parseWinder(deep.replace("brake diameter=", "brake springs=6 diameter="))).toThrow(WindingError);
  });

  it("refuses two brakes on one winder", () => {
    const twice = `${deep}brake diameter=3m width=0.2m arc=60 shoes=2 friction=0.3 force=100kn\n`;
    expect(() => parseWinder(twice)).toThrow(WindingError);
  });

  it("reads the force in whatever the trade wrote it in", () => {
    // A spring is quoted in tons force on every old sheet, and a force
    // is a force whichever of the two a fitter reaches for.
    const tons = brakeOf(parseWinder(sheet(deep, "force", "30tonf")));
    expect(torque(tons) / torque(brakeOf(deepWinder))).toBeCloseTo(parseForce("30tonf", "force") / 300, 4);
  });

  it("reads the path and the shoe as lengths", () => {
    const millimetres = brakeOf(parseWinder(sheet(sheet(deep, "diameter", "3600mm"), "width", "250mm")));
    expect(torque(millimetres)).toBeCloseTo(torque(brakeOf(deepWinder)), 4);
    expect(pressure(millimetres)).toBeCloseTo(pressure(brakeOf(deepWinder)), 4);
    expect(parseLength("3600mm", "diameter")).toBeCloseTo(3.6, 6);
  });

  it("refuses a figure on it that is not a figure", () => {
    // Six figures off a maker's plate, and a word is not one of them.
    expect(() => parseWinder(sheet(deep, "shoes", "four"))).toThrow(WindingError);
    expect(() => parseWinder(sheet(deep, "friction", "good"))).toThrow(WindingError);
  });

  it("refuses to give a brake nobody has stated", () => {
    expect(() => brakeOf(quietWinder)).toThrow(WindingError);
  });
});

describe("what the audit says", () => {
  it("says nothing at all about a winder nobody has measured", () => {
    expect(brakeSaid(unmeasured)).toHaveLength(0);
    expect(auditWinder(quietWinder).length).toBeGreaterThan(0);
  });

  it("calls a brake that will not hold the wind an error", () => {
    const said = brakeSaid(shallow);
    expect(said.filter((each) => each.severity === "error").length).toBeGreaterThan(0);
  });

  it("calls one that will not stop an overwind an error", () => {
    // This brake holds the wind standing and still will not stop it, so
    // the only error left to find is the overwind.
    const said = brakeSaid(deep);
    expect(said.filter((each) => each.severity === "error")).toHaveLength(1);
    expect(said.filter((each) => each.severity === "warning")).toHaveLength(0);
  });

  it("warns where the shoe is pressed harder than practice allows", () => {
    expect(pressure(brakeOf(wheelWinder))).toBeGreaterThan(0.7);
    expect(brakeSaid(wheel).filter((each) => each.severity === "warning")).toHaveLength(1);
    expect(pressure(brakeOf(soundWinder))).toBeLessThan(0.7);
    expect(brakeSaid(sound).filter((each) => each.severity === "warning")).toHaveLength(0);
  });

  it("leaves a sound brake with a note and nothing else", () => {
    const said = brakeSaid(sound);
    expect(said).toHaveLength(1);
    expect(said[0]?.severity).toBe("note");
  });

  it("leaves the rest of the audit exactly as it found it", () => {
    // Same installation, one line more on the sheet. Everything the
    // rope, the drum, the shaft and the engine had to say about it is
    // the same, and the brake is added to the end of the list rather
    // than argued with the middle of it.
    const measured = auditWinder(deepWinder).filter((each) => each.part !== "brake");
    const unsaid = auditWinder(quietWinder).filter((each) => each.part !== "brake");
    expect(measured).toHaveLength(unsaid.length);
    expect(measured.map((each) => `${each.part}:${each.severity}`)).toEqual(
      unsaid.map((each) => `${each.part}:${each.severity}`),
    );
  });

  it("carries a note on every brake it has been given", () => {
    // The note is the reading, and a reading is worth having whether or
    // not there is anything wrong with the machine it came off.
    for (const text of [deep, shallow, wheel, sound]) {
      expect(brakeSaid(text).filter((each) => each.severity === "note").length, text.slice(0, 20)).toBeGreaterThan(0);
    }
  });

  it("counts the errors it finds and no more than that", () => {
    // A brake that will neither hold the wind standing nor stop it
    // running is two faults, not one and not three.
    const said = brakeSaid(shallow);
    expect(said.filter((each) => each.severity === "error")).toHaveLength(2);
    expect(said.filter((each) => each.severity === "warning")).toHaveLength(0);
    expect(said.filter((each) => each.severity === "note")).toHaveLength(1);
  });

  it("counts a shoe fault beside a holding fault and keeps both", () => {
    // The friction winder is the one with everything wrong at once: it
    // will not hold, it will not stop an overwind, and the springs
    // behind its shoes are harder than the path will take.
    const said = brakeSaid(wheel);
    expect(said.filter((each) => each.severity === "error")).toHaveLength(2);
    expect(said.filter((each) => each.severity === "warning")).toHaveLength(1);
    expect(said.filter((each) => each.severity === "note")).toHaveLength(1);
  });

  it("files every one of them under the brake and not the gear", () => {
    for (const text of [deep, shallow, wheel, sound]) {
      const said = brakeSaid(text);
      expect(said.length, text.slice(0, 20)).toBeGreaterThan(0);
      for (const each of said) expect(each.part).toBe("brake");
    }
  });
});
