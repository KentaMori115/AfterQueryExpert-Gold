import { describe, expect, it } from "vitest";
import { decodeSpecies, type CompiledBiome, type SpeciesRecord } from "@biomeweaver/biome-model";
import { DEFAULT_SCALE, parseFixed } from "@biomeweaver/fixed-point";
import type { CohortState } from "@biomeweaver/population-engine";
import { applyPredation } from "@biomeweaver/predation-engine";

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

function species(
  id: string,
  options: { predation?: RuleSource[]; maxIntakePerTick?: string } = {},
): SpeciesRecord {
  const record: Record<string, unknown> = {
    id,
    name: id,
    stages: ["juvenile", "adult"],
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
    record["maxIntakePerTick"] = options.maxIntakePerTick;
  }
  const decoded = decodeSpecies(record, `${id}.yaml`, SCALE, []);
  if (!decoded) {
    throw new Error(`${id} did not decode`);
  }
  return decoded;
}

function model(...records: SpeciesRecord[]): CompiledBiome {
  return {
    precision: { scale: SCALE, rounding: "half-even" },
    species: Object.fromEntries(records.map((record) => [record.id, record])),
  } as unknown as CompiledBiome;
}

function cohort(
  id: string,
  stage: string,
  region: string,
  count: string,
  condition: string = "1",
): CohortState {
  return { species: id, stage, region, count: q(count), condition: q(condition), ageTicks: 0 };
}

function takenBy(
  result: ReturnType<typeof applyPredation>,
  predator: string,
  prey: string,
): bigint {
  return result.removals
    .filter((row) => row.rule === `${predator}.predation.${prey}` && row.prey === prey)
    .reduce((sum, row) => sum + row.quantity, 0n);
}

function countOf(result: ReturnType<typeof applyPredation>, id: string, stage: string): bigint {
  return result.cohorts.find((row) => row.species === id && row.stage === stage)?.count ?? -1n;
}

function conditionOf(result: ReturnType<typeof applyPredation>, id: string, stage: string): bigint {
  return result.cohorts.find((row) => row.species === id && row.stage === stage)?.condition ?? -1n;
}

const hare = species("snow-hare");
const beetle = species("dune-beetle");

describe("contested prey", () => {
  it("splits a prey cohort across two predator cohorts in proportion to their asks", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "90"),
      cohort("glass-lynx", "juvenile", "northern-basin", "60"),
      cohort("snow-hare", "adult", "northern-basin", "100"),
    ]);
    expect(result.removals.map((row) => row.quantity)).toEqual([q("60"), q("40")]);
    expect(countOf(result, "snow-hare", "adult")).toBe(0n);
  });

  it("hands a single leftover unit to the first key in order", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "0.000001"),
      cohort("glass-lynx", "juvenile", "northern-basin", "0.000001"),
      cohort("snow-hare", "adult", "northern-basin", "0.000001"),
    ]);
    expect(result.removals).toHaveLength(1);
    expect(result.removals[0]?.quantity).toBe(1n);
    expect(countOf(result, "snow-hare", "adult")).toBe(0n);
  });

  it("walks the remaining units round the claims in key order", () => {
    const first = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const second = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const third = species("marsh-bird", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(first, second, third, hare), [
      cohort("arctic-fox", "adult", "northern-basin", "0.00001"),
      cohort("glass-lynx", "adult", "northern-basin", "0.00001"),
      cohort("marsh-bird", "adult", "northern-basin", "0.00001"),
      cohort("snow-hare", "adult", "northern-basin", "0.000011"),
    ]);
    expect(result.removals.map((row) => row.quantity)).toEqual([4n, 4n, 3n]);
  });

  it("never lets a claim take more than it asked for", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "0.5" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "20"),
      cohort("glass-lynx", "juvenile", "northern-basin", "20"),
      cohort("snow-hare", "adult", "northern-basin", "900"),
    ]);
    expect(result.removals.map((row) => row.quantity)).toEqual([q("10"), q("10")]);
    expect(countOf(result, "snow-hare", "adult")).toBe(q("880"));
    expect(result.pressure[0]?.asked).toBe(q("20"));
  });

  it("settles each region on its own prey", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "90"),
      cohort("arctic-fox", "adult", "northern-basin", "60"),
      cohort("glass-lynx", "adult", "ice-river", "40"),
      cohort("snow-hare", "adult", "northern-basin", "100"),
      cohort("snow-hare", "adult", "ice-river", "400"),
    ]);
    expect(result.pressure.map((row) => `${row.region}:${row.asked}:${row.taken}`)).toEqual([
      "ice-river:40000000:40000000",
      "northern-basin:150000000:100000000",
    ]);
    expect(result.removals.map((row) => `${row.predator}@${row.region}`)).toEqual([
      "arctic-fox@northern-basin",
      "glass-lynx@ice-river",
      "glass-lynx@northern-basin",
    ]);
  });

  it("leaves a cohort nothing hunts exactly as it was", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, hare, beetle), [
      cohort("glass-lynx", "adult", "northern-basin", "10"),
      cohort("snow-hare", "adult", "northern-basin", "100"),
      cohort("dune-beetle", "adult", "ice-river", "700", "0.4"),
    ]);
    expect(countOf(result, "dune-beetle", "adult")).toBe(q("700"));
    expect(conditionOf(result, "dune-beetle", "adult")).toBe(q("0.4"));
    expect(result.removals).toHaveLength(1);
    expect(result.pressure.map((row) => row.prey)).toEqual(["snow-hare"]);
  });
});

