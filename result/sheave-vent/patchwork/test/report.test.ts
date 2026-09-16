/**
 * Saying a figure the way a colliery says it, and lining figures up.
 *
 * Not decoration. A rope diameter quoted to two decimal places is a
 * claim about a caliper nobody has, a depth quoted to a centimetre is a
 * claim about a survey nobody made, and a table whose figures do not
 * line up on the right is a table nobody reads across.
 */

import { describe, expect, it } from "vitest";
import {
  degrees,
  energy,
  factor,
  fathoms,
  feetAMinute,
  force,
  heading,
  horsepower,
  hundredweight,
  kilograms,
  line,
  listed,
  many,
  metres,
  millimetres,
  minutes,
  pence,
  percent,
  perDay,
  perHour,
  perMetre,
  places,
  pounds,
  power,
  ratio,
  seconds,
  sentence,
  share,
  signed,
  spaced,
  speed,
  stress,
  tonnes,
  tonsForce,
  verdict,
  winds,
  wrapped,
} from "../src/report/format.ts";
import {
  barOf,
  beside,
  blocks,
  centre,
  grouped,
  indented,
  left,
  pairs,
  right,
  ruled,
  sortedBy,
  sortedByNumber,
  table,
} from "../src/report/table.ts";
import { WindingError } from "../src/errors.ts";

describe("saying a figure", () => {
  it("gives a rope diameter in whole millimetres", () => {
    expect(millimetres(52.4)).toBe("52 mm");
    expect(millimetres(1052)).toBe("1,052 mm");
  });

  it("gives a depth in whole metres and in fathoms", () => {
    expect(metres(941.6)).toBe("942 m");
    expect(fathoms(942)).toContain("fm");
    expect(fathoms(942)).toContain("515");
  });

  it("gives a factor two places and a ratio two", () => {
    expect(factor(7.1894)).toBe("7.19");
    expect(ratio(1.8393)).toBe("1.84");
  });

  it("still speaks in feet a minute and horsepower", () => {
    expect(feetAMinute(15)).toContain("ft/min");
    expect(horsepower(3000)).toContain("hp");
    expect(hundredweight(1016.05)).toContain("cwt");
    expect(tonsForce(9.964)).toContain("tonf");
  });

  it("never writes a negative nought", () => {
    expect(places(-0.0004, 2)).toBe("0.00");
    expect(signed(-0.0004, 1)).toBe("0.0");
    expect(signed(3.2, 1)).toBe("+3.2");
  });

  it("gives the other quantities their own shapes", () => {
    expect(tonnes(12_000)).toBe("12.00 t");
    expect(kilograms(1234)).toBe("1,234 kg");
    expect(perMetre(9.94)).toBe("9.94 kg/m");
    expect(force(1101.4)).toBe("1,101.4 kN");
    expect(speed(15)).toBe("15.00 m/s");
    expect(power(1798)).toBe("1,798 kW");
    expect(seconds(99.38)).toBe("99.4 s");
    expect(minutes(28.27)).toBe("28.3 min");
    expect(degrees(1.494)).toBe("1.49°");
    expect(stress(122)).toBe("122 N/mm²");
    expect(winds(413_637)).toBe("413,637");
    expect(perHour(347.3)).toBe("347.3 t/h");
    expect(perDay(5557.2)).toBe("5,557 t/d");
    expect(energy(2.8512)).toBe("2.851 kWh/t");
    expect(pounds(126_000)).toBe("£126,000");
    expect(pence(61.97)).toBe("61.97p");
    expect(share(0.5455)).toBe("54.6%");
    expect(percent(54.55)).toBe("54.6%");
  });

  it("refuses a figure that is not a figure", () => {
    expect(() => places(Number.NaN)).toThrow(WindingError);
  });
});

describe("saying a sentence", () => {
  it("lines a label up against a value", () => {
    expect(line("coke rate", "480", 16)).toBe("coke rate       480");
  });

  it("rules under a heading and wraps prose", () => {
    expect(heading("the rope")[1]).toBe("--------");
    const found = wrapped("one two three four five six", 11);
    for (const each of found) expect(each.length).toBeLessThanOrEqual(11);
    expect(found.join(" ")).toBe("one two three four five six");
  });

  it("puts a capital on a sentence and an and in a list", () => {
    expect(sentence("the rope is worn")).toBe("The rope is worn");
    expect(listed(["rope", "drum", "shaft"])).toBe("rope, drum and shaft");
    expect(listed(["rope"])).toBe("rope");
    expect(() => listed([])).toThrow(WindingError);
  });

  it("makes a word plural when there is not one of the thing", () => {
    expect(many(1, "error")).toBe("1 error");
    expect(many(3, "error")).toBe("3 errors");
    expect(many(0, "error")).toBe("0 errors");
  });

  it("says a yes or a no and nothing else", () => {
    expect(verdict(true)).toBe("yes");
    expect(verdict(false)).toBe("no");
  });

  it("spaces a name written in one word", () => {
    expect(spaced("lockedCoil")).toBe("locked coil");
  });
});

describe("lining figures up", () => {
  const columns = [left("part"), right("kN")];
  const rows = [
    ["rope", "1,101"],
    ["hook", "744"],
  ];

  it("makes a head, a rule and the rows", () => {
    const found = table(columns, rows);
    expect(found).toHaveLength(4);
    expect(found[1]).toMatch(/^-+ +-+$/);
  });

  it("lines the words left and the figures right", () => {
    const found = table(columns, rows);
    expect(found[2]?.startsWith("rope")).toBe(true);
    expect(found[2]?.endsWith("1,101")).toBe(true);
  });

  it("puts a centred column in the middle", () => {
    const found = table([centre("met")], [["yes"], ["no"]]);
    expect(found[3]?.trim()).toBe("no");
  });

  it("refuses a row that does not fit the columns", () => {
    expect(() => table(columns, [["rope"]])).toThrow(WindingError);
    expect(() => table([], [])).toThrow(WindingError);
  });

  it("makes a two-column table of pairs", () => {
    expect(pairs([["factor", "7.19"]])).toHaveLength(3);
  });

  it("sorts by a column, as text and as numbers past the commas", () => {
    expect(sortedBy(rows, 0)[0]?.[0]).toBe("hook");
    expect(sortedByNumber(rows, 1)[0]?.[1]).toBe("744");
    expect(sortedByNumber(rows, 1, true)[0]?.[1]).toBe("1,101");
  });

  it("draws a bar of a share", () => {
    expect(barOf(0.5, 10)).toBe("#####.....");
    expect(barOf(2, 10)).toBe("##########");
    expect(barOf(-1, 10)).toBe("..........");
  });

  it("sets two blocks beside each other", () => {
    const found = beside(["one", "two"], ["a"], 2);
    expect(found[0]).toBe("one  a");
    expect(found[1]).toBe("two");
  });

  it("indents, rules, groups and blocks", () => {
    expect(indented(["one"], 3)[0]).toBe("   one");
    expect(indented([""], 3)[0]).toBe("");
    expect(ruled(4, "=")).toBe("====");
    expect(() => ruled(4, "==")).toThrow(WindingError);
    expect(grouped(["a", "b", "c", "d"], 2)).toEqual(["a", "b", "", "c", "d"]);
    expect(() => grouped(["a"], 0)).toThrow(WindingError);
    expect(blocks(["a"], [], ["b"])).toEqual(["a", "", "b"]);
  });
});
