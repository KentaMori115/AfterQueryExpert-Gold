import { describe, expect, it } from "vitest";
import { parseScript } from "../../src/script/parser.js";
import type {
  ChaseStatement,
  FanStatement,
  FireStatement,
  GroupStatement,
  RippleStatement,
  Statement,
} from "../../src/script/ast.js";
import { SourceFile } from "../../src/core/span.js";
import { raw } from "../../src/core/units.js";

function parse(source: string) {
  return parseScript(new SourceFile("show.pf", source));
}

function only(source: string): Statement {
  const parsed = parse(source);
  expect(parsed.diagnostics.errorCount).toBe(0);
  const statement = parsed.script.statements[0];
  expect(statement).toBeDefined();
  return statement!;
}

describe("headers", () => {
  it("reads a show name", () => {
    const parsed = parse("show autumn-2025");
    expect(parsed.script.statements[0]).toMatchObject({
      kind: "show",
      name: "autumn-2025",
    });
  });

  it("reads a seed", () => {
    expect((only("seed autumn-2025") as { seed: string }).seed).toBe(
      "autumn-2025",
    );
  });

  it("reads a frame rate and the drop flag", () => {
    expect(
      only("frame 25") as { rate: number; dropFrame: boolean },
    ).toMatchObject({ rate: 25, dropFrame: false });
    expect((only("frame 30 drop") as { dropFrame: boolean }).dropFrame).toBe(
      true,
    );
  });

  it("refuses a frame rate nothing plays at", () => {
    expect(parse("frame 60").diagnostics.byCode("PF2114")).toHaveLength(1);
  });

  it("reads an include", () => {
    expect((only('include "cues/finale.pf"') as { path: string }).path).toBe(
      "cues/finale.pf",
    );
  });

  it("refuses a header with nothing after it", () => {
    expect(parse("show").diagnostics.byCode("PF2104")).toHaveLength(1);
    expect(parse("seed").diagnostics.byCode("PF2113")).toHaveLength(1);
    expect(parse("include").diagnostics.byCode("PF2115")).toHaveLength(1);
  });
});

describe("fire", () => {
  it("reads a plain cue", () => {
    const statement = only(
      "at 12.4 fire shell.150.palm from pad.a",
    ) as FireStatement;
    expect(statement.kind).toBe("fire");
    expect(raw(statement.at)).toBe(12400);
    expect(statement.effect).toBe("shell.150.palm");
    expect(statement.position).toBe("pad.a");
    expect(statement.pin).toEqual({ kind: "auto" });
  });

  it("reads a minute form time", () => {
    expect(raw((only("at 1:23.450 fire a from b") as FireStatement).at)).toBe(
      83450,
    );
  });

  it("takes a fixed pin", () => {
    const statement = only("at 12.4 fire a from b pin 12.04") as FireStatement;
    expect(statement.pin).toEqual({ kind: "fixed", module: 12, pin: 4 });
  });

  it("takes a lowered break and a label", () => {
    const statement = only(
      "at 12.4 fire a from b height 90 label opener",
    ) as FireStatement;
    expect(raw(statement.height!)).toBe(90);
    expect(statement.label).toBe("opener");
  });

  it("takes the clauses in any order", () => {
    const statement = only(
      "at 12.4 fire a from b label opener pin 3.01 height 60",
    ) as FireStatement;
    expect(statement.label).toBe("opener");
    expect(statement.pin).toEqual({ kind: "fixed", module: 3, pin: 1 });
    expect(raw(statement.height!)).toBe(60);
  });

  it("takes a quoted label", () => {
    expect(
      (only('at 1 fire a from b label "the big one"') as FireStatement).label,
    ).toBe("the big one");
  });

  it("leaves optional clauses off when they are not given", () => {
    const statement = only("at 1 fire a from b") as FireStatement;
    expect("height" in statement).toBe(false);
    expect("label" in statement).toBe(false);
  });

  it("refuses a missing from", () => {
    expect(
      parse("at 12.4 fire shell.150 pad.a").diagnostics.byCode("PF2119"),
    ).toHaveLength(1);
  });

  it("refuses a time that is not a time", () => {
    const parsed = parse("at soon fire a from b");
    expect(parsed.diagnostics.byCode("PF2107")[0]?.help).toContain("250ms");
  });

  it("refuses a bad pin address", () => {
    expect(
      parse("at 1 fire a from b pin twelve").diagnostics.byCode("PF2109"),
    ).toHaveLength(1);
  });

  it("refuses an unknown clause and lists the real ones", () => {
    const diagnostic = parse(
      "at 1 fire a from b colour red",
    ).diagnostics.byCode("PF2112")[0];
    expect(diagnostic?.help).toContain("pin, height, label");
  });
});

