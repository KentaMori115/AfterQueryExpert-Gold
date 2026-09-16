import { describe, expect, it } from "vitest";
import { calibre } from "../src/catalog/calibre.js";
import { shell } from "../src/catalog/effect.js";
import { Catalog } from "../src/catalog/registry.js";
import { parseCatalog } from "../src/catalog/parse.js";
import { substitutesFor } from "../src/catalog/substitute.js";
import { compile } from "../src/compile.js";
import { buildAdjacency, reachableFrom, reverse } from "../src/core/graph.js";
import { effectId, positionId } from "../src/core/ids.js";
import { SourceFile } from "../src/core/span.js";
import { metres, mm, ms, raw } from "../src/core/units.js";
import { sitePlan } from "../src/export/siteplan.js";
import { parseRig } from "../src/rig/parse.js";
import { firingModule, modelNamed } from "../src/rig/module.js";
import { Rig, firingPosition } from "../src/rig/rig.js";
import { boundary, point, site, straightLine } from "../src/safety/site.js";
import { checkAirspace, checkFallout } from "../src/safety/rules.js";
import { expandScript } from "../src/script/expand.js";
import { lex } from "../src/script/token.js";
import { parseScript } from "../src/script/parser.js";
import { resolveShots } from "../src/script/resolve.js";
import { allocatePins } from "../src/rig/allocate.js";
import { buildSchedule } from "../src/timeline/schedule.js";
import { lateralLean, positionShares } from "../src/timeline/balance.js";
import { runCommand as runCliCommand } from "../src/cli/command.js";
import { MemoryEnv } from "../src/cli/env.js";
import { buildCommands as buildCliCommands } from "../src/cli/registry.js";

/**
 * The corners the ordinary tests do not reach.
 *
 * Every case here is a branch that exists for a reason and had no test naming
 * that reason. Several are the empty or single element case of something that
 * normally has many, which is exactly where an off by one hides.
 */

const catalog = Catalog.from([
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
]);
const rig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  [firingModule(1, modelNamed("fc-32")!, positionId("pad.a"))],
);

describe("the parser's less travelled paths", () => {
  function parse(source: string) {
    return parseScript(new SourceFile("s.pf", source));
  }

  it("refuses a name with a bad character in a header", () => {
    expect(parse("show Autumn").diagnostics.byCode("PF2105")).toHaveLength(1);
  });

  it("refuses a group name that is not usable", () => {
    expect(
      parse("group Finale\nend").diagnostics.byCode("PF2105"),
    ).toHaveLength(1);
  });

  it("refuses a group with no name at all", () => {
    expect(parse("group\nend").diagnostics.byCode("PF2104")).toHaveLength(1);
  });

  it("refuses a label that is neither a word nor a string", () => {
    expect(
      parse("at 1 fire a from b label 4").diagnostics.byCode("PF2111"),
    ).toHaveLength(1);
  });

  it("refuses a height that is not a number", () => {
    expect(
      parse("at 1 fire a from b height tall").diagnostics.byCode("PF2110"),
    ).toHaveLength(1);
  });

  it("refuses a negative height", () => {
    expect(
      parse("at 1 fire a from b height -4").diagnostics.byCode("PF2110"),
    ).toHaveLength(1);
  });

  it("refuses a jitter that is not a time", () => {
    expect(
      parse("at 1 ripple 3 of a from b every 1 jitter soon").diagnostics.byCode(
        "PF2107",
      ),
    ).toHaveLength(1);
  });

  it("refuses a pass count that is not a whole number", () => {
    expect(
      parse("at 1 chase a across p q every 1 passes half").diagnostics.byCode(
        "PF2108",
      ),
    ).toHaveLength(1);
  });

  it("refuses an unusable position name in a chase", () => {
    expect(
      parse("at 1 chase a across Pad q every 1").diagnostics.size,
    ).toBeGreaterThan(0);
  });

  it("reads a bare word as a group name in a play", () => {
    expect(parse("at 1 play finale").diagnostics.size).toBe(0);
  });
});

describe("the lexer's corners", () => {
  it("reads a word that starts with an underscore", () => {
    const { tokens } = lex(new SourceFile("s.pf", "_spare"));
    expect(tokens[0]?.kind).toBe("word");
  });

  it("reads a number with no fraction after a colon", () => {
    const { tokens } = lex(new SourceFile("s.pf", "1:23"));
    expect(tokens[0]?.kind).toBe("time");
  });

  it("does not read a minus on its own as a number", () => {
    const { diagnostics } = lex(new SourceFile("s.pf", "-"));
    expect(diagnostics.size).toBeGreaterThan(0);
  });
});

