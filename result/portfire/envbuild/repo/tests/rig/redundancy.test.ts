import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import {
  carriesWeight,
  checkRedundancy,
  defaultCandidates,
  describeRedundancy,
  doubledCount,
  planRedundancy,
  redundancyCost,
  sameModuleBackups,
  shouldDouble,
  unprotected,
} from "../../src/rig/redundancy.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm } from "../../src/core/units.js";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";

const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
  shell({
    id: effectId("shell.300"),
    name: "twelve",
    calibre: calibre(mm(300)),
  }),
]);

function rigOf(modules: number, model = "fc-16"): Rig {
  return Rig.from(
    [firingPosition(positionId("pad.a"), 0, 0)],
    Array.from({ length: modules }, (_, i) =>
      firingModule(i + 1, modelNamed(model)!, positionId("pad.a")),
    ),
  );
}

function assignmentsFor(source: string, rig: Rig, packTight = true) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  expect(resolved.diagnostics.errorCount).toBe(0);
  return allocatePins(resolved.shots, rig, { packTight }).assignments;
}

describe("shouldDouble", () => {
  const rig = rigOf(2);

  it("doubles a large shell by default", () => {
    const [big] = assignmentsFor("at 20 fire shell.300 from pad.a", rig);
    expect(shouldDouble(big!)).toBe(true);
  });

  it("leaves a small one alone", () => {
    const [small] = assignmentsFor("at 20 fire shell.75 from pad.a", rig);
    expect(shouldDouble(small!)).toBe(false);
  });

  it("takes another bore threshold", () => {
    const [small] = assignmentsFor("at 20 fire shell.75 from pad.a", rig);
    expect(shouldDouble(small!, { fromCalibreMm: 50 })).toBe(true);
  });

  it("doubles an effect named outright", () => {
    const [small] = assignmentsFor("at 20 fire shell.75 from pad.a", rig);
    expect(shouldDouble(small!, { always: ["shell.75"] })).toBe(true);
  });

  it("doubles a cue by its label", () => {
    const [cue] = assignmentsFor(
      "at 20 fire shell.75 from pad.a label opener",
      rig,
    );
    expect(shouldDouble(cue!, { labels: ["opener"] })).toBe(true);
  });

  it("lets never win over the other rules", () => {
    const [big] = assignmentsFor("at 20 fire shell.300 from pad.a", rig);
    expect(
      shouldDouble(big!, { always: ["shell.300"], never: ["shell.300"] }),
    ).toBe(false);
  });
});

describe("planRedundancy", () => {
  it("gives a large shell a second pin", () => {
    const rig = rigOf(2);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.300 from pad.a", rig),
      rig,
    );
    expect(plans[0]?.backup).toBeDefined();
    expect(doubledCount(plans)).toBe(1);
  });

  it("leaves a small shell with one", () => {
    const rig = rigOf(2);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.75 from pad.a", rig),
      rig,
    );
    expect(plans[0]?.backup).toBeUndefined();
    expect(plans[0]?.reason).toBeUndefined();
  });

  it("prefers a different module for the backup", () => {
    const rig = rigOf(2);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.300 from pad.a", rig),
      rig,
    );
    expect(plans[0]?.backup?.module).not.toBe(plans[0]?.primary.module);
    expect(sameModuleBackups(plans)).toEqual([]);
  });

  it("falls back to the same module when there is only one", () => {
    const rig = rigOf(1);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.300 from pad.a", rig),
      rig,
    );
    expect(plans[0]?.backup?.module).toBe(1);
    expect(sameModuleBackups(plans)).toHaveLength(1);
  });

  it("never gives two cues the same backup pin", () => {
    const rig = rigOf(3);
    const plans = planRedundancy(
      assignmentsFor("at 20 ripple 6 of shell.300 from pad.a every 1s", rig),
      rig,
    );
    const pins = plans
      .flatMap((plan) => [plan.primary, plan.backup])
      .filter((pin) => pin !== undefined)
      .map((pin) => `${pin.module}:${pin.pin}`);
    expect(new Set(pins).size).toBe(pins.length);
  });

  it("says when there is nowhere left to put a backup", () => {
    const rig = rigOf(1);
    const plans = planRedundancy(
      assignmentsFor("at 20 ripple 16 of shell.300 from pad.a every 1s", rig),
      rig,
    );
    expect(unprotected(plans).length).toBeGreaterThan(0);
    expect(unprotected(plans)[0]?.reason).toContain("no free pin");
  });

  it("plans nothing for a show with no cues", () => {
    const rig = rigOf(2);
    expect(planRedundancy([], rig)).toEqual([]);
  });
});

describe("checkRedundancy", () => {
  it("says nothing about a fully protected show", () => {
    const rig = rigOf(2);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.300 from pad.a", rig),
      rig,
    );
    expect(checkRedundancy(plans).size).toBe(0);
  });

  it("warns about a cue it could not protect", () => {
    const rig = rigOf(1);
    const plans = planRedundancy(
      assignmentsFor("at 20 ripple 16 of shell.300 from pad.a every 1s", rig),
      rig,
    );
    expect(checkRedundancy(plans).byCode("PF1550").length).toBeGreaterThan(0);
  });

  it("notes a backup sharing a module with its primary", () => {
    const rig = rigOf(1);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.300 from pad.a", rig),
      rig,
    );
    expect(checkRedundancy(plans).byCode("PF1551")[0]?.help).toContain(
      "not a module failing",
    );
  });
});