describe("intake budgets", () => {
  it("trims a capped predator and leaves the rest of the prey standing", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
      maxIntakePerTick: "0.5",
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "80"),
      cohort("snow-hare", "adult", "northern-basin", "500"),
    ]);
    expect(result.removals.map((row) => row.quantity)).toEqual([q("40")]);
    expect(countOf(result, "snow-hare", "adult")).toBe(q("460"));
  });

  it("hands what a capped predator gave up to the cohort still asking", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
      maxIntakePerTick: "0.444444",
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "90"),
      cohort("arctic-fox", "adult", "northern-basin", "60"),
      cohort("snow-hare", "adult", "northern-basin", "100"),
    ]);
    expect(takenBy(result, "arctic-fox", "snow-hare")).toBe(q("60"));
    expect(takenBy(result, "glass-lynx", "snow-hare")).toBe(q("39.99996"));
    expect(countOf(result, "snow-hare", "adult")).toBe(q("0.00004"));
  });

  it("spends a binding budget where the offers are, not evenly", () => {
    const lynx = species("glass-lynx", {
      predation: [
        { prey: "snow-hare", perPredatorPerTick: "3" },
        { prey: "dune-beetle", perPredatorPerTick: "1" },
      ],
      maxIntakePerTick: "2",
    });
    const result = applyPredation(model(lynx, hare, beetle), [
      cohort("glass-lynx", "adult", "northern-basin", "20"),
      cohort("snow-hare", "adult", "northern-basin", "400"),
      cohort("dune-beetle", "adult", "northern-basin", "400"),
    ]);
    expect(takenBy(result, "glass-lynx", "snow-hare")).toBe(q("30"));
    expect(takenBy(result, "glass-lynx", "dune-beetle")).toBe(q("10"));
  });

  it("takes nothing at all for a cohort capped at zero", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
      maxIntakePerTick: "0",
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "50"),
      cohort("arctic-fox", "adult", "northern-basin", "50"),
      cohort("snow-hare", "adult", "northern-basin", "500"),
    ]);
    expect(result.removals).toHaveLength(1);
    expect(takenBy(result, "arctic-fox", "snow-hare")).toBe(q("50"));
  });

  it("leaves a species without the field held only by its prey", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "4" }],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "50"),
      cohort("arctic-fox", "adult", "northern-basin", "50"),
      cohort("snow-hare", "adult", "northern-basin", "50"),
    ]);
    expect(takenBy(result, "glass-lynx", "snow-hare")).toBe(q("40"));
    expect(takenBy(result, "arctic-fox", "snow-hare")).toBe(q("10"));
  });
});

