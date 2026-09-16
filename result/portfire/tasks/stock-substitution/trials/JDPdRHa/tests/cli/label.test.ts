import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";

const BARE = [
  "show autumn",
  "at 20 fire shell.150.palm from pad.a",
  "at 30 ripple 4 of shell.75.peony from pad.b every 200ms",
].join("\n");

const LABELLED = [
  "show autumn",
  "at 20 fire shell.150.palm from pad.a label opener",
  "at 30 ripple 4 of shell.75.peony from pad.b every 200ms label run",
].join("\n");

const CLASHING = [
  "at 20 fire a.b from pad.a label opener",
  "at 30 fire c.d from pad.b label opener",
].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "bare.pf": BARE,
    "done.pf": LABELLED,
    "clash.pf": CLASHING,
    ...over,
  });
}

describe("label", () => {
  it("prints the labelled script", () => {
    const env = envWith();
    expect(main(["label", "bare.pf"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("label shell-150-palm-20");
  });

  it("rewrites in place and says how many it did", () => {
    const env = envWith();
    main(["label", "bare.pf", "--write"], env);
    expect(env.written.get("bare.pf")).toContain("label ");
    expect(env.stdout).toContain("labelled 2 cues");
  });

  it("says so when there was nothing to do", () => {
    const env = envWith();
    main(["label", "done.pf", "--write"], env);
    expect(env.stdout).toContain("already fully labelled");
  });

  it("passes the check on a labelled script", () => {
    const env = envWith();
    expect(main(["label", "done.pf", "--check"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("every cue");
  });

  it("fails the check on a bare one", () => {
    const env = envWith();
    expect(main(["label", "bare.pf", "--check"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stdout).toContain("2 of 2");
  });

  it("reports a label used twice", () => {
    const env = envWith();
    expect(main(["label", "clash.pf", "--check"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF2610");
  });

  it("previews the cues as they would read", () => {
    const env = envWith();
    expect(main(["label", "bare.pf", "--preview"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("+ at 20.0 fire");
  });

  it("marks a cue that keeps its own label", () => {
    const env = envWith();
    main(["label", "done.pf", "--preview"], env);
    expect(env.stdout.split("\n").every((line) => !line.startsWith("+"))).toBe(
      true,
    );
  });

  it("needs a script", () => {
    const env = envWith();
    expect(main(["label"], env)).toBe(EXIT_BAD_USAGE);
  });

  it("reports a script it cannot read", () => {
    const env = envWith();
    expect(main(["label", "gone.pf"], env)).toBe(EXIT_BAD_USAGE);
  });

  it("refuses a script that does not parse", () => {
    const env = envWith({ "broken.pf": "rocket 4" });
    expect(main(["label", "broken.pf"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("cannot be labelled");
  });

  it("produces a script that still parses and lints", () => {
    const env = envWith();
    main(["label", "bare.pf", "--write"], env);
    const after = new MemoryEnv({
      "bare.pf": env.written.get("bare.pf") ?? "",
    });
    expect(main(["lint", "bare.pf"], after)).toBe(EXIT_OK);
  });

  it("makes lint report a label used twice", () => {
    const env = envWith();
    expect(main(["lint", "clash.pf"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF2610");
  });
});