describe("cost", () => {
  it("counts the extra pins and where they go", () => {
    const rig = rigOf(3);
    const plans = planRedundancy(
      assignmentsFor("at 20 ripple 4 of shell.300 from pad.a every 1s", rig),
      rig,
    );
    const cost = redundancyCost(plans);
    expect(cost.extraPins).toBe(4);
    expect(cost.byPosition.get("pad.a")).toBe(4);
  });

  it("costs nothing when nothing is doubled", () => {
    const rig = rigOf(2);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.75 from pad.a", rig),
      rig,
    );
    expect(redundancyCost(plans).extraPins).toBe(0);
  });
});

describe("reports", () => {
  it("lists the doubled cues", () => {
    const rig = rigOf(2);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.300 from pad.a", rig),
      rig,
    );
    expect(describeRedundancy(plans)).toContain("shell.300");
    expect(describeRedundancy(plans)).toContain("backup");
  });

  it("marks a backup on the same module", () => {
    const rig = rigOf(1);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.300 from pad.a", rig),
      rig,
    );
    expect(describeRedundancy(plans)).toContain("same module");
  });

  it("says so when nothing is doubled", () => {
    const rig = rigOf(2);
    const plans = planRedundancy(
      assignmentsFor("at 20 fire shell.75 from pad.a", rig),
      rig,
    );
    expect(describeRedundancy(plans)).toBe("nothing in this show is doubled");
  });

  it("names the effects the default rule would double", () => {
    const rig = rigOf(2);
    const assignments = assignmentsFor(
      [
        "at 20 fire shell.300 from pad.a",
        "at 30 fire shell.75 from pad.a",
      ].join("\n"),
      rig,
    );
    expect(defaultCandidates(assignments)).toEqual(["shell.300"]);
  });

  it("agrees with carriesWeight on a shell", () => {
    const rig = rigOf(2);
    const [big] = assignmentsFor("at 20 fire shell.300 from pad.a", rig);
    const [small] = assignmentsFor("at 20 fire shell.75 from pad.a", rig);
    expect(carriesWeight(big!)).toBe(true);
    expect(carriesWeight(small!)).toBe(false);
  });
});

describe("the double command", () => {
  const CATALOG = [
    "id,kind,name,calibre",
    "shell.75,shell,three,75mm",
    "shell.300,shell,twelve,300mm",
  ].join("\n");
  const RIG = [
    "position pad.a at 0 0",
    "module 1 fc-32 at pad.a",
    "module 2 fc-32 at pad.a",
  ].join("\n");
  const SHOW = [
    "show autumn",
    "at 20 fire shell.300 from pad.a label opener",
    "at 30 fire shell.75 from pad.a",
  ].join("\n");
  const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

  function envWith(over: Record<string, string> = {}): MemoryEnv {
    return new MemoryEnv({
      "house.csv": CATALOG,
      "autumn.rig": RIG,
      "autumn.pf": SHOW,
      ...over,
    });
  }

  it("plans a backup for the large shell only", () => {
    const env = envWith();
    expect(main(["double", "autumn.pf", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("1 cue doubled");
    expect(env.stdout).toContain("shell.300");
    expect(env.stdout).not.toContain("shell.75");
  });

  it("takes another bore threshold", () => {
    const env = envWith();
    main(["double", "autumn.pf", "--from", "50", ...base], env);
    expect(env.stdout).toContain("2 cues doubled");
  });

  it("doubles by label", () => {
    const env = envWith();
    main(
      ["double", "autumn.pf", "--from", "999", "--labels", "opener", ...base],
      env,
    );
    expect(env.stdout).toContain("1 cue doubled");
  });

  it("leaves an effect alone when told to", () => {
    const env = envWith();
    main(["double", "autumn.pf", "--never", "shell.300", ...base], env);
    expect(env.stdout).toContain("0 cues doubled");
  });

  it("lists the candidates and stops", () => {
    const env = envWith();
    expect(main(["double", "autumn.pf", "--candidates", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toBe("shell.300");
  });

  it("says so when the rule would catch nothing", () => {
    const env = envWith({ "small.pf": "at 20 fire shell.75 from pad.a" });
    main(["double", "small.pf", "--candidates", ...base], env);
    expect(env.stdout).toContain("would double nothing");
  });

  it("refuses a show that does not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(main(["double", "bad.pf", ...base], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("nothing to double");
  });

  it("refuses a nonsense bore", () => {
    const env = envWith();
    expect(main(["double", "autumn.pf", "--from", "0", ...base], env)).toBe(
      EXIT_BAD_USAGE,
    );
  });

  it("appears in the pack", () => {
    const env = envWith();
    main(["pack", "autumn.pf", ...base], env);
    expect(env.stdout).toContain("doubling");
  });
});