describe("ripple and fan", () => {
  it("reads a ripple", () => {
    const statement = only(
      "at 20 ripple 8 of shell.75 from pad.a every 120ms",
    ) as RippleStatement;
    expect(statement.count).toBe(8);
    expect(raw(statement.every)).toBe(120);
  });

  it("reads a fan with jitter", () => {
    const statement = only(
      "at 40 fan 12 of comet.50 from pad.b spread 800ms jitter 20ms",
    ) as FanStatement;
    expect(statement.kind).toBe("fan");
    expect(raw(statement.spread)).toBe(800);
    expect(raw(statement.jitter!)).toBe(20);
  });

  it("refuses a count of zero", () => {
    expect(
      parse("at 1 ripple 0 of a from b every 1").diagnostics.byCode("PF2108"),
    ).toHaveLength(1);
  });

  it("refuses a missing of", () => {
    expect(
      parse("at 1 ripple 8 a from b every 1").diagnostics.byCode("PF2119"),
    ).toHaveLength(1);
  });

  it("refuses a ripple with no every", () => {
    expect(
      parse("at 1 ripple 8 of a from b").diagnostics.byCode("PF2119"),
    ).toHaveLength(1);
  });
});

describe("chase", () => {
  it("reads the positions it runs across", () => {
    const statement = only(
      "at 30 chase mine.100 across pad.a pad.b pad.c every 200ms",
    ) as ChaseStatement;
    expect(statement.positions).toEqual(["pad.a", "pad.b", "pad.c"]);
    expect(statement.passes).toBe(1);
  });

  it("takes a pass count", () => {
    expect(
      (
        only(
          "at 30 chase a across pad.a pad.b every 200ms passes 3",
        ) as ChaseStatement
      ).passes,
    ).toBe(3);
  });

  it("refuses a chase across one position", () => {
    expect(
      parse("at 30 chase a across pad.a every 1").diagnostics.byCode("PF2117"),
    ).toHaveLength(1);
  });
});

describe("groups", () => {
  const source = [
    "group finale",
    "  at 0.0 fire shell.150 from pad.a",
    "  at 0.5 fire shell.150 from pad.b",
    "end",
    "at 1:20 play finale",
  ].join("\n");

  it("collects the body into the group", () => {
    const parsed = parse(source);
    expect(parsed.diagnostics.errorCount).toBe(0);
    const group = parsed.script.statements[0] as GroupStatement;
    expect(group.kind).toBe("group");
    expect(group.body).toHaveLength(2);
  });

  it("keeps the play outside the group", () => {
    const parsed = parse(source);
    expect(parsed.script.statements).toHaveLength(2);
    expect(parsed.script.statements[1]?.kind).toBe("play");
  });

  it("refuses an end with nothing open", () => {
    expect(parse("end").diagnostics.byCode("PF2100")).toHaveLength(1);
  });

  it("refuses a group inside a group", () => {
    const parsed = parse(["group a", "group b", "end"].join("\n"));
    expect(parsed.diagnostics.byCode("PF2101")).toHaveLength(1);
  });

  it("refuses a group that is never closed", () => {
    const parsed = parse(["group a", "at 1 fire x from y"].join("\n"));
    expect(parsed.diagnostics.byCode("PF2103")[0]?.help).toContain("end");
  });

  it("refuses a header inside a group", () => {
    const parsed = parse(["group a", "show autumn", "end"].join("\n"));
    expect(parsed.diagnostics.byCode("PF2102")).toHaveLength(1);
  });
});

describe("recovery", () => {
  it("keeps reading after a bad line", () => {
    const parsed = parse(
      ["rocket 4", "at 12.4 fire a from b", "at 13 fire c from d"].join("\n"),
    );
    expect(parsed.diagnostics.errorCount).toBe(1);
    expect(parsed.script.statements).toHaveLength(2);
  });

  it("reports every bad line rather than the first", () => {
    const parsed = parse(["rocket 4", "missile 9", "torpedo 1"].join("\n"));
    expect(parsed.diagnostics.byCode("PF2116")).toHaveLength(3);
  });

  it("points at the line the mistake is on", () => {
    const parsed = parse(["at 1 fire a from b", "rocket 4"].join("\n"));
    const diagnostic = parsed.diagnostics.byCode("PF2116")[0];
    const line = diagnostic?.file?.positionAt(diagnostic.span?.start ?? 0).line;
    expect(line).toBe(2);
  });

  it("ignores comments and blank lines", () => {
    const parsed = parse(
      ["# a note", "", "at 1 fire a from b", "  # another"].join("\n"),
    );
    expect(parsed.diagnostics.size).toBe(0);
    expect(parsed.script.statements).toHaveLength(1);
  });

  it("parses an empty script into nothing", () => {
    const parsed = parse("");
    expect(parsed.script.statements).toEqual([]);
    expect(parsed.diagnostics.size).toBe(0);
  });

  it("names the source it came from", () => {
    expect(parse("").script.source).toBe("show.pf");
  });

  it("refuses a cue verb it does not know", () => {
    const diagnostic = parse("at 1 launch a from b").diagnostics.byCode(
      "PF2118",
    )[0];
    expect(diagnostic?.help).toContain("fire, ripple, fan, chase or play");
  });
});
