/**
 * `sheave decking` on the command line.
 *
 * The command exists because the arithmetic is worth nothing to the man
 * who has to decide whether to put a third deck in a cage unless he can
 * see the row above it and the row below it. What is tested here is
 * that the figures it prints are the figures the library gives, and
 * that it refuses what every other command refuses.
 */

import { describe, expect, it } from "vitest";
import { commandNamed, commands, run, usage } from "../src/cli/main.ts";
import {
  deckedCage,
  decking,
  raises,
  stand,
  standAt,
  withDecking,
} from "../src/cycle/index.ts";
import { cycleTime, profile } from "../src/cycle/index.ts";
import { conveyance } from "../src/cage/index.ts";
import { places } from "../src/report/format.ts";

const one = decking();
const how = profile();
const said = (argv: readonly string[]): string => run(argv).lines.join("\n");
const pair = (decks: number, allowed: number) => {
  const cage = deckedCage(one, decks, allowed);
  return { cage, empty: conveyance({ ...cage, payload: 0 }) };
};

describe("the judging this suite is done by", () => {
  it("still refuses a line that is not there", () => {
    let refused = false;
    try {
      expect("nothing of the sort").toContain("decking");
    } catch {
      refused = true;
    }
    if (!refused) throw new Error("expect found a line that was never printed");
  });
});

describe("the command is one of the others", () => {
  it("answers to its name", () => {
    expect(commandNamed("decking").name).toBe("decking");
    expect(commandNamed("decking").says.length).toBeGreaterThan(20);
  });

  it("stands in the list the program prints of itself", () => {
    expect(commands().some((each) => each.name === "decking")).toBe(true);
    expect(usage().join("\n")).toContain("decking");
  });

  it("runs on its own with nothing asked of it", () => {
    const done = run(["decking"]);
    expect(done.code).toBe(0);
    expect(done.lines.length).toBeGreaterThan(10);
  });
});

describe("what it prints", () => {
  it("says what the winder stands", () => {
    const { cage, empty } = pair(2, 220);
    expect(said(["decking", "--allowed", "220kN"])).toContain(places(stand(one, cage, empty, how.creep), 1));
  });

  it("says it again for the number of decks asked for", () => {
    const { cage, empty } = pair(3, 220);
    const out = said(["decking", "--decks", "3", "--allowed", "220kN"]);
    expect(out).toContain(places(standAt(one, cage, how.creep), 1));
    expect(out).toContain(places(stand(one, cage, empty, how.creep), 1));
  });

  it("says what the cage raises at the wind it was given", () => {
    expect(said(["decking", "--depth", "600m", "--allowed", "220kN"])).toContain(
      places(raises(how, one, 2, 600, 220), 1),
    );
  });

  it("says how long the cycle lasts at that wind", () => {
    const { cage, empty } = pair(2, 220);
    const working = withDecking(how, one, cage, empty);
    expect(said(["decking", "--depth", "600m", "--allowed", "220kN"])).toContain(
      places(cycleTime(working, 600), 1),
    );
  });

  it("carries the payload the rope has left the cage", () => {
    const { cage } = pair(2, 120);
    expect(said(["decking", "--allowed", "120kN"])).toContain(places(cage.payload / 1000, 2));
  });

  it("says what a single deck stands, when that is what it is asked", () => {
    const { cage } = pair(1, 220);
    expect(said(["decking", "--decks", "1"])).toContain(places(standAt(one, cage, how.creep), 1));
  });

  it("says what a four deck cage would stand", () => {
    const { cage } = pair(4, 220);
    expect(said(["decking", "--decks", "4", "--allowed", "220kN"])).toContain(
      places(standAt(one, cage, how.creep), 1),
    );
  });

  it("prints a longer wind for a deeper shaft", () => {
    const shallow = said(["decking", "--depth", "200m"]);
    const deep = said(["decking", "--depth", "1400m"]);
    expect(shallow).not.toBe(deep);
    expect(deep).toContain(places(raises(how, one, 2, 1400, 220), 1));
  });
});

describe("what it refuses", () => {
  it("refuses an option it does not take", () => {
    const done = run(["decking", "--nonsense", "2"]);
    expect(done.code).toBe(1);
    expect(done.lines.join("\n").length).toBeGreaterThan(0);
  });

  it("refuses a quantity with no unit on it", () => {
    expect(run(["decking", "--depth", "942"]).code).toBe(1);
    expect(run(["decking", "--allowed", "220"]).code).toBe(1);
  });

  it("refuses a cage of more decks than were ever built", () => {
    expect(run(["decking", "--decks", "9"]).code).toBe(1);
  });

  it("refuses a cage of no decks at all", () => {
    expect(run(["decking", "--decks", "0"]).code).toBe(1);
  });

  it("refuses a rope that will not lift what it is asked to", () => {
    expect(run(["decking", "--decks", "5", "--allowed", "20kN"]).code).toBe(1);
  });
});
