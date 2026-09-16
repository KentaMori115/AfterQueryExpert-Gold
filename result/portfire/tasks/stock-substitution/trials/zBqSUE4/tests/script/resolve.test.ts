import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import {
  consumption,
  editDistance,
  effectsUsed,
  nearestName,
  resolveShots,
  shotsPerPosition,
} from "../../src/script/resolve.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm } from "../../src/core/units.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";

const fc32 = modelNamed("fc-32")!;

const catalog = Catalog.from([
  shell({
    id: effectId("shell.150.palm"),
    name: "six palm",
    calibre: calibre(mm(150)),
  }),
  shell({
    id: effectId("shell.75.peony"),
    name: "three peony",
    calibre: calibre(mm(75)),
  }),
]);

const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 0),
  ],
  [
    firingModule(1, fc32, positionId("pad.a")),
    firingModule(2, fc32, positionId("pad.b")),
  ],
);

function resolve(source: string) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  return resolveShots(expanded.shots, catalog, rig);
}

describe("editDistance", () => {
  it("is zero for the same string", () => {
    expect(editDistance("palm", "palm")).toBe(0);
  });

  it("counts a substitution, an insertion and a deletion", () => {
    expect(editDistance("palm", "palr")).toBe(1);
    expect(editDistance("palm", "palms")).toBe(1);
    expect(editDistance("palms", "palm")).toBe(1);
  });

  it("gives up past the cap rather than doing the work", () => {
    expect(editDistance("a", "abcdefghij", 4)).toBe(5);
    expect(editDistance("abcdef", "uvwxyz", 4)).toBe(5);
  });
});

describe("nearestName", () => {
  it("finds a near miss", () => {
    expect(nearestName("shell.150.plam", catalog.ids())).toBe("shell.150.palm");
  });

  it("suggests nothing when nothing is close", () => {
    expect(nearestName("rocket", catalog.ids())).toBeUndefined();
  });

  it("suggests nothing from an empty catalog", () => {
    expect(nearestName("shell", [])).toBeUndefined();
  });
});

describe("resolving names", () => {
  it("attaches the effect to the shot", () => {
    const { shots, diagnostics } = resolve(
      "at 12.4 fire shell.150.palm from pad.a",
    );
    expect(diagnostics.size).toBe(0);
    expect(shots[0]?.resolved.name).toBe("six palm");
  });

  it("refuses an effect the catalog does not hold", () => {
    const { shots, diagnostics } = resolve("at 1 fire shell.999 from pad.a");
    expect(shots).toEqual([]);
    expect(diagnostics.byCode("PF2300")).toHaveLength(1);
  });

  it("suggests a near miss on the effect name", () => {
    const { diagnostics } = resolve("at 1 fire shell.150.plam from pad.a");
    expect(diagnostics.byCode("PF2300")[0]?.help).toContain("shell.150.palm");
  });

  it("reports an unknown name once however often it appears", () => {
    const { diagnostics } = resolve(
      ["at 1 fire shell.999 from pad.a", "at 2 fire shell.999 from pad.a"].join(
        "\n",
      ),
    );
    expect(diagnostics.byCode("PF2300")).toHaveLength(1);
  });

  it("refuses a position the rig does not hold", () => {
    const { diagnostics } = resolve("at 1 fire shell.150.palm from pad.z");
    expect(diagnostics.byCode("PF2301")).toHaveLength(1);
  });

  it("suggests a near miss on the position name", () => {
    const { diagnostics } = resolve("at 1 fire shell.150.palm from pad.aa");
    expect(diagnostics.byCode("PF2301")[0]?.help).toContain("pad.a");
  });

  it("keeps resolving after a bad shot", () => {
    const { shots } = resolve(
      [
        "at 1 fire shell.999 from pad.a",
        "at 2 fire shell.150.palm from pad.a",
      ].join("\n"),
    );
    expect(shots).toHaveLength(1);
  });
});

describe("fixed pins", () => {
  it("accepts a pin that exists at the right position", () => {
    const { shots, diagnostics } = resolve(
      "at 1 fire shell.150.palm from pad.a pin 1.04",
    );
    expect(diagnostics.size).toBe(0);
    expect(shots[0]?.fixedPin).toEqual({ module: 1, pin: 4 });
  });

  it("refuses a pin the rig does not have", () => {
    const { diagnostics } = resolve(
      "at 1 fire shell.150.palm from pad.a pin 9.01",
    );
    expect(diagnostics.byCode("PF2302")).toHaveLength(1);
  });

  it("refuses a pin at the wrong position", () => {
    const { diagnostics } = resolve(
      "at 1 fire shell.150.palm from pad.a pin 2.01",
    );
    expect(diagnostics.byCode("PF2303")[0]?.message).toContain("pad.b");
  });

  it("refuses two cues on the same pin", () => {
    const { diagnostics } = resolve(
      [
        "at 1 fire shell.150.palm from pad.a pin 1.04",
        "at 2 fire shell.75.peony from pad.a pin 1.04",
      ].join("\n"),
    );
    expect(diagnostics.byCode("PF2304")[0]?.message).toContain(
      "shell.150.palm",
    );
  });

  it("leaves fixedPin off an auto shot", () => {
    const { shots } = resolve("at 1 fire shell.150.palm from pad.a");
    expect("fixedPin" in (shots[0] ?? {})).toBe(false);
  });
});

describe("summaries", () => {
  const source = [
    "at 1 fire shell.150.palm from pad.a",
    "at 2 fire shell.150.palm from pad.b",
    "at 3 ripple 3 of shell.75.peony from pad.b every 100ms",
  ].join("\n");

  it("lists the effects used in reading order", () => {
    expect(effectsUsed(resolve(source).shots)).toEqual([
      "shell.75.peony",
      "shell.150.palm",
    ]);
  });

  it("counts what the show consumes", () => {
    const counts = consumption(resolve(source).shots);
    expect(counts.get("shell.150.palm")).toBe(2);
    expect(counts.get("shell.75.peony")).toBe(3);
  });

  it("counts the load on each position", () => {
    const counts = shotsPerPosition(resolve(source).shots);
    expect(counts.get("pad.a")).toBe(1);
    expect(counts.get("pad.b")).toBe(4);
  });

  it("counts nothing for an empty show", () => {
    expect(consumption([]).size).toBe(0);
    expect(effectsUsed([])).toEqual([]);
  });
});