describe("the rig sheet's corners", () => {
  it("refuses a position with an unusable name", () => {
    expect(
      parseRig("position Pad at 0 0", "r.rig").diagnostics.byCode("PF1200"),
    ).toHaveLength(1);
  });

  it("refuses a module with no model at all", () => {
    expect(
      parseRig("module 1 at pad.a", "r.rig").diagnostics.byCode("PF1204"),
    ).toHaveLength(1);
  });

  it("refuses a voltage that is not a number", () => {
    expect(
      parseRig("voltage lots", "r.rig").diagnostics.byCode("PF1209"),
    ).toHaveLength(1);
  });

  it("takes a note on a module and a position at once", () => {
    const parsed = parseRig(
      [
        "position pad.a at 0 0 by the gate",
        "module 1 fc-32 at pad.a spare",
      ].join("\n"),
      "r.rig",
    );
    expect(parsed.rig.position("pad.a")?.note).toBe("by the gate");
    expect(parsed.rig.module(1)?.note).toBe("spare");
  });
});

describe("the catalog reader's corners", () => {
  it("takes a maker on every kind", () => {
    const parsed = parseCatalog(
      [
        "id,kind,name,calibre,shots,interval,duration,style,maker",
        "cake.a,cake,cake,30mm,10,0.2,,,vulcan",
        "mine.a,mine,mine,100mm,,,,,vulcan",
        "gerb.a,ground,gerb,,,,20,gerb,vulcan",
      ].join("\n"),
      "c.csv",
    );
    expect(parsed.diagnostics.hasErrors()).toBe(false);
    for (const effect of parsed.catalog.all()) {
      expect(effect.maker).toBe("vulcan");
    }
  });

  it("falls back to the id when a row has no name", () => {
    const parsed = parseCatalog(
      ["id,kind,name,calibre", "shell.150,shell,,150mm"].join("\n"),
      "c.csv",
    );
    expect(parsed.catalog.get("shell.150")?.name).toBe("shell.150");
  });
});

describe("the small graph cases", () => {
  it("reverses a graph with no edges", () => {
    expect(reverse(buildAdjacency([])).size).toBe(0);
  });

  it("reaches nothing from a node with no edges", () => {
    const graph = buildAdjacency([["a", "b"]]);
    expect(reachableFrom(graph, "b").size).toBe(0);
  });
});

describe("the site plan corners", () => {
  it("draws a rig whose positions all sit at one point", () => {
    const stack = Rig.from(
      [
        firingPosition(positionId("pad.a"), 0, 0),
        firingPosition(positionId("pad.b"), 0, 0),
      ],
      [firingModule(1, modelNamed("fc-32")!, positionId("pad.a"))],
    );
    const field = site(
      "spot",
      straightLine("spectator line", point(0, -10), point(0, -10)),
    );
    expect(() => sitePlan(stack, field)).not.toThrow();
  });

  it("draws a boundary that runs off the frame", () => {
    const field = site(
      "long",
      straightLine("spectator line", point(-9000, -50), point(9000, -50)),
      [boundary("river", [point(-9000, 40), point(9000, 40)], true)],
    );
    expect(sitePlan(rig, field)).toContain("north is up");
  });
});

describe("the safety corners", () => {
  const field = site(
    "meadow",
    straightLine("spectator line", point(-400, -300), point(400, -300)),
  );

  function scheduleOf(source: string) {
    const parsed = parseScript(new SourceFile("s.pf", source));
    const expanded = expandScript(parsed.script.statements, { seed: "t" });
    const resolved = resolveShots(expanded.shots, catalog, rig);
    return buildSchedule(allocatePins(resolved.shots, rig).assignments);
  }

  it("skips a cue whose position is not in the rig", () => {
    const built = scheduleOf("at 20 fire shell.150 from pad.a");
    const bare = { site: field, rig: new Rig(), ceiling: metres(10) };
    expect(checkAirspace(built, bare).size).toBeGreaterThan(0);
    expect(checkFallout(built, bare).size).toBe(0);
  });
});

