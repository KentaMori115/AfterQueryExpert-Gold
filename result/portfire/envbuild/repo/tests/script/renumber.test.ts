import { describe, expect, it } from "vitest";
import {
  applyLabels,
  checkLabels,
  duplicateLabels,
  planLabels,
  previewLabel,
} from "../../src/script/renumber.js";
import { parseScript } from "../../src/script/parser.js";
import { SourceFile } from "../../src/core/span.js";

function parse(source: string) {
  const file = new SourceFile("show.pf", source);
  const parsed = parseScript(file);
  expect(parsed.diagnostics.errorCount).toBe(0);
  return { script: parsed.script, file };
}

const SOURCE = [
  "show autumn",
  "at 20 fire shell.150.palm from pad.a",
  "at 24 fire shell.150.palm from pad.b label opener",
  "at 30 ripple 4 of shell.75.peony from pad.a every 200ms",
].join("\n");

describe("planLabels", () => {
  it("names every cue", () => {
    const { script } = parse(SOURCE);
    expect(planLabels(script)).toHaveLength(3);
  });

  it("leaves a cue that already has one alone", () => {
    const { script } = parse(SOURCE);
    const kept = planLabels(script).filter((plan) => plan.kept);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.label).toBe("opener");
  });

  it("names a cue from what it is and when", () => {
    const { script } = parse(SOURCE);
    const first = planLabels(script)[0];
    expect(first?.label).toBe("shell-150-palm-20");
  });

  it("does not collide with a label already in the script", () => {
    const { script } = parse(
      [
        "at 20 fire shell.150.palm from pad.a",
        "at 20 fire shell.150.palm from pad.b label shell-150-palm-20",
      ].join("\n"),
    );
    const generated = planLabels(script).find((plan) => !plan.kept);
    expect(generated?.label).toBe("shell-150-palm-20-2");
  });

  it("does not collide with another generated label", () => {
    const { script } = parse(
      [
        "at 20 fire shell.150.palm from pad.a",
        "at 20 fire shell.150.palm from pad.b",
      ].join("\n"),
    );
    const labels = planLabels(script).map((plan) => plan.label);
    expect(new Set(labels).size).toBe(2);
  });

  it("does not rename later cues when one is inserted at the start", () => {
    const before = planLabels(parse(SOURCE).script).map((plan) => plan.label);
    const after = planLabels(
      parse(["at 2 fire shell.75.peony from pad.a", SOURCE].join("\n")).script,
    ).map((plan) => plan.label);
    for (const label of before) {
      expect(after).toContain(label);
    }
  });

  it("skips a play, which names the group not the cue", () => {
    const { script } = parse(
      ["group a", "at 0 fire x.y from p", "end", "at 60 play a"].join("\n"),
    );
    expect(planLabels(script)).toHaveLength(1);
  });

  it("names cues inside a group too", () => {
    const { script } = parse(
      ["group a", "at 0 fire shell.150.palm from p", "end"].join("\n"),
    );
    expect(planLabels(script)).toHaveLength(1);
  });

  it("keeps a generated label short", () => {
    const { script } = parse(
      "at 20 fire shell.a-very-long-effect-name.with-more from pad.a",
    );
    expect(planLabels(script)[0]!.label.length).toBeLessThanOrEqual(24);
  });
});

describe("duplicateLabels", () => {
  it("finds a label used twice", () => {
    const { script } = parse(
      [
        "at 20 fire a.b from p label opener",
        "at 24 fire c.d from p label opener",
      ].join("\n"),
    );
    expect(duplicateLabels(script)).toEqual(["opener"]);
  });

  it("finds none when they differ", () => {
    expect(duplicateLabels(parse(SOURCE).script)).toEqual([]);
  });
});

describe("checkLabels", () => {
  it("warns about a duplicate", () => {
    const { script } = parse(
      [
        "at 20 fire a.b from p label opener",
        "at 24 fire c.d from p label opener",
      ].join("\n"),
    );
    expect(checkLabels(script).byCode("PF2610")[0]?.help).toContain(
      "confuses both",
    );
  });

  it("notes how many cues have no label", () => {
    const { script } = parse(SOURCE);
    expect(checkLabels(script).byCode("PF2611")[0]?.message).toContain(
      "2 of 3",
    );
  });

  it("says nothing about a fully labelled script", () => {
    const { script } = parse("at 20 fire a.b from p label opener");
    expect(checkLabels(script).size).toBe(0);
  });

  it("says nothing about a script with no cues", () => {
    expect(checkLabels(parse("show quiet").script).size).toBe(0);
  });
});

describe("applyLabels", () => {
  it("adds a label to the lines that lack one", () => {
    const { script, file } = parse(SOURCE);
    const text = applyLabels(SOURCE, script, file);
    expect(text.split("\n")[1]).toContain("label shell-150-palm-20");
  });

  it("leaves a labelled line byte for byte alone", () => {
    const { script, file } = parse(SOURCE);
    const before = SOURCE.split("\n")[2];
    expect(applyLabels(SOURCE, script, file).split("\n")[2]).toBe(before);
  });

  it("leaves a header alone", () => {
    const { script, file } = parse(SOURCE);
    expect(applyLabels(SOURCE, script, file).split("\n")[0]).toBe(
      "show autumn",
    );
  });

  it("keeps a trailing comment after the label", () => {
    const source = "at 20 fire shell.150.palm from pad.a # the big one";
    const { script, file } = parse(source);
    const text = applyLabels(source, script, file);
    expect(text).toContain("label shell-150-palm-20 # the big one");
  });

  it("is stable, so applying twice changes nothing the second time", () => {
    const { script, file } = parse(SOURCE);
    const once = applyLabels(SOURCE, script, file);
    const second = parse(once);
    expect(applyLabels(once, second.script, second.file)).toBe(once);
  });

  it("produces a script that still parses", () => {
    const { script, file } = parse(SOURCE);
    const text = applyLabels(SOURCE, script, file);
    expect(
      parseScript(new SourceFile("s.pf", text)).diagnostics.errorCount,
    ).toBe(0);
  });
});

describe("previewLabel", () => {
  it("shows the cue as it would be written", () => {
    const { script } = parse(SOURCE);
    const plan = planLabels(script)[0]!;
    expect(previewLabel(plan)).toContain("label shell-150-palm-20");
  });
});
