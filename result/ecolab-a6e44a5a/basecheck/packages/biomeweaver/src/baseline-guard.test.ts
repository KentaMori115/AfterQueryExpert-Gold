import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (entry === "dist" || entry === "node_modules") {
        continue;
      }
      walk(absolute, files);
      continue;
    }
    if (absolute.endsWith("baseline-guard.test.ts")) {
      continue;
    }
    if (absolute.endsWith(".ts") || absolute.endsWith(".md")) {
      files.push(absolute);
    }
  }
}

describe("baseline protection", () => {
  it("does not ship dormant future Gold-task algorithms", () => {
    const files: string[] = [];
    walk(join(process.cwd(), "packages"), files);
    const joined = files.map((file) => readFileSync(file, "utf8")).join("\n");
    const forbidden = [
      "in-" + "transit cohort",
      "collapse" + " proof",
      "colonization" + " state",
      "health" + " cohort",
      "genotype" + " cohort",
      "intervention" + " core",
      "dynamic carrying" + " capacity",
      "minimal" + " intervention",
    ];
    for (const phrase of forbidden) {
      expect(joined.toLowerCase().includes(phrase)).toBe(false);
    }
  });
});
