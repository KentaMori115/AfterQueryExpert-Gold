import { describe, expect, it } from "vitest";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { SourceFile } from "../../src/core/span.js";
import { raw } from "../../src/core/units.js";

function expand(source: string, seed = "test") {
  const parsed = parseScript(new SourceFile("show.pf", source));
  expect(parsed.diagnostics.errorCount).toBe(0);
  return expandScript(parsed.script.statements, { seed });
}

function timesOf(source: string): number[] {
  return expand(source).shots.map((shot) => raw(shot.at));
}

describe("fire", () => {
  it("makes one shot", () => {
    const { shots } = expand("at 12.4 fire shell.150 from pad.a");
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({
      effect: "shell.150",
      position: "pad.a",
      index: 0,
    });
  });

  it("carries a fixed pin, a height and a label through", () => {
    const { shots } = expand(
      "at 1 fire a from b pin 12.04 height 90 label opener",
    );
    expect(shots[0]?.pin).toEqual({ kind: "fixed", module: 12, pin: 4 });
    expect(raw(shots[0]!.height!)).toBe(90);
    expect(shots[0]?.label).toBe("opener");
  });

  it("keeps the span it came from", () => {
    const { shots } = expand("at 1 fire a from b");
    expect(shots[0]?.origin.start).toBe(0);
  });
});

describe("ripple", () => {
  it("lays shots out at an even interval from the cue time", () => {
    expect(timesOf("at 20 ripple 4 of a from pad.a every 120ms")).toEqual([
      20000, 20120, 20240, 20360,
    ]);
  });

  it("numbers the shots in order", () => {
    const { shots } = expand("at 20 ripple 3 of a from pad.a every 100ms");
    expect(shots.map((shot) => shot.index)).toEqual([0, 1, 2]);
  });

  it("puts every shot on auto pin", () => {
    const { shots } = expand("at 20 ripple 3 of a from pad.a every 100ms");
    expect(shots.every((shot) => shot.pin.kind === "auto")).toBe(true);
  });

  it("applies jitter inside the amount asked for", () => {
    const plain = timesOf("at 20 ripple 6 of a from pad.a every 200ms");
    const jittered = timesOf(
      "at 20 ripple 6 of a from pad.a every 200ms jitter 30ms",
    );
    expect(jittered).not.toEqual(plain);
    jittered.forEach((time, index) => {
      expect(Math.abs(time - (plain[index] ?? 0))).toBeLessThanOrEqual(30);
    });
  });

  it("gives the same jitter for the same seed", () => {
    const source = "at 20 ripple 6 of a from pad.a every 200ms jitter 30ms";
    expect(expand(source, "one").shots.map((shot) => raw(shot.at))).toEqual(
      expand(source, "one").shots.map((shot) => raw(shot.at)),
    );
  });

  it("gives different jitter for a different seed", () => {
    const source = "at 20 ripple 6 of a from pad.a every 200ms jitter 40ms";
    expect(expand(source, "one").shots.map((shot) => raw(shot.at))).not.toEqual(
      expand(source, "two").shots.map((shot) => raw(shot.at)),
    );
  });

  it("does not let one macro's edit move another's jitter", () => {
    const before = expand(
      [
        "at 10 ripple 4 of a from pad.a every 100ms jitter 20ms label first",
        "at 30 ripple 4 of b from pad.b every 100ms jitter 20ms label second",
      ].join("\n"),
    ).shots.filter((shot) => shot.label === "second");
    const after = expand(
      [
        "at 10 ripple 9 of a from pad.a every 100ms jitter 20ms label first",
        "at 30 ripple 4 of b from pad.b every 100ms jitter 20ms label second",
      ].join("\n"),
    ).shots.filter((shot) => shot.label === "second");
    expect(after.map((shot) => raw(shot.at))).toEqual(
      before.map((shot) => raw(shot.at)),
    );
  });
});

