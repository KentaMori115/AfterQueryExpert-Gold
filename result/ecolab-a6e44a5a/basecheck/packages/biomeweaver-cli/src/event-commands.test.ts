import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "./router.js";

const MANIFEST = `biome: flats
displayName: Flats
calendar: flat-year
defaultScenario: baseline
include:
  regions: regions/*.yaml
  resources: resources/*.yaml
  calendars: calendars/*.yaml
  scenarios: scenarios/*.yaml
  events: events/*.yaml
precision:
  scale: 1000000
  rounding: half-even
`;

const CAPSULE: Readonly<Record<string, string>> = {
  "regions/east.yaml": "kind: region\nid: east\nname: East\n",
  "resources/salt.yaml":
    "kind: resource\nid: salt\nname: Salt\nrenewable: false\nrenewalPerTick: 0\n",
  "calendars/flat-year.yaml":
    "kind: calendar\nid: flat-year\nseasons:\n  - id: dry\n    startTick: 0\n    endTick: 9\n",
  "scenarios/baseline.yaml":
    "kind: scenario\nid: baseline\ndurationTicks: 4\ninitialPopulations: []\ninitialResources:\n  - resource: salt\n    region: east\n    quantity: 10\nevents: []\n",
  "events/spring-melt.yaml":
    "kind: event\nid: spring-melt\neffects:\n  - resource: salt\n    region: east\n    quantity: -2\n  - modifier: salt-growth\n    factor: 0.5\n    forTicks: 3\n",
  "events/autumn-flood.yaml":
    "kind: event\nid: autumn-flood\neffects:\n  - resource: salt\n    quantity: 4\n",
};

function capsuleRoot(overrides: Readonly<Record<string, string | null>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "bw-event-cli-"));
  writeFileSync(join(root, "biomeweaver.yaml"), MANIFEST);
  for (const [path, text] of Object.entries({ ...CAPSULE, ...overrides })) {
    if (text === null) {
      continue;
    }
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

const root = capsuleRoot();

function lines(text: string): string[] {
  return text.trim().length === 0 ? [] : text.trim().split("\n");
}

describe("event commands", () => {
  it("lists every authored event in id order", () => {
    const listed = runCommand(["event", "list", "--root", root]);
    expect(listed.exitCode).toBe(0);
    expect(lines(listed.stdout)).toEqual(["autumn-flood", "spring-melt"]);
  });

  it("prints one line for each effect an event carries", () => {
    const shown = runCommand(["event", "show", "spring-melt", "--root", root]);
    expect(shown.exitCode).toBe(0);
    expect(lines(shown.stdout)).toHaveLength(2);
  });

  it("names the resource an effect moves", () => {
    const shown = runCommand(["event", "show", "autumn-flood", "--root", root]);
    expect(lines(shown.stdout)).toHaveLength(1);
    expect(shown.stdout).toContain("salt");
  });

  it("names the modifier an effect scales", () => {
    const shown = runCommand(["event", "show", "spring-melt", "--root", root]);
    expect(shown.stdout).toContain("salt-growth");
  });

  it("refuses an event id the capsule never defines", () => {
    const shown = runCommand(["event", "show", "midsummer-drought", "--root", root]);
    expect(shown.exitCode).toBe(3);
  });

  it("lists nothing for a capsule that authors no event", () => {
    const bare = capsuleRoot({ "events/spring-melt.yaml": null, "events/autumn-flood.yaml": null });
    const listed = runCommand(["event", "list", "--root", bare]);
    expect(listed.exitCode).toBe(0);
    expect(lines(listed.stdout)).toEqual([]);
  });
});
