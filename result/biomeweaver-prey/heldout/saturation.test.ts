import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileCapsule,
  decodeSpecies,
  type CompiledBiome,
  type SpeciesRecord,
} from "@biomeweaver/biome-model";
import { DEFAULT_SCALE, parseFixed } from "@biomeweaver/fixed-point";
import type { CohortState } from "@biomeweaver/population-engine";
import { applyPredation } from "@biomeweaver/predation-engine";
import { completeBiome } from "../../../ecosystem-lab/helpers/paths.js";

const SCALE = DEFAULT_SCALE;

function q(value: string): bigint {
  return parseFixed(value, SCALE);
}

type RuleSource = {
  prey: string;
  preyStage?: string;
  perPredatorPerTick: string;
  saturation?: string;
};

function record(
  id: string,
  options: { predation?: RuleSource[]; maxIntakePerTick?: string } = {},
): Record<string, unknown> {
  const built: Record<string, unknown> = {
    id,
    name: id,
    stages: ["adult"],
    initialStage: "adult",
    needs: [],
    mortality: {},
    transitions: [],
    predation: (options.predation ?? []).map((rule) => ({
      prey: rule.prey,
      preyStage: rule.preyStage ?? "adult",
      perPredatorPerTick: rule.perPredatorPerTick,
      ...(rule.saturation === undefined ? {} : { saturation: rule.saturation }),
    })),
  };
  if (options.maxIntakePerTick !== undefined) {
    built["maxIntakePerTick"] = options.maxIntakePerTick;
  }
  return built;
}

function species(
  id: string,
  options: { predation?: RuleSource[]; maxIntakePerTick?: string } = {},
): SpeciesRecord {
  const decoded = decodeSpecies(record(id, options), `${id}.yaml`, SCALE, []);
  if (!decoded) {
    throw new Error(`${id} did not decode`);
  }
  return decoded;
}

function model(...records: SpeciesRecord[]): CompiledBiome {
  return {
    precision: { scale: SCALE, rounding: "half-even" },
    species: Object.fromEntries(records.map((entry) => [entry.id, entry])),
  } as unknown as CompiledBiome;
}

function cohort(id: string, region: string, count: string): CohortState {
  return { species: id, stage: "adult", region, count: q(count), condition: SCALE, ageTicks: 0 };
}

function askedOf(result: ReturnType<typeof applyPredation>, prey: string): bigint {
  return result.pressure.find((row) => row.prey === prey)?.asked ?? -1n;
}

function patchedCapsule(file: string, from: string, to: string): string {
  const root = mkdtempSync(join(tmpdir(), "biomeweaver-"));
  cpSync(completeBiome("crystal-tundra"), root, { recursive: true });
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) {
    throw new Error(`${file} does not carry ${from}`);
  }
  writeFileSync(path, text.replace(from, to));
  return root;
}

const hare = species("snow-hare");

describe("saturated asks", () => {
  it("asks for less than the flat rate where prey are thin", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1", saturation: "50" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "northern-basin", "10"),
      cohort("snow-hare", "northern-basin", "50"),
    ]);
    expect(askedOf(result, "snow-hare")).toBe(q("5"));
    expect(result.removals[0]?.quantity).toBe(q("5"));
  });

  it("asks for the flat rate where prey are plentiful against the same rule", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1", saturation: "0.000001" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "northern-basin", "10"),
      cohort("snow-hare", "northern-basin", "1000000"),
    ]);
    expect(askedOf(result, "snow-hare")).toBe(q("10"));
  });

  it("settles a tie on the even side", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1", saturation: "0.000001" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "northern-basin", "0.000005"),
      cohort("snow-hare", "northern-basin", "0.000001"),
    ]);
    expect(askedOf(result, "snow-hare")).toBe(2n);
  });

  it("settles the other tie away from the odd quotient", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1", saturation: "0.000001" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "northern-basin", "0.000003"),
      cohort("snow-hare", "northern-basin", "0.000001"),
    ]);
    expect(askedOf(result, "snow-hare")).toBe(2n);
  });

  it("rounds the whole product once, not the flat rate and then the share", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "0.643017", saturation: "26" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "northern-basin", "20.5"),
      cohort("snow-hare", "northern-basin", "13"),
    ]);
    expect(askedOf(result, "snow-hare")).toBe(q("4.39395"));
    expect(result.removals[0]?.quantity).toBe(q("4.39395"));
  });

  it("reads the prey standing when the phase began, not what is left mid-settlement", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1", saturation: "100" }],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1", saturation: "100" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "northern-basin", "60"),
      cohort("arctic-fox", "northern-basin", "40"),
      cohort("snow-hare", "northern-basin", "100"),
    ]);
    expect(result.removals.map((row) => `${row.predator}:${row.quantity}`)).toEqual([
      "arctic-fox:20000000",
      "glass-lynx:30000000",
    ]);
    expect(askedOf(result, "snow-hare")).toBe(q("50"));
  });

  it("hunts at the flat rate where a rule saturates at nothing", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "0.5", saturation: "0" }],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "northern-basin", "80"),
      cohort("arctic-fox", "northern-basin", "20"),
      cohort("snow-hare", "northern-basin", "30"),
    ]);
    expect(askedOf(result, "snow-hare")).toBe(q("60"));
    expect(result.removals.map((row) => row.quantity)).toEqual([q("10"), q("20")]);
  });

  it("keeps a rule without the field on the plain product", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "2" }],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "2", saturation: "40" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "northern-basin", "30"),
      cohort("arctic-fox", "northern-basin", "30"),
      cohort("snow-hare", "northern-basin", "40"),
    ]);
    expect(askedOf(result, "snow-hare")).toBe(q("90"));
    expect(result.removals.map((row) => row.quantity)).toEqual([q("13.333334"), q("26.666666")]);
  });
});

