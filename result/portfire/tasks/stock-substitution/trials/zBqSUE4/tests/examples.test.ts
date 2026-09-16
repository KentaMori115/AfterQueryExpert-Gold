import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_OK, runCommand } from "../src/cli/command.js";
import { MemoryEnv } from "../src/cli/env.js";
import { buildCommands } from "../src/cli/registry.js";
import { compile } from "../src/compile.js";
import { parseCatalog } from "../src/catalog/parse.js";
import { parseMagazine } from "../src/catalog/magazine.js";
import { validateCatalog } from "../src/catalog/validate.js";
import { parseRig } from "../src/rig/parse.js";
import { loadScript } from "../src/script/include.js";
import { lintScript } from "../src/script/lint.js";
import { raw } from "../src/core/units.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "examples", "autumn");

function read(name: string): string {
  return readFileSync(join(root, name), "utf8");
}

const CATALOG = read("house.csv");
const RIG = read("autumn.rig");
const SHOW = read("show.pf");
const FINALE = read("finale.pf");
const BOOK = read("book.csv");

function envWithExample(): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "show.pf": SHOW,
    "finale.pf": FINALE,
    "book.csv": BOOK,
  });
}

describe("the worked example", () => {
  const catalog = parseCatalog(CATALOG, "house.csv");
  const rig = parseRig(RIG, "autumn.rig");

  it("has a catalog that loads without complaint", () => {
    expect(catalog.diagnostics.size).toBe(0);
    expect(catalog.catalog.size).toBe(13);
  });

  it("has a catalog that passes its own validation", () => {
    const problems = validateCatalog(catalog.catalog);
    expect(problems.hasErrors()).toBe(false);
  });

  it("has a rig that loads without complaint", () => {
    expect(rig.diagnostics.size).toBe(0);
    expect(rig.rig.positionCount).toBe(4);
    expect(rig.rig.moduleCount).toBe(5);
  });

  it("loads across both script files", () => {
    const loaded = loadScript("show.pf", (name) =>
      name === "show.pf" ? SHOW : name === "finale.pf" ? FINALE : undefined,
    );
    expect(loaded.diagnostics.size).toBe(0);
    expect(loaded.files).toEqual(["show.pf", "finale.pf"]);
  });

  it("lints clean apart from notes", () => {
    const loaded = loadScript("show.pf", (name) =>
      name === "show.pf" ? SHOW : name === "finale.pf" ? FINALE : undefined,
    );
    const problems = lintScript(loaded.script);
    expect(problems.errorCount).toBe(0);
    expect(problems.warningCount).toBe(0);
  });

  it("compiles the whole show cleanly across both files", () => {
    const result = compile(SHOW, "show.pf", {
      catalog: catalog.catalog,
      rig: rig.rig,
      read: (name) => (name === "finale.pf" ? FINALE : undefined),
    });
    expect(result.diagnostics.errorCount).toBe(0);
    expect(result.schedule.events.length).toBeGreaterThan(100);
  });

  it("has a magazine book that loads without complaint", () => {
    const book = parseMagazine(BOOK, "book.csv");
    expect(book.diagnostics.size).toBe(0);
    expect(book.magazine.lotCount).toBe(14);
  });

  it("draws the whole show out of that book", () => {
    const result = compile(SHOW, "show.pf", {
      catalog: catalog.catalog,
      rig: rig.rig,
      read: (name) => (name === "finale.pf" ? FINALE : undefined),
      magazine: parseMagazine(BOOK, "book.csv").magazine,
    });
    expect(result.diagnostics.errorCount).toBe(0);
    expect(
      result.schedule.events.every((event) => event.lot !== undefined),
    ).toBe(true);
    // Two of the four cases of palms came in wet, so the sixes stand in.
    expect(result.draw?.substitutions).toEqual([
      {
        wanted: "shell.150.palm",
        used: "shell.150.kamuro",
        quality: "exact",
        count: 2,
        lots: ["vn2412", "vn2412"],
      },
    ]);
  });

  it("does not reach the finale without the include", () => {
    const result = compile(SHOW, "show.pf", {
      catalog: catalog.catalog,
      rig: rig.rig,
    });
    expect(result.diagnostics.byCode("PF2201").length).toBeGreaterThan(0);
  });
});

describe("the example through the command line", () => {
  const commands = buildCommands();
  const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

  it("passes check", () => {
    const env = envWithExample();
    expect(runCommand(commands, ["check", "show.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("ready");
  });

  it("has the shots a four minute show should", () => {
    const env = envWithExample();
    runCommand(commands, ["check", "show.pf", "--stats", ...base], env);
    const cues = /cues\s+(\d+)/.exec(env.stdout)?.[1];
    expect(Number(cues)).toBeGreaterThan(100);
  });

  it("writes a firing table every row of which has an address", () => {
    const env = envWithExample();
    expect(runCommand(commands, ["table", "show.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    const rows = env.stdout.split("\n").slice(1);
    for (const row of rows) {
      expect(row.split(",")[2]).toMatch(/^\d\d\.\d\d$/);
    }
  });

  it("clears the separation rule on a two hundred metre field", () => {
    const env = envWithExample();
    expect(
      runCommand(
        commands,
        ["check", "show.pf", "--audience", "200", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
  });

  it("does not clear it on a fifty metre field", () => {
    const env = envWithExample();
    expect(
      runCommand(
        commands,
        ["check", "show.pf", "--audience", "50", ...base],
        env,
      ),
    ).not.toBe(EXIT_OK);
    expect(env.stderr).toContain("PF4100");
  });

  it("previews without complaint", () => {
    const env = envWithExample();
    expect(runCommand(commands, ["preview", "show.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("one column is");
  });

  it("lays out the racks", () => {
    const env = envWithExample();
    expect(runCommand(commands, ["layout", "show.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("racks");
  });

  it("reports its hazard totals", () => {
    const env = envWithExample();
    expect(runCommand(commands, ["hazard", "show.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("UN0333");
  });

  it("passes check drawn from the magazine book", () => {
    const env = envWithExample();
    expect(
      runCommand(
        commands,
        ["check", "show.pf", "--magazine", "book.csv", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stderr).toContain(
      "shell.150.palm short 2, use shell.150.kamuro",
    );
  });

  it("puts a lot against every cue on the sheet", () => {
    const env = envWithExample();
    expect(
      runCommand(
        commands,
        ["sheet", "show.pf", "--magazine", "book.csv", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("lot");
    expect(env.stdout).toContain("vn2419");
  });

  it("finds what a recalled lot costs the show", () => {
    const env = envWithExample();
    expect(
      runCommand(
        commands,
        [
          "inventory",
          "show.pf",
          "--magazine",
          "book.csv",
          "--pull",
          "vn2406",
          ...base,
        ],
        env,
      ),
    ).not.toBe(EXIT_OK);
    expect(env.stderr).toContain("PF1600");
  });

  it("compiles to the same table twice", () => {
    const first = envWithExample();
    const second = envWithExample();
    runCommand(buildCommands(), ["table", "show.pf", ...base], first);
    runCommand(buildCommands(), ["table", "show.pf", ...base], second);
    expect(first.stdout).toBe(second.stdout);
  });

  it("needs a pre roll for its opening shell", () => {
    const result = compile(SHOW, "show.pf", {
      catalog: parseCatalog(CATALOG, "house.csv").catalog,
      rig: parseRig(RIG, "autumn.rig").rig,
      read: (name) => (name === "finale.pf" ? FINALE : undefined),
    });
    expect(raw(result.preRoll)).toBeGreaterThan(800);
  });
});
