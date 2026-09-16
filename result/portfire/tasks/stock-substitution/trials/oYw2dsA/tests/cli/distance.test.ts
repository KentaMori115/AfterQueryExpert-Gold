import { describe, expect, it } from "vitest";
import { EXIT_BAD_USAGE, EXIT_OK } from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main, VERSION } from "../../src/cli/main.js";
import { pickCalibre } from "../../src/cli/commands/distance.js";
import { raw } from "../../src/core/units.js";

describe("distance", () => {
  it("prints a table of every standard calibre", () => {
    const env = new MemoryEnv();
    expect(main(["distance"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("bore");
    expect(env.stdout).toContain("150mm");
    expect(env.stdout).toContain("400mm");
  });

  it("prints one row for a calibre it was given", () => {
    const env = new MemoryEnv();
    main(["distance", "6in"], env);
    const rows = env.stdout.split("\n").filter((line) => line.includes("mm"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("152mm");
  });

  it("reads a metric calibre too", () => {
    const env = new MemoryEnv();
    main(["distance", "150mm"], env);
    expect(env.stdout).toContain("150mm");
    expect(env.stdout).toContain("128m");
  });

  it("refuses something that is not a calibre", () => {
    const env = new MemoryEnv();
    expect(main(["distance", "large"], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("150mm or 6in");
  });

  it("shows the flight times as well as the distance", () => {
    const env = new MemoryEnv();
    main(["distance", "150mm"], env);
    expect(env.stdout).toContain("4.00s");
    expect(env.stdout).toContain("4.03s");
  });

  it("adds feet on request", () => {
    const env = new MemoryEnv();
    main(["distance", "150mm", "--feet"], env);
    expect(env.stdout).toContain("420ft");
  });

  it("uses another rule when asked", () => {
    const env = new MemoryEnv();
    main(["distance", "150mm", "--rule", "cen-category-4"], env);
    expect(env.stdout).toContain("125m");
  });

  it("marks the bores that need a written justification", () => {
    const env = new MemoryEnv();
    main(["distance"], env);
    const six = env.stdout.split("\n").find((line) => line.startsWith("150mm"));
    const three = env.stdout
      .split("\n")
      .find((line) => line.startsWith("75mm"));
    expect(six).toContain("justify");
    expect(three).not.toContain("justify");
  });
});

describe("distance --available", () => {
  it("says what a field can take", () => {
    const env = new MemoryEnv();
    expect(main(["distance", "--available", "130"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("takes up to");
  });

  it("says when a field can take nothing", () => {
    const env = new MemoryEnv();
    main(["distance", "--available", "3"], env);
    expect(env.stdout).toContain("not enough room");
  });

  it("allows more under the reduced rule", () => {
    const tight = new MemoryEnv();
    const loose = new MemoryEnv();
    main(["distance", "--available", "130"], tight);
    main(["distance", "--available", "130", "--rule", "reduced"], loose);
    expect(tight.stdout).not.toBe(loose.stdout);
  });

  it("refuses a nonsense room figure", () => {
    const env = new MemoryEnv();
    expect(main(["distance", "--available", "lots"], env)).toBe(EXIT_BAD_USAGE);
  });
});

describe("pickCalibre", () => {
  it("picks a bore for a field", () => {
    expect(raw(pickCalibre(130)!.size)).toBeGreaterThan(100);
  });

  it("picks nothing for no room", () => {
    expect(pickCalibre(2)).toBeUndefined();
  });
});

describe("main", () => {
  it("prints help with no arguments and fails", () => {
    const env = new MemoryEnv();
    expect(main([], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stdout).toContain("portfire <command>");
  });

  it("lists every command in help", () => {
    const env = new MemoryEnv();
    main(["help"], env);
    for (const name of ["check", "distance", "inventory", "sheet", "table"]) {
      expect(env.stdout).toContain(name);
    }
  });

  it("carries a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