describe("the expander's corners", () => {
  it("expands a chase whose position list is walked past its end", () => {
    const result = compile(
      "at 10 chase shell.150 across pad.a pad.a every 100ms passes 3",
      "s.pf",
      { catalog, rig },
    );
    expect(result.schedule.events).toHaveLength(6);
  });

  it("keeps a fan with jitter of zero exactly on its spread", () => {
    const result = compile(
      "at 10 fan 3 of shell.150 from pad.a spread 400ms jitter 0",
      "s.pf",
      { catalog, rig },
    );
    const times = result.schedule.events.map((event) => raw(event.visibleAt));
    expect(times[2]! - times[0]!).toBe(400);
  });
});

describe("balance with nothing to balance", () => {
  it("reports no shares and no lean for an empty show", () => {
    const empty = compile("", "s.pf", { catalog, rig });
    expect(positionShares(empty.schedule, rig)).toEqual([]);
    expect(lateralLean(empty.schedule, rig)).toBe(0);
  });
});

describe("substitution corners", () => {
  it("finds nothing in a catalog of one", () => {
    const only = Catalog.from([
      shell({ id: effectId("only"), name: "only", calibre: calibre(mm(150)) }),
    ]);
    expect(substitutesFor(only.get("only")!, only)).toEqual([]);
  });

  it("matches two ground pieces, which have no calibre at all", () => {
    const ground = Catalog.from([
      {
        kind: "ground" as const,
        id: effectId("a"),
        name: "a",
        style: "gerb" as const,
        duration: ms(20000),
        height: metres(4),
      },
      {
        kind: "ground" as const,
        id: effectId("b"),
        name: "b",
        style: "fountain" as const,
        duration: ms(20000),
        height: metres(4),
      },
    ]);
    expect(substitutesFor(ground.get("a")!, ground)).toHaveLength(1);
  });
});

describe("the parser's later failure points", () => {
  function parse(source: string) {
    return parseScript(new SourceFile("s.pf", source));
  }

  it("refuses an unusable position after from in a ripple", () => {
    expect(
      parse("at 1 ripple 3 of a from Pad every 1").diagnostics.byCode("PF2105"),
    ).toHaveLength(1);
  });

  it("refuses an unusable position after from in a fan", () => {
    expect(
      parse("at 1 fan 3 of a from Pad spread 1").diagnostics.byCode("PF2105"),
    ).toHaveLength(1);
  });

  it("refuses a ripple interval that is not a time", () => {
    expect(
      parse("at 1 ripple 3 of a from b every soon").diagnostics.byCode(
        "PF2107",
      ),
    ).toHaveLength(1);
  });

  it("refuses a fan spread that is not a time", () => {
    expect(
      parse("at 1 fan 3 of a from b spread soon").diagnostics.byCode("PF2107"),
    ).toHaveLength(1);
  });

  it("refuses a chase interval that is not a time", () => {
    expect(
      parse("at 1 chase a across p q every soon").diagnostics.byCode("PF2107"),
    ).toHaveLength(1);
  });

  it("refuses a chase effect that is not a usable name", () => {
    expect(
      parse("at 1 chase Rocket across p q every 1").diagnostics.byCode(
        "PF2105",
      ),
    ).toHaveLength(1);
  });
});

describe("the shared show flags", () => {
  const FILES = {
    "house.csv": ["id,kind,name,calibre", "shell.150,shell,six,150mm"].join(
      "\n",
    ),
    "autumn.rig": ["position pad.a at 0 0", "module 1 fc-32 at pad.a"].join(
      "\n",
    ),
    "autumn.pf": "at 20 fire shell.150 from pad.a",
  };

  it("reads every frame rate the flag offers", () => {
    for (const rate of ["24", "25", "30", "30drop"]) {
      const env = new MemoryEnv(FILES);
      runCliCommand(
        buildCliCommands(),
        [
          "check",
          "autumn.pf",
          "--frame",
          rate,
          "--catalog",
          "house.csv",
          "--rig",
          "autumn.rig",
        ],
        env,
      );
      expect(env.stdout).toContain("ready");
    }
  });

  it("takes a wind bearing as well as a speed", () => {
    const env = new MemoryEnv(FILES);
    runCliCommand(
      buildCliCommands(),
      [
        "check",
        "autumn.pf",
        "--audience",
        "300",
        "--wind",
        "6",
        "--wind-from",
        "180",
        "--catalog",
        "house.csv",
        "--rig",
        "autumn.rig",
      ],
      env,
    );
    expect(env.stdout).toContain("cues");
  });

  it("runs with no catalog and no rig at all", () => {
    const env = new MemoryEnv(FILES);
    runCliCommand(buildCliCommands(), ["check", "autumn.pf"], env);
    expect(env.stderr).toContain("PF2300");
  });
});
