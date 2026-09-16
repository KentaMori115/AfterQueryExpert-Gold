import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gatherCapsule } from "./gather.js";

function writeCapsule(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "bw-gather-"));
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

const manifest = `
biome: micro
displayName: Micro
calendar: year
defaultScenario: baseline
include:
  regions: regions/*.yaml
  habitats: habitats/*.yaml
  species: species/*.yaml
  resources: resources/*.yaml
  calendars: calendars/*.yaml
  scenarios: scenarios/*.yaml
  events: events/*.yaml
precision:
  scale: 1000000
  rounding: half-even
`;

describe("gatherCapsule", () => {
  it("fingerprints a valid miniature capsule", () => {
    const root = writeCapsule({
      "biomeweaver.yaml": manifest,
      "regions/a.yaml": "kind: region\nid: alpha\nname: Alpha\n",
      "calendars/year.yaml":
        "kind: calendar\nid: year\nseasons:\n  - {id: winter, startTick: 0, endTick: 1}\n",
      "scenarios/baseline.yaml": "kind: scenario\nid: baseline\ndurationTicks: 1\n",
    });
    const gathered = gatherCapsule({ root });
    expect(gathered.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(gathered.documents.map((document) => document.path)).toEqual([
      "calendars/year.yaml",
      "regions/a.yaml",
      "scenarios/baseline.yaml",
    ]);
  });

  it("is unchanged when include files are discovered in a different physical order", () => {
    const files = {
      "biomeweaver.yaml": manifest,
      "regions/b.yaml": "kind: region\nid: beta\nname: Beta\n",
      "regions/a.yaml": "kind: region\nid: alpha\nname: Alpha\n",
      "calendars/year.yaml":
        "kind: calendar\nid: year\nseasons:\n  - {id: winter, startTick: 0, endTick: 1}\n",
      "scenarios/baseline.yaml": "kind: scenario\nid: baseline\ndurationTicks: 1\n",
    };
    const first = gatherCapsule({ root: writeCapsule(files) });
    const second = gatherCapsule({ root: writeCapsule(files) });
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});
