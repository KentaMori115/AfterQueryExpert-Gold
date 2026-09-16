import { verifyExpect } from "../support/frozenExpect.js";
import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
  MemoryEnv,
  main,
} from "../../src/index.js";

const CATALOG = [
  "id,kind,name,calibre,break,hang,diameter,height,duration,style,spread",
  "shell.150,shell,six inch palm,150mm,palm,2.4,140,,,,",
  "mine.100,mine,four inch mine,100mm,,1.8,,35,,,40",
  "gerb.crackle,ground,crackle gerb,,,,,4,20,gerb,",
].join("\n");

const RIG = [
  "position pad.a at 0 0",
  "position pad.b at 40 0",
  "module 1 fc-16 at pad.a",
  "module 2 fc-16 at pad.b",
].join("\n");

// The opener needs four seconds of lead, so the table starts before zero and
// the panel runs a pre roll of just over two seconds.
const SHOW = [
  "show autumn",
  "at 2 fire shell.150 from pad.a",
  "at 10 fire mine.100 from pad.a",
  "at 20 fire gerb.crackle from pad.b",
].join("\n");

// The panel's clock starts its pre roll early, so the opener logs at its
// zero and everything else logs at show time plus the pre roll.
const CLEAN_LOG = ["pin,fired", "01.01,0", "01.02,11.990", "02.01,21.990"].join(
  "\n",
);

// Every match burnt.
const CLEAN_AFTER = [
  "pin,state",
  "01.01,open",
  "01.02,open",
  "02.01,open",
].join("\n");

const BEFORE = ["pin,state", "01.01,ok", "01.02,ok", "02.01,ok"].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "autumn.pf": SHOW,
    "dryrun.csv": CLEAN_LOG,
    "after.csv": CLEAN_AFTER,
    "walk.csv": BEFORE,
    ...over,
  });
}

const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

function rehearse(env: MemoryEnv, ...extra: string[]): number {
  return main(
    ["rehearse", "autumn.pf", "--log", "dryrun.csv", ...extra, ...base],
    env,
  );
}

function afterWalk(env: MemoryEnv, ...extra: string[]): number {
  return main(
    ["continuity", "autumn.pf", "--after", "after.csv", ...extra, ...base],
    env,
  );
}

