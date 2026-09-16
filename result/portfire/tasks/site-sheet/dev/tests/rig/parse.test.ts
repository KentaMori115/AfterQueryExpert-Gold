import { describe, expect, it } from "vitest";
import { parseRig } from "../../src/rig/parse.js";
import { pinAddress } from "../../src/rig/pin.js";

const SHEET = [
  "# autumn 2025, measured 14 september",
  "position pad.a at 0 0",
  "position pad.b at 40 0 behind the water",
  "",
  "module 1 fc-32 at pad.a",
  "module 2 fc-16 at pad.a spare",
  "module 3 fc-32 at pad.b",
  "match talon",
  "voltage 30",
  "lead 45",
].join("\n");

describe("a clean sheet", () => {
  const parsed = parseRig(SHEET, "autumn.rig");

  it("raises nothing", () => {
    expect(parsed.diagnostics.size).toBe(0);
  });

  it("builds the positions with their coordinates", () => {
    expect(parsed.rig.positionCount).toBe(2);
    expect(parsed.rig.position("pad.b")?.east).toBe(40);
  });

  it("keeps the trailing words as a note", () => {
    expect(parsed.rig.position("pad.b")?.note).toBe("behind the water");
    expect(parsed.rig.module(2)?.note).toBe("spare");
  });

  it("leaves the note off when there is none", () => {
    expect("note" in (parsed.rig.position("pad.a") ?? {})).toBe(false);
  });

  it("builds the modules on their models", () => {
    expect(parsed.rig.moduleCount).toBe(3);
    expect(parsed.rig.module(2)?.model.name).toBe("fc-16");
    expect(parsed.rig.hasPin(pinAddress(3, 32))).toBe(true);
  });

  it("reads the settings", () => {
    expect(parsed.settings.match.name).toBe("talon");
    expect(parsed.settings.voltage).toBe(30);
    expect(parsed.settings.leadMetres).toBe(45);
  });

  it("ignores comments and blank lines", () => {
    expect(parsed.rig.positionCount).toBe(2);
  });
});

describe("defaults", () => {
  it("uses a standard match at 24 volts on 25 metres", () => {
    const parsed = parseRig("position pad.a at 0 0", "r.rig");
    expect(parsed.settings.match.name).toBe("standard");
    expect(parsed.settings.voltage).toBe(24);
    expect(parsed.settings.leadMetres).toBe(25);
  });

  it("builds an empty rig from an empty file", () => {
    const parsed = parseRig("", "r.rig");
    expect(parsed.rig.moduleCount).toBe(0);
    expect(parsed.diagnostics.size).toBe(0);
  });
});

describe("position problems", () => {
  it("refuses an unusable name", () => {
    const parsed = parseRig("position Pad A at 0 0", "r.rig");
    expect(parsed.diagnostics.byCode("PF1200")).toHaveLength(1);
  });

  it("refuses a missing at", () => {
    const parsed = parseRig("position pad.a 0 0", "r.rig");
    expect(parsed.diagnostics.byCode("PF1201")[0]?.help).toContain("at 0 0");
  });

  it("refuses coordinates that are not numbers", () => {
    const parsed = parseRig("position pad.a at left middle", "r.rig");
    expect(parsed.diagnostics.byCode("PF1202")).toHaveLength(1);
  });

  it("refuses a missing coordinate", () => {
    const parsed = parseRig("position pad.a at 0", "r.rig");
    expect(parsed.diagnostics.byCode("PF1202")).toHaveLength(1);
  });
});

describe("module problems", () => {
  it("refuses a case number that is not a whole number", () => {
    const parsed = parseRig("module 1.5 fc-32 at pad.a", "r.rig");
    expect(parsed.diagnostics.byCode("PF1203")).toHaveLength(1);
  });

  it("refuses an unknown model and names it", () => {
    const parsed = parseRig("module 1 fc-99 at pad.a", "r.rig");
    expect(parsed.diagnostics.byCode("PF1204")[0]?.message).toContain("fc-99");
  });

  it("refuses a missing at", () => {
    const parsed = parseRig("module 1 fc-32 pad.a", "r.rig");
    expect(parsed.diagnostics.byCode("PF1205")).toHaveLength(1);
  });

  it("refuses an unusable position name", () => {
    const parsed = parseRig("module 1 fc-32 at Pad", "r.rig");
    expect(parsed.diagnostics.byCode("PF1206")).toHaveLength(1);
  });

  it("warns when a case number is used twice", () => {
    const parsed = parseRig(
      [
        "position pad.a at 0 0",
        "module 1 fc-32 at pad.a",
        "module 1 fc-16 at pad.a",
      ].join("\n"),
      "r.rig",
    );
    expect(parsed.diagnostics.byCode("PF1207")).toHaveLength(1);
    expect(parsed.rig.module(1)?.model.name).toBe("fc-16");
  });

  it("errors when a module stands at a position that is never defined", () => {
    const parsed = parseRig("module 1 fc-32 at pad.z", "r.rig");
    expect(parsed.diagnostics.byCode("PF1212")[0]?.message).toContain("pad.z");
  });
});

describe("setting problems", () => {
  it("refuses an unknown match", () => {
    const parsed = parseRig("match sparkler", "r.rig");
    expect(parsed.diagnostics.byCode("PF1208")).toHaveLength(1);
    expect(parsed.settings.match.name).toBe("standard");
  });

  it("refuses a voltage of zero or less", () => {
    expect(
      parseRig("voltage 0", "r.rig").diagnostics.byCode("PF1209"),
    ).toHaveLength(1);
    expect(
      parseRig("voltage high", "r.rig").diagnostics.byCode("PF1209"),
    ).toHaveLength(1);
  });

  it("refuses a negative lead", () => {
    const parsed = parseRig("lead -5", "r.rig");
    expect(parsed.diagnostics.byCode("PF1210")).toHaveLength(1);
  });

  it("accepts a lead of zero", () => {
    expect(parseRig("lead 0", "r.rig").settings.leadMetres).toBe(0);
  });
});

describe("unknown statements", () => {
  it("names the keyword and lists the real ones", () => {
    const parsed = parseRig("rocket 4", "r.rig");
    const diagnostic = parsed.diagnostics.byCode("PF1211")[0];
    expect(diagnostic?.message).toContain("rocket");
    expect(diagnostic?.help).toContain("position, module, match");
  });

  it("points at the line it came from", () => {
    const parsed = parseRig(
      ["position pad.a at 0 0", "rocket 4"].join("\n"),
      "r.rig",
    );
    const diagnostic = parsed.diagnostics.byCode("PF1211")[0];
    expect(diagnostic?.file?.positionAt(diagnostic.span?.start ?? 0).line).toBe(
      2,
    );
  });

  it("keeps reading after a bad line", () => {
    const parsed = parseRig(
      ["rocket 4", "position pad.a at 0 0"].join("\n"),
      "r.rig",
    );
    expect(parsed.rig.positionCount).toBe(1);
  });
});
