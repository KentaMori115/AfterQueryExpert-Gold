import { describe, expect, it } from "vitest";
import {
  effectsIn,
  findGroup,
  groupsIn,
  isCueStatement,
  isShotStatement,
  positionsIn,
  shotsIn,
  totalShots,
  walk,
} from "../../src/script/ast.js";
import type {
  ChaseStatement,
  FanStatement,
  FireStatement,
  GroupStatement,
  PlayStatement,
  RippleStatement,
  Statement,
} from "../../src/script/ast.js";
import { span } from "../../src/core/span.js";
import { ms } from "../../src/core/units.js";

const at = span(0, 10);

const fire: FireStatement = {
  kind: "fire",
  span: at,
  at: ms(12400),
  effect: "shell.150.palm",
  position: "pad.a",
  pin: { kind: "auto" },
};

const ripple: RippleStatement = {
  kind: "ripple",
  span: at,
  at: ms(20000),
  count: 8,
  effect: "shell.75.peony",
  position: "pad.a",
  every: ms(120),
};

const chase: ChaseStatement = {
  kind: "chase",
  span: at,
  at: ms(30000),
  effect: "mine.100",
  positions: ["pad.a", "pad.b", "pad.c"],
  every: ms(200),
  passes: 2,
};

const fan: FanStatement = {
  kind: "fan",
  span: at,
  at: ms(40000),
  count: 12,
  effect: "comet.50",
  position: "pad.b",
  spread: ms(800),
};

const play: PlayStatement = {
  kind: "play",
  span: at,
  at: ms(60000),
  group: "finale",
};

const group: GroupStatement = {
  kind: "group",
  span: at,
  name: "finale",
  body: [fire, ripple],
};

describe("classification", () => {
  it("recognises every cue statement", () => {
    for (const statement of [fire, ripple, chase, fan, play]) {
      expect(isCueStatement(statement)).toBe(true);
    }
  });

  it("does not treat a header or a group as a cue", () => {
    const show: Statement = { kind: "show", span: at, name: "autumn" };
    expect(isCueStatement(show)).toBe(false);
    expect(isCueStatement(group)).toBe(false);
  });

  it("separates statements that put shots up from play", () => {
    expect(isShotStatement(fire)).toBe(true);
    expect(isShotStatement(play)).toBe(false);
  });
});

describe("shotsIn", () => {
  it("counts one for a fire", () => {
    expect(shotsIn(fire)).toBe(1);
  });

  it("counts the run of a ripple and a fan", () => {
    expect(shotsIn(ripple)).toBe(8);
    expect(shotsIn(fan)).toBe(12);
  });

  it("counts a chase over its positions and passes", () => {
    expect(shotsIn(chase)).toBe(6);
  });

  it("counts nothing for a play or a group header", () => {
    expect(shotsIn(play)).toBe(0);
    expect(shotsIn(group)).toBe(0);
  });
});

describe("names", () => {
  it("reads the effect a statement fires", () => {
    expect(effectsIn(fire)).toEqual(["shell.150.palm"]);
    expect(effectsIn(chase)).toEqual(["mine.100"]);
    expect(effectsIn(play)).toEqual([]);
  });

  it("reads the positions a statement uses", () => {
    expect(positionsIn(fire)).toEqual(["pad.a"]);
    expect(positionsIn(chase)).toEqual(["pad.a", "pad.b", "pad.c"]);
    expect(positionsIn(fan)).toEqual(["pad.b"]);
    expect(positionsIn(play)).toEqual([]);
  });

  it("copies a chase's positions rather than aliasing them", () => {
    const read = positionsIn(chase);
    read.push("pad.z");
    expect(chase.positions).toHaveLength(3);
  });
});

describe("walk", () => {
  it("visits every statement and every group body", () => {
    const seen: string[] = [];
    walk([group, play], (statement, inside) => {
      seen.push(`${statement.kind}${inside === undefined ? "" : `@${inside}`}`);
    });
    expect(seen).toEqual(["group", "fire@finale", "ripple@finale", "play"]);
  });

  it("visits nothing for an empty script", () => {
    const seen: string[] = [];
    walk([], () => seen.push("x"));
    expect(seen).toEqual([]);
  });
});

describe("groups", () => {
  it("lists the groups", () => {
    expect(groupsIn([group, play, fire])).toEqual([group]);
  });

  it("finds a group by name", () => {
    expect(findGroup([group, play], "finale")).toBe(group);
    expect(findGroup([group], "nothing")).toBeUndefined();
  });
});

describe("totalShots", () => {
  it("counts top level statements", () => {
    expect(totalShots([fire, ripple, chase, fan])).toBe(27);
  });

  it("counts a group only where it is played", () => {
    expect(totalShots([group, play])).toBe(9);
  });

  it("counts a group twice when it is played twice", () => {
    expect(totalShots([group, play, play])).toBe(18);
  });

  it("counts nothing for a play of a group that is not there", () => {
    expect(totalShots([{ ...play, group: "missing" }])).toBe(0);
  });

  it("counts nothing in an empty script", () => {
    expect(totalShots([])).toBe(0);
  });
});