describe("authored limits", () => {
  it("turns a negative cap into an error", () => {
    const diagnostics: { severity: string }[] = [];
    decodeSpecies(
      record("glass-lynx", {
        predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
        maxIntakePerTick: "-1",
      }),
      "glass-lynx.yaml",
      SCALE,
      diagnostics,
    );
    expect(diagnostics.filter((item) => item.severity === "error")).toHaveLength(1);
  });

  it("turns a negative saturation into an error", () => {
    const diagnostics: { severity: string }[] = [];
    decodeSpecies(
      record("glass-lynx", {
        predation: [{ prey: "snow-hare", perPredatorPerTick: "1", saturation: "-0.5" }],
      }),
      "glass-lynx.yaml",
      SCALE,
      diagnostics,
    );
    expect(diagnostics.filter((item) => item.severity === "error")).toHaveLength(1);
  });

  it("reads an authored cap out of a capsule", () => {
    const root = patchedCapsule(
      "species/glass-lynx.yaml",
      "mortality:",
      "maxIntakePerTick: 0.05\nmortality:",
    );
    const compiled = compileCapsule({ root });
    expect(compiled.diagnostics).toEqual([]);
    const result = applyPredation(compiled.model!, [
      cohort("glass-lynx", "northern-basin", "80"),
      cohort("snow-hare", "northern-basin", "500"),
    ]);
    expect(result.removals[0]?.quantity).toBe(q("4"));
    expect(result.pressure[0]?.asked).toBe(q("6.4"));
  });

  it("reads an authored saturation out of a capsule", () => {
    const root = patchedCapsule(
      "species/glass-lynx.yaml",
      "perPredatorPerTick: 0.08",
      "perPredatorPerTick: 0.08\n    saturation: 200",
    );
    const compiled = compileCapsule({ root });
    expect(compiled.diagnostics).toEqual([]);
    const result = applyPredation(compiled.model!, [
      cohort("glass-lynx", "northern-basin", "50"),
      cohort("snow-hare", "northern-basin", "600"),
    ]);
    expect(result.pressure[0]?.asked).toBe(q("3"));
  });

  it("says something about a cap on a species that hunts nothing", () => {
    const root = patchedCapsule(
      "species/snow-hare.yaml",
      "mortality:",
      "maxIntakePerTick: 3\nmortality:",
    );
    const compiled = compileCapsule({ root });
    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0]?.severity).not.toBe("error");
    expect(compiled.model?.biome).toBe("crystal-tundra");
  });

  it("leaves a hunting species that names a cap uncomplained about", () => {
    const root = patchedCapsule(
      "species/marsh-bird.yaml",
      "mortality:",
      "maxIntakePerTick: 1\nmortality:",
    );
    const compiled = compileCapsule({ root });
    expect(compiled.diagnostics).toEqual([]);
    const result = applyPredation(compiled.model!, [
      cohort("marsh-bird", "ice-river", "90"),
      cohort("dune-beetle", "ice-river", "1200"),
    ]);
    expect(result.removals[0]?.quantity).toBe(q("18"));
    expect(result.pressure[0]?.asked).toBe(q("18"));
  });
});
