import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_BAD_USAGE, EXIT_OK } from "../src/cli/command.js";
import { MemoryEnv } from "../src/cli/env.js";
import { main } from "../src/cli/main.js";
import { buildCommands } from "../src/cli/registry.js";

/**
 * Every command, against the worked example, end to end.
 *
 * The point of this file is not any individual assertion. It is that adding a
 * command without adding it here fails, so no command can quietly stop working
 * on a real show while its own unit tests keep passing on a two cue fixture.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "examples", "autumn");
const read = (name: string): string => readFileSync(join(root, name), "utf8");

const BOOK = read("book.csv");

const WALK = ["pin,state", "01.01,ok"].join("\n");

function env(): MemoryEnv {
  return new MemoryEnv({
    "house.csv": read("house.csv"),
    "autumn.rig": read("autumn.rig"),
    "show.pf": read("show.pf"),
    "finale.pf": read("finale.pf"),
    "book.csv": BOOK,
    "walk.csv": WALK,
  });
}

const SHOW = ["--catalog", "house.csv", "--rig", "autumn.rig"];

interface Run {
  readonly name: string;
  readonly argv: readonly string[];
  /** What standard output must contain for the run to have done its job. */
  readonly says: string;
  readonly ok?: boolean;
}

const RUNS: readonly Run[] = [
  {
    name: "annotate",
    argv: ["annotate", "show.pf", ...SHOW],
    says: "#> fires",
  },
  { name: "check", argv: ["check", "show.pf", ...SHOW], says: "ready" },
  { name: "codes", argv: ["codes", "PF4100"], says: "safety" },
  { name: "completion", argv: ["completion"], says: "complete -F" },
  {
    name: "continuity",
    argv: ["continuity", "show.pf", "--walk", "walk.csv", ...SHOW],
    says: "cues in the show",
    ok: false,
  },
  {
    name: "crowd",
    argv: ["crowd", "--frontage", "300", "--depth", "60", "--expected", "9000"],
    says: "capacity",
  },
  {
    name: "diff",
    argv: ["diff", "show.pf", "--against", "show.pf", ...SHOW],
    says: "nothing changed",
  },
  { name: "distance", argv: ["distance", "150mm"], says: "separation" },
  {
    name: "double",
    argv: ["double", "show.pf", ...SHOW],
    says: "doubled",
  },
  {
    name: "explain",
    argv: ["explain", "show.pf", "1", ...SHOW],
    says: "so the panel fires at",
  },
  { name: "fmt", argv: ["fmt", "show.pf"], says: "at 4.0 fire" },
  {
    name: "hazard",
    argv: ["hazard", "show.pf", ...SHOW],
    says: "net explosive quantity",
  },
  {
    name: "inventory",
    argv: ["inventory", "show.pf", "--magazine", "book.csv", ...SHOW],
    says: "in stock",
  },
  { name: "label", argv: ["label", "show.pf"], says: "label " },
  { name: "layout", argv: ["layout", "show.pf", ...SHOW], says: "racks" },
  { name: "lint", argv: ["lint", "show.pf", "--follow"], says: "0 errors" },
  {
    name: "pack",
    argv: ["pack", "show.pf", ...SHOW],
    says: "summary",
  },
  {
    name: "permit",
    argv: ["permit", "show.pf", "--audience", "200", ...SHOW],
    says: "separation required",
  },
  {
    name: "plan",
    argv: ["plan", "show.pf", "--audience", "200", ...SHOW],
    says: "north is up",
  },
  {
    name: "preview",
    argv: ["preview", "show.pf", ...SHOW],
    says: "one column is",
  },
  {
    name: "rehearse",
    argv: ["rehearse", "show.pf", ...SHOW],
    says: "watch for",
  },
  { name: "sheet", argv: ["sheet", "show.pf", ...SHOW], says: "6in palm" },
  { name: "table", argv: ["table", "show.pf", ...SHOW], says: "cue,time" },
  { name: "version", argv: ["version"], says: "portfire" },
];