describe("what a settlement reports", () => {
  it("orders removals on the settlement key", () => {
    const lynx = species("glass-lynx", {
      predation: [
        { prey: "snow-hare", perPredatorPerTick: "1" },
        { prey: "dune-beetle", perPredatorPerTick: "1" },
      ],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare, beetle), [
      cohort("glass-lynx", "adult", "northern-basin", "10"),
      cohort("arctic-fox", "adult", "northern-basin", "10"),
      cohort("snow-hare", "adult", "northern-basin", "400"),
      cohort("dune-beetle", "adult", "northern-basin", "400"),
    ]);
    expect(result.removals.map((row) => `${row.predator}/${row.prey}`)).toEqual([
      "arctic-fox/snow-hare",
      "glass-lynx/dune-beetle",
      "glass-lynx/snow-hare",
    ]);
  });

  it("leaves a claim that took nothing out of the removals", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
      maxIntakePerTick: "0",
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "40"),
      cohort("snow-hare", "adult", "northern-basin", "400"),
    ]);
    expect(result.removals).toEqual([]);
    expect(countOf(result, "snow-hare", "adult")).toBe(q("400"));
  });

  it("reports what a prey cohort was asked for and what it lost", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "90"),
      cohort("arctic-fox", "adult", "northern-basin", "60"),
      cohort("snow-hare", "adult", "northern-basin", "100"),
    ]);
    expect(result.pressure).toEqual([
      {
        prey: "snow-hare",
        stage: "adult",
        region: "northern-basin",
        asked: q("150"),
        taken: q("100"),
      },
    ]);
  });

  it("reports a cohort that was asked for more than it holds even when it is empty", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "25"),
      cohort("snow-hare", "adult", "northern-basin", "0"),
    ]);
    expect(result.pressure).toEqual([
      { prey: "snow-hare", stage: "adult", region: "northern-basin", asked: q("25"), taken: 0n },
    ]);
    expect(result.removals).toEqual([]);
  });

  it("orders the rows by prey cohort", () => {
    const lynx = species("glass-lynx", {
      predation: [
        { prey: "snow-hare", perPredatorPerTick: "1" },
        { prey: "dune-beetle", perPredatorPerTick: "1" },
      ],
    });
    const result = applyPredation(model(lynx, hare, beetle), [
      cohort("glass-lynx", "adult", "northern-basin", "10"),
      cohort("snow-hare", "adult", "northern-basin", "400"),
      cohort("dune-beetle", "adult", "northern-basin", "400"),
    ]);
    expect(result.pressure.map((row) => `${row.prey}:${row.stage}:${row.region}`)).toEqual([
      "dune-beetle:adult:northern-basin",
      "snow-hare:adult:northern-basin",
    ]);
  });

  it("keeps the two stages of one prey species apart", () => {
    const lynx = species("glass-lynx", {
      predation: [
        { prey: "snow-hare", preyStage: "juvenile", perPredatorPerTick: "1" },
        { prey: "snow-hare", perPredatorPerTick: "1" },
      ],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "30"),
      cohort("snow-hare", "adult", "northern-basin", "400"),
      cohort("snow-hare", "juvenile", "northern-basin", "20"),
    ]);
    expect(result.pressure.map((row) => `${row.stage}:${row.taken}`)).toEqual([
      "adult:30000000",
      "juvenile:20000000",
    ]);
    expect(countOf(result, "snow-hare", "juvenile")).toBe(0n);
  });
});

describe("going hungry", () => {
  it("blends a short predator's condition toward the share it got", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "100"),
      cohort("snow-hare", "adult", "northern-basin", "40"),
    ]);
    expect(conditionOf(result, "glass-lynx", "adult")).toBe(q("0.85"));
  });

  it("blends from the condition the cohort arrived with", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "100", "0.5"),
      cohort("snow-hare", "adult", "northern-basin", "40"),
    ]);
    expect(conditionOf(result, "glass-lynx", "adult")).toBe(q("0.475"));
  });

  it("leaves a predator that got everything it asked for alone", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const fox = species("arctic-fox", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
    });
    const result = applyPredation(model(lynx, fox, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "40", "0.6"),
      cohort("arctic-fox", "adult", "northern-basin", "40", "0.6"),
      cohort("snow-hare", "adult", "northern-basin", "400"),
    ]);
    expect(conditionOf(result, "glass-lynx", "adult")).toBe(q("0.6"));
    expect(conditionOf(result, "arctic-fox", "adult")).toBe(q("0.6"));
    expect(result.pressure[0]?.taken).toBe(q("80"));
  });

  it("counts a predator's whole hunt, not one prey at a time", () => {
    const lynx = species("glass-lynx", {
      predation: [
        { prey: "snow-hare", perPredatorPerTick: "1" },
        { prey: "dune-beetle", perPredatorPerTick: "1" },
      ],
    });
    const result = applyPredation(model(lynx, hare, beetle), [
      cohort("glass-lynx", "adult", "northern-basin", "50"),
      cohort("snow-hare", "adult", "northern-basin", "50"),
      cohort("dune-beetle", "adult", "northern-basin", "20"),
    ]);
    expect(conditionOf(result, "glass-lynx", "adult")).toBe(q("0.925"));
  });

  it("lowers a capped predator that stopped short of its ask", () => {
    const lynx = species("glass-lynx", {
      predation: [{ prey: "snow-hare", perPredatorPerTick: "1" }],
      maxIntakePerTick: "0.4",
    });
    const result = applyPredation(model(lynx, hare), [
      cohort("glass-lynx", "adult", "northern-basin", "100"),
      cohort("snow-hare", "adult", "northern-basin", "400"),
    ]);
    expect(conditionOf(result, "glass-lynx", "adult")).toBe(q("0.85"));
  });
});