describe("rehearse --log", () => {
  it("passes a log that matches the table on the panel's clock", () => {
    verifyExpect();
    const env = envWith();
    expect(rehearse(env)).toBe(EXIT_OK);
    expect(env.stdout.length).toBeGreaterThan(0);
    expect(env.stderr).toBe("");
  });

  it("fails a log written in show time, since the pre roll was never taken off", () => {
    const env = envWith({
      "dryrun.csv": [
        "pin,fired",
        "01.01,-2.040",
        "01.02,9.960",
        "02.01,19.960",
      ].join("\n"),
    });
    // Negative times do not read, so the opener is missed, and the rest are
    // early by the whole pre roll.
    expect(rehearse(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
    expect(env.stderr).toContain("warning");
  });

  it("fails on an output the panel never closed", () => {
    const env = envWith({
      "dryrun.csv": ["pin,fired", "01.01,0", "02.01,21.990"].join("\n"),
    });
    expect(rehearse(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
  });

  it("fails on an output the table has nothing on", () => {
    verifyExpect();
    const env = envWith({
      "dryrun.csv": [
        "pin,fired",
        "01.01,0",
        "01.02,11.990",
        "02.01,21.990",
        "02.09,15.0",
      ].join("\n"),
    });
    expect(rehearse(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
  });

  it("fails on a second row for a pin that already fired", () => {
    const env = envWith({
      "dryrun.csv": [
        "pin,fired",
        "01.01,0",
        "01.02,11.990",
        "01.02,12.490",
        "02.01,21.990",
      ].join("\n"),
    });
    expect(rehearse(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
  });

  it("only warns about a late output and still passes", () => {
    const env = envWith({
      "dryrun.csv": [
        "pin,fired",
        "01.01,0",
        "01.02,12.190",
        "02.01,21.990",
      ].join("\n"),
    });
    expect(rehearse(env)).toBe(EXIT_OK);
    expect(env.stderr).toContain("warning");
    expect(env.stderr).not.toContain("error");
  });

  it("lets one frame pass without a word", () => {
    const env = envWith({
      "dryrun.csv": [
        "pin,fired",
        "01.01,0",
        "01.02,11.950",
        "02.01,22.030",
      ].join("\n"),
    });
    expect(rehearse(env)).toBe(EXIT_OK);
    expect(env.stderr).toBe("");
  });

  it("takes a tolerance in milliseconds", () => {
    verifyExpect();
    const late = ["pin,fired", "01.01,0", "01.02,12.190", "02.01,21.990"].join(
      "\n",
    );
    const loose = envWith({ "dryrun.csv": late });
    expect(rehearse(loose, "--tolerance", "250")).toBe(EXIT_OK);
    expect(loose.stderr).toBe("");
    const strict = envWith({ "dryrun.csv": late });
    expect(rehearse(strict, "--tolerance", "0")).toBe(EXIT_OK);
    expect(strict.stderr).toContain("warning");
  });

  it("refuses a tolerance that is not a number", () => {
    const env = envWith();
    expect(rehearse(env, "--tolerance", "soon")).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).not.toContain("unknown flag");
  });

  it("reports a log it cannot read", () => {
    const env = envWith();
    expect(
      main(["rehearse", "autumn.pf", "--log", "gone.csv", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).not.toContain("unknown flag");
  });

  it("stops on a log with no usable columns", () => {
    const env = envWith({ "dryrun.csv": "a,b\n1,2" });
    expect(rehearse(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
  });

  it("skips a row that will not read and grades the rest", () => {
    const env = envWith({
      "dryrun.csv": [
        "pin,fired",
        "01.01,0",
        "01.02,11.990",
        "what,now",
        "02.01,21.990",
      ].join("\n"),
    });
    expect(rehearse(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
    expect(env.stderr).not.toContain("warning");
    expect(env.stdout.length).toBeGreaterThan(0);
  });

  it("writes the grade to a file on request", () => {
    const env = envWith();
    expect(rehearse(env, "--out", "grade.txt")).toBe(EXIT_OK);
    expect(env.written.has("grade.txt")).toBe(true);
    expect(env.written.get("grade.txt")?.length).toBeGreaterThan(0);
  });

  it("refuses to grade a show that does not compile", () => {
    const env = envWith({ "autumn.pf": "at 20 fire shell.999 from pad.a" });
    expect(rehearse(env)).toBe(EXIT_SHOW_PROBLEM);
  });
});

describe("continuity --after", () => {
  it("passes a walk on which every match burnt", () => {
    verifyExpect();
    const env = envWith();
    expect(afterWalk(env)).toBe(EXIT_OK);
    expect(env.stdout.length).toBeGreaterThan(0);
  });

  it("works without the first walk", () => {
    const env = envWith();
    expect(afterWalk(env)).toBe(EXIT_OK);
    expect(env.stderr).not.toContain("needs --walk");
  });

  it("fails when a show pin still reads connected", () => {
    const env = envWith({
      "after.csv": ["pin,state", "01.01,open", "01.02,ok", "02.01,open"].join(
        "\n",
      ),
    });
    expect(afterWalk(env)).toBe(EXIT_SHOW_PROBLEM);
  });

  it("fails when a show pin was never walked", () => {
    const env = envWith({
      "after.csv": ["pin,state", "01.01,open", "02.01,open"].join("\n"),
    });
    expect(afterWalk(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("warning");
  });

  it("fails on a dead cue found with both walks, as an error", () => {
    verifyExpect();
    const env = envWith({
      "walk.csv": ["pin,state", "01.01,ok", "01.02,open", "02.01,ok"].join(
        "\n",
      ),
      "after.csv": ["pin,state", "01.01,open", "01.02,ok", "02.01,open"].join(
        "\n",
      ),
    });
    expect(afterWalk(env, "--walk", "walk.csv")).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
  });

  it("fails on a burnt stray found with both walks", () => {
    const env = envWith({
      "walk.csv": [
        "pin,state",
        "01.01,ok",
        "01.02,ok",
        "02.01,ok",
        "02.05,ok",
      ].join("\n"),
      "after.csv": [
        "pin,state",
        "01.01,open",
        "01.02,open",
        "02.01,open",
        "02.05,open",
      ].join("\n"),
    });
    expect(afterWalk(env, "--walk", "walk.csv")).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("error");
  });

  it("does not call that stray burnt without the first walk", () => {
    const env = envWith({
      "after.csv": [
        "pin,state",
        "01.01,open",
        "01.02,open",
        "02.01,open",
        "02.05,open",
      ].join("\n"),
    });
    expect(afterWalk(env)).toBe(EXIT_OK);
  });

  it("plans a refire only onto a pin the after walk read open", () => {
    verifyExpect();
    const env = envWith({
      "after.csv": [
        "pin,state",
        "01.01,open",
        "01.02,open",
        "02.01,ok",
        "02.02,ok",
        "02.03,ok",
        "02.04,open",
      ].join("\n"),
    });
    expect(afterWalk(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stdout).toContain("02.04");
    expect(env.stdout).not.toContain("02.02");
    expect(env.stdout).not.toContain("02.03");
  });

  it("plans no refire onto a pin nobody walked", () => {
    const env = envWith({
      "after.csv": ["pin,state", "01.01,open", "01.02,open", "02.01,ok"].join(
        "\n",
      ),
    });
    expect(afterWalk(env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stdout).not.toContain("02.02");
  });

  it("reports an after walk it cannot read", () => {
    const env = envWith();
    expect(
      main(["continuity", "autumn.pf", "--after", "gone.csv", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).not.toContain("unknown flag");
  });

  it("stops on an after walk that will not parse", () => {
    const env = envWith({ "after.csv": "a,b\n1,2" });
    expect(afterWalk(env)).toBe(EXIT_SHOW_PROBLEM);
  });

  it("refuses to read a walk against a show that does not compile", () => {
    const env = envWith({ "autumn.pf": "at 20 fire shell.999 from pad.a" });
    expect(afterWalk(env)).toBe(EXIT_SHOW_PROBLEM);
  });
});