describe("every command against the worked example", () => {
  for (const run of RUNS) {
    it(`${run.name} does its job`, () => {
      const box = env();
      const code = main(run.argv, box);
      if (run.ok ?? true) {
        expect(code).toBe(EXIT_OK);
      }
      expect(box.stdout).toContain(run.says);
    });
  }

  it("covers every command the registry holds", () => {
    const covered = new Set(RUNS.map((run) => run.name));
    for (const name of buildCommands().names()) {
      expect(covered.has(name)).toBe(true);
    }
  });

  it("has a run for nothing that is not a command", () => {
    const known = new Set(buildCommands().names());
    for (const run of RUNS) {
      expect(known.has(run.name)).toBe(true);
    }
  });
});

describe("a show drawn out of the book", () => {
  it("draws every cue from a lot and puts it on the sheet", () => {
    const box = env();
    const code = main(
      ["sheet", "show.pf", "--magazine", "book.csv", ...SHOW],
      box,
    );
    expect(code).toBe(EXIT_OK);
    expect(box.stdout).toContain("lot");
    expect(box.stdout).toContain("vn2405");
  });

  it("covers what a recall takes out of the store", () => {
    const box = env();
    main(
      [
        "inventory",
        "show.pf",
        "--magazine",
        "book.csv",
        "--pull",
        "vn2405,vn2413",
        ...SHOW,
      ],
      box,
    );
    expect(box.stderr).toContain("drawn as");
  });

  it("says nothing about lots when no book was named", () => {
    const box = env();
    main(["sheet", "show.pf", ...SHOW], box);
    expect(box.stdout).not.toContain("vn2405");
  });
});

describe("the commands agree with each other", () => {
  it("counts the same cues in check, table and pack", () => {
    const box = env();
    main(["check", "show.pf", "--stats", ...SHOW], box);
    const cues = Number(/cues\s+(\d+)/.exec(box.stdout)?.[1]);

    const table = env();
    main(["table", "show.pf", ...SHOW], table);
    expect(table.stdout.split("\n")).toHaveLength(cues + 1);

    const pack = env();
    main(["pack", "show.pf", ...SHOW], pack);
    expect(pack.stdout).toContain(`cues          ${cues}`);
  });

  it("puts the same first ignition in the sheet and the table", () => {
    const sheet = env();
    main(["sheet", "show.pf", ...SHOW], sheet);
    const table = env();
    main(["table", "show.pf", ...SHOW], table);
    const fromTable = table.stdout.split("\n")[1]?.split(",")[1];
    expect(fromTable).toBeDefined();
    expect(sheet.stdout).toContain(fromTable!);
  });

  it("gives the same verdict on a tight field from check and permit", () => {
    const checked = env();
    const code = main(
      ["check", "show.pf", "--audience", "40", ...SHOW],
      checked,
    );
    expect(code).not.toBe(EXIT_OK);

    const permit = env();
    main(["permit", "show.pf", "--audience", "40", ...SHOW], permit);
    expect(permit.stdout).toContain("clears the rule");
    expect(permit.stdout).toContain("no");
  });
});

describe("every command refuses nonsense the same way", () => {
  const needsScript = [
    "annotate",
    "check",
    "continuity",
    "diff",
    "double",
    "explain",
    "fmt",
    "hazard",
    "inventory",
    "label",
    "layout",
    "lint",
    "pack",
    "permit",
    "plan",
    "preview",
    "rehearse",
    "sheet",
    "table",
  ];

  it("refuses an unknown flag with the usage code", () => {
    for (const name of needsScript) {
      const box = env();
      expect(main([name, "show.pf", "--nonsense", ...SHOW], box)).toBe(
        EXIT_BAD_USAGE,
      );
      expect(box.stderr).toContain("unknown flag");
    }
  });

  it("prints a help screen for every command", () => {
    for (const name of buildCommands().names()) {
      const box = env();
      expect(main(["help", name], box)).toBe(EXIT_OK);
      expect(box.stdout).toContain(`usage: portfire ${name}`);
    }
  });
});
