/**
 * The rules the library keeps about itself.
 *
 * Not arithmetic: these are the things that would let the arithmetic rot
 * quietly. A module that reads the clock or the network cannot be
 * tested, a module that opens a file from inside the library cannot be
 * reasoned about, and a directory without a barrel is a directory whose
 * contents nobody can find.
 *
 * They are cheap to keep and expensive to recover, which is the whole
 * argument for testing them at all.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(from: string): string[] {
  const out: string[] = [];
  for (const each of readdirSync(from)) {
    const path = join(from, each);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const sources = walk("src");
const read = new Map(sources.map((each) => [each, readFileSync(each, "utf8")]));

describe("what the library will not do", () => {
  it("never reads the clock", () => {
    for (const [path, text] of read) {
      expect(text.includes("new Date("), path).toBe(false);
      expect(text.includes("Date.now("), path).toBe(false);
    }
  });

  it("never uses a random number", () => {
    for (const [path, text] of read) {
      expect(text.includes("Math.random"), path).toBe(false);
    }
  });

  it("never opens the network", () => {
    for (const [path, text] of read) {
      expect(text.includes("fetch("), path).toBe(false);
      expect(text.includes("node:http"), path).toBe(false);
    }
  });

  it("opens a file only in the commands that read a winder file", () => {
    for (const [path, text] of read) {
      if (!text.includes("node:fs")) continue;
      expect(path.startsWith(join("src", "cli", "commands")), path).toBe(true);
    }
  });

  it("prints only from the command line's own entry point", () => {
    for (const [path, text] of read) {
      if (!text.includes("console.log")) continue;
      expect(path, path).toBe(join("src", "cli", "main.ts"));
    }
  });

  it("has no runtime dependencies at all", () => {
    const one = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(one.dependencies).length).toBe(0);
  });
});

describe("how the library is laid out", () => {
  it("gives every directory a barrel", () => {
    const directories = new Set(sources.map((each) => each.slice(0, each.lastIndexOf("/"))));
    for (const each of directories) {
      expect(sources.includes(join(each, "index.ts")), each).toBe(true);
    }
  });

  it("names every namespace in the root barrel", () => {
    const barrel = read.get(join("src", "index.ts")) as string;
    const directories = readdirSync("src").filter((each) => statSync(join("src", each)).isDirectory());
    for (const each of directories) {
      expect(barrel.includes(`from "./${each}/index.ts"`), each).toBe(true);
    }
  });

  it("throws one kind of error and no other", () => {
    for (const [path, text] of read) {
      if (path.endsWith("errors.ts")) continue;
      const thrown = text.match(/throw new (\w+)/g) ?? [];
      for (const each of thrown) {
        expect(each, path).toBe("throw new WindingError");
      }
    }
  });

  it("gives every error a quantity to name what was wrong", () => {
    const errors = read.get(join("src", "errors.ts")) as string;
    expect(errors).toContain("readonly quantity");
  });

  it("writes every import with its extension, as the resolver wants", () => {
    for (const [path, text] of read) {
      for (const each of text.match(/from "\.[^"]+"/g) ?? []) {
        expect(each.endsWith('.ts"'), `${path}: ${each}`).toBe(true);
      }
    }
  });

  it("keeps every source file a readable length", () => {
    for (const [path, text] of read) {
      expect(text.split("\n").length, path).toBeLessThan(700);
    }
  });

  it("documents every exported function", () => {
    for (const [path, text] of read) {
      if (path.endsWith("index.ts")) continue;
      const lines = text.split("\n");
      lines.forEach((each, at) => {
        if (!each.startsWith("export function ")) return;
        const before = (lines[at - 1] ?? "").trim();
        expect(before === "*/" || before.startsWith("/**"), `${path}:${at + 1}`).toBe(true);
      });
    }
  });

  it("documents every exported constant", () => {
    for (const [path, text] of read) {
      if (path.endsWith("index.ts")) continue;
      const lines = text.split("\n");
      lines.forEach((each, at) => {
        if (!each.startsWith("export const ")) return;
        const before = (lines[at - 1] ?? "").trim();
        expect(before === "*/" || before.startsWith("/**"), `${path}:${at + 1}`).toBe(true);
      });
    }
  });
});
