import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";
import {
  packSections,
  sectionTitles,
  showPack,
} from "../../src/export/pack.js";
import { parseCatalog } from "../../src/catalog/parse.js";
import { parseRig } from "../../src/rig/parse.js";
import { compile } from "../../src/compile.js";
import { point, site, straightLine } from "../../src/safety/site.js";

const CATALOG = [
  "id,kind,name,calibre,break,hang,diameter,duration,style",
  "shell.150,shell,six inch palm,150mm,palm,2.4,140,,",
  "shell.75,shell,three inch,75mm,peony,1.8,60,,",
  "gerb.silver,ground,silver gerb,,,,,20,gerb",
].join("\n");

const RIG = [
  "position pad.a at -60 0",
  "position pad.b at 60 0",
  "module 1 slat-50 at pad.a",
  "module 2 slat-50 at pad.b",
].join("\n");

const SHOW = [
  "show autumn",
  "at 20 ripple 6 of shell.75 from pad.a every 300ms",
  "at 30 fire shell.150 from pad.b",
  "at 40 fire gerb.silver from pad.a",
].join("\n");

const catalog = parseCatalog(CATALOG, "house.csv").catalog;
const rig = parseRig(RIG, "autumn.rig").rig;
const result = compile(SHOW, "autumn.pf", { catalog, rig });
const field = site(
  "meadow",
  straightLine("spectator line", point(-400, -200), point(400, -200)),
);

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "autumn.pf": SHOW,
    ...over,
  });
}

const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

describe("packSections", () => {
  const sections = packSections(result.schedule, {
    name: "autumn",
    rig,
    diagnostics: result.diagnostics,
  });

  it("starts with the summary", () => {
    expect(sections[0]?.title).toBe("summary");
    expect(sections[0]?.body).toContain("cues          8");
  });

  it("holds the paper a crew carries", () => {
    const titles = sections.map((section) => section.title);
    expect(titles).toContain("cue sheet");
    expect(titles).toContain("wiring sheet");
  });

  it("leaves the permit out without a site", () => {
    expect(sections.map((section) => section.title)).not.toContain("permit");
  });

  it("adds the permit when it has a site and details", () => {
    const withPermit = packSections(result.schedule, {
      name: "autumn",
      rig,
      site: field,
      permit: { showName: "autumn", siteName: "meadow" },
    });
    expect(withPermit.map((section) => section.title)).toContain("permit");
  });

  it("adds the layout when it has the assignments", () => {
    expect(sections.map((section) => section.title)).not.toContain(
      "rack layout",
    );
  });

  it("can leave sections out", () => {
    const trimmed = packSections(result.schedule, {
      name: "autumn",
      rig,
      without: ["cue sheet", "palette"],
    });
    const titles = trimmed.map((section) => section.title);
    expect(titles).not.toContain("cue sheet");
    expect(titles).not.toContain("palette");
    expect(titles).toContain("summary");
  });

  it("lists every title it can produce", () => {
    for (const section of sections) {
      expect(sectionTitles()).toContain(section.title);
    }
  });
});

describe("showPack", () => {
  it("rules off every section", () => {
    const text = showPack(result.schedule, { name: "autumn", rig });
    expect(text).toContain("summary\n=======");
    expect(text).toContain("cue sheet\n=========");
  });

  it("takes its numbers from one compile", () => {
    const text = showPack(result.schedule, {
      name: "autumn",
      rig,
      site: field,
      permit: { showName: "autumn", siteName: "meadow" },
    });
    expect(text).toContain("cues          8");
    expect(text).toContain("shots");
  });
});

describe("a pack for a show that was drawn", () => {
  it("puts the lot column on the cue sheet inside the pack", () => {
    const drawn = {
      ...result.schedule,
      events: result.schedule.events.map((event) => ({
        ...event,
        lot: "vn2405",
      })),
    };
    expect(showPack(drawn, { name: "autumn", rig, showLot: true })).toContain(
      "vn2405",
    );
    expect(showPack(drawn, { name: "autumn", rig })).not.toContain("vn2405");
  });
});

describe("the pack command", () => {
  it("writes the whole thing", () => {
    const env = envWith();
    expect(main(["pack", "autumn.pf", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("summary");
    expect(env.stdout).toContain("rack layout");
    expect(env.stdout).toContain("pin list");
  });

  it("lists the sections and stops", () => {
    const env = envWith();
    expect(main(["pack", "autumn.pf", "--sections"], env)).toBe(EXIT_OK);
    expect(env.stdout.split("\n")).toContain("wiring sheet");
  });

  it("leaves sections out", () => {
    const env = envWith();
    main(["pack", "autumn.pf", "--without", "cue sheet,palette", ...base], env);
    expect(env.stdout).not.toContain("cue sheet\n=========");
  });

  it("refuses a section it does not know", () => {
    const env = envWith();
    expect(
      main(["pack", "autumn.pf", "--without", "nonsense", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("pack --sections");
  });

  it("adds the permit when given an audience distance", () => {
    const env = envWith();
    main(["pack", "autumn.pf", "--audience", "200", ...base], env);
    expect(env.stdout).toContain("separation required");
  });

  it("writes to a file", () => {
    const env = envWith();
    main(["pack", "autumn.pf", "--out", "pack.txt", ...base], env);
    expect(env.written.get("pack.txt")).toContain("summary");
    expect(env.stdout).toContain("wrote the show pack");
  });

  it("refuses a show that does not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(main(["pack", "bad.pf", ...base], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("pack would be wrong");
  });
});
