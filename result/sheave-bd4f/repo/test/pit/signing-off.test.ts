/**
 * The stop as it reaches a sheet somebody signs.
 *
 * A figure nobody reads is not a check. The design sheet has to carry
 * the stop beside every other figure the installation is signed off
 * against, ranked with them and against a band that can be moved; the
 * audit has to say so in the rope's own part, where a winding engineer
 * would look for it; and the command line has to answer for it.
 *
 * The certificate used to break it is Bolsover with a heavier balance
 * rope than it was built with. That is chosen on purpose: the static
 * factor of safety takes no notice of a balance rope at all, so the
 * installation still passes the figure the rules ask for and fails the
 * stop. A check that only repeated the static one would not notice.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseWinder } from "../../src/winder/parse.ts";
import { bands, checks, failed, room } from "../../src/design/checks.ts";
import { ropeFindings } from "../../src/winder/audit.ts";
import { ropeStrongEnough, winder, worstShock } from "../../src/winder/model.ts";
import { DEEPEST_FACTOR } from "../../src/rope/wear.ts";
import { commandNamed, commands, run, usage } from "../../src/cli/main.ts";

const bolsover = parseWinder(readFileSync("examples/bolsover.winder", "utf8"));
const whealJane = parseWinder(readFileSync("examples/wheal-jane.winder", "utf8"));
const overBalanced = winder({ ...bolsover, balance: 20 });

/**
 * The figures a sheet carries about one thing, in the order they appear.
 *
 * Read by what a line is about and what unit the number is in, never by where
 * it sits, so any layout of the same answers reads the same. Two runs of one
 * command lay their sheet out alike, which is what lets the two lists be
 * compared position by position.
 */
const NUMBER = /-?\d+(?:,\d{3})*(?:\.\d+)?/g;

function figures(lines: readonly string[], word: string, unit: string): number[] {
  const wanted = unit === "" ? undefined : new RegExp(`^\\s*${unit}(?![A-Za-z/])`);
  const out: number[] = [];
  for (const line of lines) {
    if (!line.toLowerCase().includes(word)) continue;
    for (const found of line.matchAll(NUMBER)) {
      const after = line.slice((found.index ?? 0) + found[0].length);
      const carries = wanted === undefined ? !/^\s*[A-Za-z%\u00b0]/.test(after) : wanted.test(after);
      if (!carries) continue;
      const value = Number(found[0].replace(/,/g, ""));
      if (Number.isFinite(value)) out.push(value);
    }
  }
  return out;
}

/**
 * The sheet for a rope of a stated length.
 *
 * The request names the option and not how a length is written on it, so both
 * readings are tried: the unit the rest of the program insists on, and a bare
 * number. Whichever the build takes is the one read.
 */
function sheet(metres: number): string[] {
  for (const written of [`${metres}m`, String(metres)]) {
    const found = run(["bounce", "--length", written]);
    if (found.code === 0) return found.lines;
  }
  expect.unreachable(`bounce would not answer for a ${metres} m rope`);
  return [];
}

/** Whether every figure held or grew, and at least one grew. */
function rose(from: readonly number[], to: readonly number[]): boolean {
  if (from.length === 0 || from.length !== to.length) return false;
  let moved = false;
  for (let at = 0; at < from.length; at += 1) {
    const before = from[at] as number;
    const after = to[at] as number;
    if (after < before) return false;
    if (after > before) moved = true;
  }
  return moved;
}

function named(one: ReturnType<typeof checks>, name: string) {
  const found = one.find((each) => each.name === name);
  expect(found, name).toBeDefined();
  return found as NonNullable<typeof found>;
}

describe("the stop on the design sheet", () => {
  it("is one of the figures an installation is signed off against", () => {
    expect(checks(bolsover).map((each) => each.name)).toContain("stop");
  });

  it("carries the factor found at the worst point of the wind", () => {
    expect(named(checks(bolsover), "stop").found).toBeCloseTo(worstShock(bolsover).factor, 3);
  });

  it("is banded below at the floor no rope is put on beneath", () => {
    const one = named(checks(bolsover), "stop");
    expect(one.low).toBe(DEEPEST_FACTOR);
    expect(bands().stop).toBe(DEEPEST_FACTOR);
  });

  it("is not banded above, a rope being allowed to be as strong as it likes", () => {
    expect(named(checks(bolsover), "stop").high).toBeUndefined();
  });

  it("is met on all three certificates that come with the library", () => {
    for (const one of [bolsover, whealJane]) expect(named(checks(one), "stop").met).toBe(true);
  });

  it("leaves Bolsover passing every check it passed before", () => {
    expect(named(checks(bolsover), "stop").met).toBe(true);
    expect(failed(checks(bolsover))).toHaveLength(0);
  });

  it("takes a band the caller moves, like every other check here", () => {
    const strict = bands({ stop: 12 });
    expect(named(checks(bolsover, strict), "stop").met).toBe(false);
    expect(named(checks(bolsover, strict), "stop").low).toBe(12);
  });

  it("catches a winder that keeps its static factor and loses the stop", () => {
    expect(ropeStrongEnough(overBalanced)).toBe(true);
    expect(named(checks(overBalanced), "factor").met).toBe(true);
    expect(named(checks(overBalanced), "stop").met).toBe(false);
  });

  it("counts that one among the checks it missed", () => {
    expect(failed(checks(overBalanced)).map((each) => each.name)).toContain("stop");
  });
});

