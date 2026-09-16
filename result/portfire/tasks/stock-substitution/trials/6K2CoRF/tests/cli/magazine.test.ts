import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
  runCommand,
} from "../../src/cli/command.js";
import { MemoryEnv, loadWorkspace } from "../../src/cli/env.js";
import { buildCommands } from "../../src/cli/registry.js";
import { parseArgs } from "../../src/cli/args.js";
import { SHOW_FLAGS, pullFromArgs } from "../../src/cli/commands/common.js";

/**
 * Every show command drawing from the book.
 *
 * The flag lives on all of them rather than on `inventory` alone, because the
 * question a crew asks the morning of the show is what the panel should fire
 * out of the stock in the van, and that answer has to come out of `table` and
 * `sheet` as well as out of a count.
 */

const commands = buildCommands();

const CATALOG = [
  "id,kind,name,calibre,break,hang,diameter",
  "shell.75.peony,shell,three inch peony,75mm,peony,1.8,60",
  "shell.75.crossette,shell,three inch crossette,75mm,crossette,1.8,60",
].join("\n");

const RIG = ["position pad.a at 0 0", "module 1 fc-32 at pad.a"].join("\n");

const SHOW = [
  "show autumn",
  "at 10 fire shell.75.peony from pad.a label early",
  "at 11 fire shell.75.peony from pad.a label middle",
  "at 12 fire shell.75.peony from pad.a label late",
].join("\n");

const BOOK = [
  "lot,effect,quantity,received",
  "vn2405,shell.75.peony,1,2025-04-01",
  "vn2413,shell.75.peony,1,2025-05-01",
  "vn3,shell.75.crossette,4,2025-01-01",
].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "a.rig": RIG,
    "show.pf": SHOW,
    "book.csv": BOOK,
    ...over,
  });
}

const base = ["--catalog", "house.csv", "--rig", "a.rig"];

describe("drawing from the book on the command line", () => {
  it("notes the stand in and still passes the show", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "show.pf", ...base, "--magazine", "book.csv"],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stderr).toContain("PF1601");
    expect(env.stderr).toContain("shell.75.crossette stands in for");
  });

  it("sets the lots named by pull aside", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        [
          "check",
          "show.pf",
          ...base,
          "--magazine",
          "book.csv",
          "--pull",
          "vn2405,vn3",
        ],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1600");
    expect(env.stdout).toContain("not ready");
    expect(env.stderr).not.toContain("vn2405");
  });

  it("grows a lot column on the cue sheet once a book is given", () => {
    const withBook = envWith();
    runCommand(
      commands,
      ["sheet", "show.pf", ...base, "--magazine", "book.csv"],
      withBook,
    );
    expect(withBook.stdout).toContain("lot");
    expect(withBook.stdout).toContain("vn2405");

    const without = envWith();
    runCommand(commands, ["sheet", "show.pf", ...base], without);
    expect(without.stdout).not.toContain("vn2405");
    expect(without.stdout.split("\n")[6]).not.toContain("lot");
  });

  it("keeps the lot column even when nothing could be drawn", () => {
    const env = envWith({
      "wrong.csv": ["lot,effect,quantity", "vn1,mine.100,6"].join("\n"),
    });
    runCommand(
      commands,
      ["sheet", "show.pf", ...base, "--magazine", "wrong.csv"],
      env,
    );
    expect(env.stdout).toContain("lot");
    expect(env.stderr).toContain("PF1600");
  });

  it("puts the lot on a per position sheet too", () => {
    const env = envWith();
    runCommand(
      commands,
      [
        "sheet",
        "show.pf",
        ...base,
        "--kind",
        "position",
        "--magazine",
        "book.csv",
      ],
      env,
    );
    expect(env.stdout).toContain("vn2405");
  });

  it("names the lot and the effect the script asked for when explaining a cue", () => {
    const env = envWith();
    runCommand(
      commands,
      ["explain", "show.pf", "late", ...base, "--magazine", "book.csv"],
      env,
    );
    expect(env.stdout).toContain("asked for");
    expect(env.stdout).toContain("shell.75.peony");
    expect(env.stdout).toContain("lot");
    expect(env.stdout).toContain("vn3");
  });

  it("reports a book it cannot read as a mistake in the command", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "show.pf", ...base, "--magazine", "gone.csv"],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("cannot read the magazine book at gone.csv");
  });

  it("draws nothing from a book that will not parse", () => {
    const env = envWith({ "broken.csv": "lot,effect\nvn1,shell.75.peony" });
    expect(
      runCommand(
        commands,
        ["check", "show.pf", ...base, "--magazine", "broken.csv"],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1301");
    expect(env.stderr).not.toContain("PF1601");
  });

  it("says which book it could not read when a workspace loads one directly", () => {
    const workspace = loadWorkspace(envWith(), { magazine: "gone.csv" });
    expect(workspace.magazine).toBeUndefined();
    expect(workspace.diagnostics.byCode("PF5002")).toHaveLength(1);
  });

  it("reads a list of lots to pull, ignoring the gaps", () => {
    const args = parseArgs(["--pull", " VN1 ,,vn2 "], SHOW_FLAGS);
    expect(pullFromArgs(args)).toEqual(["vn1", "vn2"]);
    expect(pullFromArgs(parseArgs([], SHOW_FLAGS))).toEqual([]);
  });
});

describe("inventory against a drawn show", () => {
  it("counts what the script asked for and still fails", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["inventory", "show.pf", ...base, "--magazine", "book.csv"],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.75.peony"));
    expect(line?.trim().split(/\s+/)).toEqual([
      "shell.75.peony",
      "3",
      "2",
      "1",
    ]);
    expect(env.stderr).toContain("short 1 of shell.75.peony");
  });

  it("lists each stand in under the line it covers", () => {
    const env = envWith();
    runCommand(
      commands,
      ["inventory", "show.pf", ...base, "--magazine", "book.csv"],
      env,
    );
    expect(env.stderr).toContain(
      "  shell.75.crossette stands in for 1 shot, from lot vn3",
    );
  });

  it("says when nothing stands in for a shot", () => {
    const env = envWith({
      "thin.csv": ["lot,effect,quantity", "vn1,shell.75.peony,1"].join("\n"),
    });
    runCommand(
      commands,
      ["inventory", "show.pf", ...base, "--magazine", "thin.csv"],
      env,
    );
    expect(env.stderr).toContain("nothing stands in for 2 shots");
  });

  it("says when the show uses every line in the book", () => {
    const env = envWith({
      "tight.csv": ["lot,effect,quantity", "vn1,shell.75.peony,3"].join("\n"),
    });
    expect(
      runCommand(
        commands,
        [
          "inventory",
          "show.pf",
          ...base,
          "--magazine",
          "tight.csv",
          "--unused",
        ],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("every line in the magazine is used");
    expect(env.stdout).toContain("everything on the shot list is in stock");
  });

  it("stops on a book that will not parse", () => {
    const env = envWith({ "broken.csv": "lot,effect\nvn1,shell.75.peony" });
    expect(
      runCommand(
        commands,
        ["inventory", "show.pf", ...base, "--magazine", "broken.csv"],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1301");
  });

  it("counts the shot list with no book at all", () => {
    const env = envWith();
    expect(runCommand(commands, ["inventory", "show.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.75.peony"));
    expect(line?.trim().split(/\s+/)).toEqual(["shell.75.peony", "3"]);
  });
});
