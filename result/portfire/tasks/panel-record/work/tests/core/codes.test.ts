import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODE_NOTES,
  CODE_RANGES,
  codeArea,
  explainCode,
  isCode,
  notedCodes,
  numberOfCode,
  rangeOf,
} from "../../src/core/codes.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

function codesInSource(): Set<string> {
  const codes = new Set<string>();
  for (const path of sourceFiles(srcRoot)) {
    if (path.endsWith(join("core", "codes.ts"))) {
      continue;
    }
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/"(PF\d{4})"/g)) {
      const code = match[1];
      if (code !== undefined) {
        codes.add(code);
      }
    }
  }
  return codes;
}

describe("the ranges", () => {
  it("do not overlap and run in order", () => {
    for (let i = 1; i < CODE_RANGES.length; i += 1) {
      const previous = CODE_RANGES[i - 1];
      const current = CODE_RANGES[i];
      expect(previous!.to).toBeLessThan(current!.from);
    }
  });

  it("give every range an area and a meaning", () => {
    for (const range of CODE_RANGES) {
      expect(range.area.length).toBeGreaterThan(3);
      expect(range.meaning.length).toBeGreaterThan(20);
    }
  });
});

describe("every code the source emits", () => {
  const emitted = codesInSource();

  it("finds a good many of them", () => {
    expect(emitted.size).toBeGreaterThan(60);
  });

  it("sits inside a documented range", () => {
    const orphans = [...emitted].filter((code) => rangeOf(code) === undefined);
    expect(orphans).toEqual([]);
  });

  it("has a code shaped like a code", () => {
    for (const code of emitted) {
      expect(isCode(code)).toBe(true);
    }
  });

  it("puts loading codes in the loading range", () => {
    expect(codeArea("PF1002")).toBe("loading");
    expect(codeArea("PF2116")).toBe("script");
    expect(codeArea("PF3100")).toBe("timeline");
    expect(codeArea("PF4100")).toBe("safety");
    expect(codeArea("PF5000")).toBe("workspace");
  });
});

describe("the notes", () => {
  it("only note codes the source actually emits", () => {
    const emitted = codesInSource();
    for (const code of notedCodes()) {
      expect(emitted.has(code)).toBe(true);
    }
  });

  it("say something worth saying", () => {
    for (const [, note] of CODE_NOTES) {
      expect(note.length).toBeGreaterThan(40);
    }
  });
});

describe("lookup", () => {
  it("explains a code with a note", () => {
    const found = explainCode("PF3100");
    expect(found?.area).toBe("timeline");
    expect(found?.note).toContain("firing capacitor");
  });

  it("explains a code without one", () => {
    const found = explainCode("PF3199");
    expect(found?.area).toBe("timeline");
    expect(found?.note).toBeUndefined();
  });

  it("takes a code in lower case", () => {
    expect(explainCode("pf3100")?.code).toBe("PF3100");
  });

  it("refuses something that is not a code", () => {
    expect(explainCode("nonsense")).toBeUndefined();
    expect(explainCode("PF99999")).toBeUndefined();
    expect(numberOfCode("nope")).toBeUndefined();
  });

  it("refuses a code outside every range", () => {
    expect(explainCode("PF9000")).toBeUndefined();
    expect(codeArea("PF9000")).toBe("unknown");
  });
});

describe("the codes command", () => {
  it("lists the ranges by default", () => {
    const env = new MemoryEnv();
    expect(main(["codes"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("PF3000 to PF3999");
    expect(env.stdout).toContain("look one up");
  });

  it("explains a code", () => {
    const env = new MemoryEnv();
    expect(main(["codes", "PF4100"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("PF4100, safety");
    expect(env.stdout).toContain("separation rule");
  });

  it("refuses something that is not a code", () => {
    const env = new MemoryEnv();
    expect(main(["codes", "banana"], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("look like PF3100");
  });

  it("lists every noted code on request", () => {
    const env = new MemoryEnv();
    main(["codes", "--all"], env);
    for (const code of notedCodes()) {
      expect(env.stdout).toContain(code);
    }
  });
});