describe("fan", () => {
  it("centres the run on the cue time", () => {
    expect(timesOf("at 40 fan 3 of a from pad.a spread 800ms")).toEqual([
      39600, 40000, 40400,
    ]);
  });

  it("puts a single shot fan exactly on the beat", () => {
    expect(timesOf("at 40 fan 1 of a from pad.a spread 800ms")).toEqual([
      40000,
    ]);
  });

  it("spans exactly the spread it was given", () => {
    const times = timesOf("at 40 fan 5 of a from pad.a spread 1s");
    expect((times[4] ?? 0) - (times[0] ?? 0)).toBe(1000);
  });
});

describe("chase", () => {
  it("runs across the positions in order", () => {
    const { shots } = expand(
      "at 30 chase a across pad.a pad.b pad.c every 200ms",
    );
    expect(shots.map((shot) => shot.position)).toEqual([
      "pad.a",
      "pad.b",
      "pad.c",
    ]);
    expect(shots.map((shot) => raw(shot.at))).toEqual([30000, 30200, 30400]);
  });

  it("wraps round for a second pass", () => {
    const { shots } = expand(
      "at 30 chase a across pad.a pad.b every 100ms passes 3",
    );
    expect(shots).toHaveLength(6);
    expect(shots.map((shot) => shot.position)).toEqual([
      "pad.a",
      "pad.b",
      "pad.a",
      "pad.b",
      "pad.a",
      "pad.b",
    ]);
  });
});

describe("groups", () => {
  const source = [
    "group finale",
    "  at 0.0 fire shell.150 from pad.a",
    "  at 0.5 fire shell.150 from pad.b",
    "end",
    "at 60 play finale",
    "at 90 play finale",
  ].join("\n");

  it("offsets the body by the play time", () => {
    expect(timesOf(source)).toEqual([60000, 60500, 90000, 90500]);
  });

  it("does not emit the group where it is defined", () => {
    const { shots } = expand(
      ["group a", "at 0 fire x from y", "end"].join("\n"),
    );
    expect(shots).toEqual([]);
  });

  it("expands a macro inside a group", () => {
    const { shots } = expand(
      [
        "group a",
        "  at 0 ripple 3 of x from pad.a every 100ms",
        "end",
        "at 10 play a",
      ].join("\n"),
    );
    expect(shots.map((shot) => raw(shot.at))).toEqual([10000, 10100, 10200]);
  });

  it("refuses a play of a group that is not there", () => {
    const parsed = parseScript(new SourceFile("s.pf", "at 10 play nothing"));
    const { diagnostics } = expandScript(parsed.script.statements);
    expect(diagnostics.byCode("PF2201")).toHaveLength(1);
  });

  it("refuses a group that plays itself", () => {
    const parsed = parseScript(
      new SourceFile(
        "s.pf",
        ["group a", "  at 0 play a", "end", "at 1 play a"].join("\n"),
      ),
    );
    const { diagnostics } = expandScript(parsed.script.statements);
    expect(diagnostics.byCode("PF2202")[0]?.message).toContain("a -> a");
  });
});

describe("ordering and caps", () => {
  it("sorts the whole show by time", () => {
    expect(
      timesOf(["at 30 fire a from p", "at 10 fire b from p"].join("\n")),
    ).toEqual([10000, 30000]);
  });

  it("refuses a macro that would produce more than the cap", () => {
    const parsed = parseScript(
      new SourceFile("s.pf", "at 1 ripple 900 of a from p every 10ms"),
    );
    const { shots, diagnostics } = expandScript(parsed.script.statements);
    expect(shots).toEqual([]);
    expect(diagnostics.byCode("PF2200")[0]?.message).toContain("900 shots");
  });

  it("takes a raised cap", () => {
    const parsed = parseScript(
      new SourceFile("s.pf", "at 1 ripple 900 of a from p every 10ms"),
    );
    const { shots } = expandScript(parsed.script.statements, {
      maxPerStatement: 1000,
    });
    expect(shots).toHaveLength(900);
  });

  it("skips the headers", () => {
    const { shots } = expand(
      ["show autumn", "seed x", "frame 25", "at 1 fire a from b"].join("\n"),
    );
    expect(shots).toHaveLength(1);
  });
});
