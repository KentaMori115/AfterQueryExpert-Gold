import { verifyExpect } from "../helpers/expectGuard.js";
import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/cli/command.js";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { buildCommands } from "../../src/cli/registry.js";

/** The magazine flags on the show commands, against a book one shell short. */

const FILES = {
  "house.csv": [
    "id,kind,name,calibre,break,hang",
    "shell.150.palm,shell,six palm,150mm,palm,2.6",
    "shell.150.willow,shell,six willow,150mm,willow,3.4",
    "shell.160.ring,shell,ring,160mm,ring,2.0",
    "shell.75.peony,shell,three peony,75mm,peony,1.8",
  ].join("\n"),
  "field.rig": [
    "position pad.a at -40 0",
    "position pad.b at 40 0",
    "module 1 fc-32 at pad.a",
    "module 2 fc-32 at pad.b",
  ].join("\n"),
  "show.pf": [
    "show meadow",
    "at 10 fire shell.150.palm from pad.a label opener",
    "at 20 fire shell.150.palm from pad.a",
    "at 30 fire shell.150.palm from pad.b",
    "at 40 fire shell.75.peony from pad.b",
  ].join("\n"),
  "book.csv": [
    "lot,effect,quantity,received",
    "vn2,shell.150.palm,1,2025-02-01",
    "vn1,shell.150.palm,1,2025-01-01",
    "vn3,shell.150.willow,4,2025-01-01",
    "vn4,shell.75.peony,4,2025-01-01",
  ].join("\n"),
  "thin.csv": [
    "lot,effect,quantity,received",
    "vn1,shell.150.palm,1,2025-01-01",
    "vn4,shell.75.peony,4,2025-01-01",
  ].join("\n"),
  "bare.csv": "lot,effect,quantity,received\n",
  "old.pf": ["show meadow", "at 10 fire shell.150.palm from pad.a"].join("\n"),
  "walk.csv": "address,state\n1.1,connected\n",
};

const BASE = ["--catalog", "house.csv", "--rig", "field.rig"];
const commands = buildCommands();

/** Run one command on the fixture show, with the book and any extra flags. */
function run(command: string, book?: string, ...extra: string[]) {
  const env = new MemoryEnv(FILES);
  const argv = [command, "show.pf", ...BASE, ...extra];
  if (book !== undefined) {
    argv.push("--magazine", book);
  }
  const code = runCommand(commands, argv, env);
  return { code, out: env.stdout, err: env.stderr };
}

/** The cue rows of a sheet: a cue number followed by a fire time. */
function rowsOf(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^\s*\d+\s+\d+:\d\d\.\d{3}/.test(line));
}

function headerOf(text: string): string {
  return text.split("\n").find((line) => line.startsWith("cue")) ?? "";
}

describe("check --magazine", () => {
  it("is ready when every shortfall has an exact stand-in", () => {
    verifyExpect();
    const { code, out, err } = run("check", "book.csv");
    expect(code).toBe(EXIT_OK);
    expect(out).toContain("ready");
    expect(err).toContain("PF1601");
    expect(err).not.toContain("PF1600");
  });

  it("fails the show when a cue has nothing to fire", () => {
    const { code, out, err } = run("check", "thin.csv");
    expect(code).toBe(EXIT_SHOW_PROBLEM);
    expect(err).toContain("PF1600");
    expect(out).toContain("not ready");
  });

  it("says nothing about stock until a magazine is given", () => {
    const bare = run("check");
    expect(bare.code).toBe(EXIT_OK);
    expect(bare.err).not.toMatch(/PF160[0-2]/);
    expect(run("check", "thin.csv").err).toContain("PF1600");
  });
});

describe("--pull", () => {
  it("leaves nothing to cover the palms once the willow lot is pulled", () => {
    verifyExpect();
    const { code, err } = run("check", "book.csv", "--pull", "vn3");
    expect(code).toBe(EXIT_SHOW_PROBLEM);
    expect(err).toContain("PF1600");
    expect(err).not.toContain("PF1601");
  });

  it("takes several lots, comma separated", () => {
    const { out } = run("sheet", "book.csv", "--pull", "vn1,vn2");
    const rows = rowsOf(out);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.includes("vn3"))).toHaveLength(3);
    expect(out).not.toContain("vn1");
    expect(out).not.toContain("vn2");
  });
});