describe("the stop in the audit", () => {
  it("says nothing severe about a rope that stands its own brake", () => {
    for (const one of [bolsover, whealJane]) {
      expect(worstShock(one).factor).toBeGreaterThan(DEEPEST_FACTOR);
      expect(ropeFindings(one).filter((each) => each.severity === "error")).toHaveLength(0);
    }
  });

  it("raises one against a rope that does not", () => {
    const raised = ropeFindings(overBalanced).filter((each) => each.severity === "error");
    expect(raised.length).toBeGreaterThanOrEqual(1);
  });

  it("puts it in the rope's part of the sheet", () => {
    const raised = ropeFindings(overBalanced).filter((each) => each.severity === "error");
    expect(raised.length).toBeGreaterThanOrEqual(1);
    for (const each of ropeFindings(overBalanced)) expect(each.part).toBe("rope");
  });

  it("never throws on an installation that cannot work", () => {
    expect(() => ropeFindings(overBalanced)).not.toThrow();
    expect(ropeFindings(overBalanced).some((each) => each.severity === "error")).toBe(true);
  });
});

describe("the command line", () => {
  it("has a command for it", () => {
    expect(commands().map((each) => each.name)).toContain("bounce");
  });

  it("says what it does, on the same sheet as the rest", () => {
    expect(commandNamed("bounce").says.length).toBeGreaterThan(20);
    expect(usage().join(" ")).toContain("bounce");
  });

  it("runs with nothing asked of it", () => {
    const found = run(["bounce"]);
    expect(found.code).toBe(0);
    expect(found.lines.length).toBeGreaterThan(5);
  });

  it("says the stretch, the period and the factor a stop leaves", () => {
    const said = sheet(984).join("\n").toLowerCase();
    expect(said).toContain("stretch");
    expect(said).toContain("period");
    expect(said).toContain("factor");
  });

  it("gives a longer rope more stretch and a slower bounce", () => {
    const shallow = sheet(120);
    const deep = sheet(1200);
    expect(rose(figures(shallow, "stretch", "m"), figures(deep, "stretch", "m"))).toBe(true);
    expect(rose(figures(shallow, "period", "s"), figures(deep, "period", "s"))).toBe(true);
  });

  it("and less of a factor left when that longer rope is stopped", () => {
    expect(rose(figures(sheet(1200), "factor", ""), figures(sheet(120), "factor", ""))).toBe(true);
  });

  it("refuses an option it does not take, as every command here does", () => {
    const found = run(["bounce", "--nonsense", "1"]);
    expect(found.code).toBe(1);
    expect(found.lines.join(" ")).toContain("nonsense");
  });

  it("says the same thing twice running, reading no clock of its own", () => {
    const once = run(["bounce"]);
    const again = run(["bounce"]);
    expect(once.code).toBe(0);
    expect(again.code).toBe(0);
    expect(once.lines).toEqual(again.lines);
  });

});

describe("the stop beside the other figures", () => {
  it("is ranked with them rather than kept apart", () => {
    const found = named(checks(bolsover), "stop");
    expect(room(found)).toBeGreaterThan(0);
    expect(room(found)).toBeLessThanOrEqual(1);
  });

  it("has no room at all on a winder that misses it", () => {
    expect(room(named(checks(overBalanced), "stop"))).toBe(0);
  });

  it("moves with the band it is judged against", () => {
    const slack = bands({ stop: 2 });
    const tight = bands({ stop: 4.4 });
    expect(room(named(checks(bolsover, slack), "stop"))).toBeGreaterThan(
      room(named(checks(bolsover, tight), "stop")),
    );
  });

  it("leaves every other band where it was", () => {
    const moved = bands({ stop: 6 });
    expect(moved.stop).toBe(6);
    expect(moved.ratio).toBe(bands().ratio);
    expect(moved.fleet).toBe(bands().fleet);
    expect(moved.dead).toBe(bands().dead);
  });
});
