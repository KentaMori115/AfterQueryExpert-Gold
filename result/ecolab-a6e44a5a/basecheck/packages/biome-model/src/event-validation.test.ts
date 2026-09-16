import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileCapsule } from "./compile.js";

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

const BASE: Readonly<Record<string, string>> = {
  "regions/east.yaml": "kind: region\nid: east\nname: East\n",
  "regions/north.yaml": "kind: region\nid: north\nname: North\n",
  "resources/salt.yaml":
    "kind: resource\nid: salt\nname: Salt\nrenewable: false\nrenewalPerTick: 0\n",
  "calendars/flat-year.yaml":
    "kind: calendar\nid: flat-year\nseasons:\n  - id: dry\n    startTick: 0\n    endTick: 9\n",
  "scenarios/baseline.yaml":
    "kind: scenario\nid: baseline\ndurationTicks: 4\ninitialPopulations: []\ninitialResources:\n  - resource: salt\n    region: east\n    quantity: 10\nevents:\n  - atTick: 1\n    event: disturbance\n",
};

function writeCapsule(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "bw-effect-"));
  writeFileSync(join(root, "biomeweaver.yaml"), MANIFEST);
  for (const [path, text] of Object.entries({ ...BASE, ...files })) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

function event(body: string): Readonly<Record<string, string>> {
  return { "events/disturbance.yaml": `kind: event\nid: disturbance\neffects:\n${body}` };
}

function compileWith(body: string) {
  const compiled = compileCapsule({ root: writeCapsule(event(body)) });
  return {
    model: compiled.model,
    errors: compiled.diagnostics.filter((item) => item.severity === "error"),
  };
}

describe("authored event effects", () => {
  it("accepts an effect that moves a resource in a region it knows", () => {
    const compiled = compileWith("  - resource: salt\n    region: east\n    quantity: -2\n");
    expect(compiled.errors).toEqual([]);
    expect(compiled.model).toBeDefined();
  });

  it("accepts an effect that scales a modifier for several ticks", () => {
    const compiled = compileWith("  - modifier: salt-growth\n    factor: 0.5\n    forTicks: 4\n");
    expect(compiled.errors).toEqual([]);
    expect(compiled.model).toBeDefined();
  });

  it("refuses an effect naming a resource the capsule never defines", () => {
    const compiled = compileWith("  - resource: gravel\n    quantity: -2\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses an effect naming a region the capsule never defines", () => {
    const compiled = compileWith("  - resource: salt\n    region: south\n    quantity: -2\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses an unknown region on a modifier effect too", () => {
    const compiled = compileWith("  - modifier: salt-growth\n    region: south\n    factor: 2\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses a resource carrying no quantity", () => {
    const compiled = compileWith("  - resource: salt\n    region: east\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses a modifier carrying no factor", () => {
    const compiled = compileWith("  - modifier: salt-growth\n    region: east\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses an effect that carries nothing at all", () => {
    const compiled = compileWith("  - region: east\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses an effect that is not a record", () => {
    const compiled = compileWith("  - east\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses a window shorter than one tick", () => {
    const compiled = compileWith("  - resource: salt\n    quantity: -2\n    forTicks: 0\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses a window that is not a whole number of ticks", () => {
    const compiled = compileWith("  - resource: salt\n    quantity: -2\n    forTicks: 1.5\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });

  it("refuses a negative factor", () => {
    const compiled = compileWith("  - modifier: salt-growth\n    factor: -1\n");
    expect(compiled.errors).toHaveLength(1);
    expect(compiled.model).toBeUndefined();
  });
});