describe("sheet --magazine", () => {
  it("shows which delivery each cue fires from", () => {
    verifyExpect();
    const { code, out } = run("sheet", "book.csv");
    expect(code).toBe(EXIT_OK);
    expect(headerOf(out)).toContain("lot");
    const rows = rowsOf(out);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("opener");
    expect(rows[0]).toContain("vn1");
    expect(rows[1]).toContain("vn2");
    expect(rows[2]).toContain("6in willow");
    expect(rows[2]).toContain("vn3");
    expect(rows[3]).toContain("vn4");
  });

  it("leaves the lot blank on a cue nothing covered", () => {
    const rows = rowsOf(run("sheet", "thin.csv").out);
    expect(rows[0]).toContain("vn1");
    expect(rows[1]).toContain("6in palm");
    expect(rows[1]).not.toContain("vn");
    expect(rows[3]).toContain("vn4");
  });

  it("keeps the column, every cell empty, for a book holding nothing", () => {
    const { code, out } = run("sheet", "bare.csv");
    expect(code).toBe(EXIT_SHOW_PROBLEM);
    expect(headerOf(out)).toContain("lot");
    const rows = rowsOf(out);
    expect(rows).toHaveLength(4);
    expect(rows.some((row) => /vn\d/.test(row))).toBe(false);
  });
});

describe("inventory --magazine", () => {
  it("keeps the shortfall on the order list after a stand-in covers it", () => {
    verifyExpect();
    const { code, out } = run("inventory", "book.csv");
    expect(code).not.toBe(EXIT_OK);
    const palm = out
      .split("\n")
      .find((line) => line.startsWith("shell.150.palm"));
    expect(palm?.split(/\s+/)).toEqual(["shell.150.palm", "3", "2", "1"]);
    expect(out).not.toMatch(/^shell\.150\.willow\s+\d/m);
    const below = out.slice(out.indexOf("shell.150.palm"));
    expect(below).toMatch(/shell\.150\.willow\D+1\b/);
    expect(below).toMatch(/shell\.150\.willow.*vn3|vn3.*shell\.150\.willow/);
  });
});

describe("explain --magazine", () => {
  it("names the lot and what the script asked for on a covered cue", () => {
    const { out } = run("explain", "book.csv", "3");
    expect(out).toContain("shell.150.willow");
    expect(out).toContain("vn3");
    expect(out).toContain("shell.150.palm");
  });
});

describe("every show command", () => {
  it("takes the flags wherever the catalog flag is taken", () => {
    verifyExpect();
    const readers = commands
      .all()
      .filter((command) => command.flags.some((f) => f.name === "catalog"));
    expect(readers.length).toBeGreaterThan(10);
    for (const command of readers) {
      const names = command.flags.map((flag) => flag.name);
      expect(names, command.name).toContain("magazine");
      expect(names, command.name).toContain("pull");
    }
  });

  it("puts the stand-in in front of whatever reads the compile", () => {
    const seen: [string, string[], string][] = [
      ["explain", ["3"], "vn3"],
      ["pack", [], "vn3"],
      ["permit", ["--audience", "300"], "shell.150.willow"],
      ["preview", [], "6in willow"],
      ["diff", ["--against", "old.pf"], "shell.150.willow"],
    ];
    for (const [command, extra, fragment] of seen) {
      const { code, out } = run(command, "book.csv", ...extra);
      expect(code, command).not.toBe(EXIT_BAD_USAGE);
      expect(out, command).toContain(fragment);
    }
  });

  it("fails the quiet commands too once a pull leaves a cue bare", () => {
    const quiet: [string, string[]][] = [
      ["rehearse", []],
      ["layout", []],
      ["annotate", []],
      ["plan", ["--audience", "300"]],
      ["continuity", ["--walk", "walk.csv"]],
    ];
    for (const [command, extra] of quiet) {
      expect(run(command, "book.csv", ...extra).code, command).toBe(EXIT_OK);
      const pulled = run(command, "book.csv", ...extra, "--pull", "vn3");
      expect(pulled.code, command).toBe(EXIT_SHOW_PROBLEM);
    }
  });
});

describe("table --magazine", () => {
  it("loads the panel with what will really fire", () => {
    verifyExpect();
    const { code, out } = run("table", "book.csv");
    expect(code).toBe(EXIT_OK);
    const lines = out.split("\n");
    expect(lines[1]).toContain("shell.150.palm");
    expect(lines[3]).toContain("shell.150.willow");
  });
});
