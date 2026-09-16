#!/usr/bin/env python3
"""Round 2 held-out edits (quality review, behavior_in_tests): exact error
cardinality on every malformed line, a continuation case with three bad lines,
a tangent-contact fallout case, and three test titles that echoed the
instruction. Asserted replacements: each anchor must match exactly once."""
from pathlib import Path
HERE = Path(__file__).resolve().parent
SHEET = HERE.parent / "held-out/tests/safety/siteSheet.test.ts"
FLAGS = HERE.parent / "held-out/tests/cli/siteFlags.test.ts"

def one(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    assert text.count(old) == 1, (path.name, text.count(old), old[:60])
    path.write_text(text.replace(old, new))

# every single-bad-line refusal now pins exactly one error
for old in [
    '''      read([
        "site meadow",
        "hard river -300 120 300 140",
      ]).diagnostics.hasErrors(),
    ).toBe(true);''',
    '''      read([AUDIENCE, "audience -50 -80 50 -80"]).diagnostics.hasErrors(),
    ).toBe(true);''',
    '''    expect(read([AUDIENCE, "hard river 0 120"]).diagnostics.hasErrors()).toBe(
      true,
    );''',
    '''      read([AUDIENCE, "hard river 0 120 300"]).diagnostics.hasErrors(),
    ).toBe(true);''',
    '''      read([AUDIENCE, "house barn at north 900"]).diagnostics.hasErrors(),
    ).toBe(true);''',
    '''    expect(read([AUDIENCE, "hard"]).diagnostics.hasErrors()).toBe(true);''',
    '''    expect(read([AUDIENCE, "house at 10 900"]).diagnostics.hasErrors()).toBe(
      true,
    );''',
    '''    expect(read([AUDIENCE, "house barn 10 900"]).diagnostics.hasErrors()).toBe(
      true,
    );''',
    '''      read([
        AUDIENCE,
        "house barn at 10 900 limit loud",
      ]).diagnostics.hasErrors(),
    ).toBe(true);''',
    '''    expect(read([AUDIENCE, "limit quiet"]).diagnostics.hasErrors()).toBe(true);''',
    '''    expect(read([AUDIENCE, "fence -10 0 10 0"]).diagnostics.hasErrors()).toBe(
      true,
    );''',
]:
    new = old.replace(".hasErrors()", ".errorCount").replace("toBe(true)", "toBe(1)").replace("toBe(\n      true,\n    )", "toBe(1)")
    assert new != old
    one(SHEET, old, new)

one(SHEET, '''  it("keeps reading after a bad line", () => {
    const parsed = read([
      AUDIENCE,
      "hard river 0 120",
      "house barn at 10 900 limit 110",
    ]);
    expect(parsed.diagnostics.hasErrors()).toBe(true);
    expect(parsed.site.houses.map((house) => house.name)).toEqual(["barn"]);
  });''', '''  it("raises one error per bad line and keeps reading past each", () => {
    const parsed = read([
      AUDIENCE,
      "hard river 0 120",
      "house barn at 10 900 limit 110",
      "fence -10 0 10 0",
      "soft path -100 60 100 60",
      "limit quiet",
    ]);
    expect(parsed.diagnostics.errorCount).toBe(3);
    expect(parsed.site.houses.map((house) => house.name)).toEqual(["barn"]);
    expect(parsed.site.boundaries.map((line) => line.name)).toEqual(["path"]);
  });''')

one(SHEET, '''  it("passes a three inch that stays inside in still air", () => {
    expect(fallout(ONE_SMALL, HEDGE_AND_POND)).toHaveLength(0);
  });
''', '''  it("passes a three inch that stays inside in still air", () => {
    expect(fallout(ONE_SMALL, HEDGE_AND_POND)).toHaveLength(0);
  });

  it("leaves a line the disc's edge only touches alone", () => {
    // A 51 m disc on a line 51 m out is clear, one metre nearer is over it;
    // ten metres a second carries the centre 90 m north and the edge with it.
    const kerb = (north: number) => [AUDIENCE, `hard kerb -300 ${north} 300 ${north}`];
    const air = wind(metresPerSecond(10), 0);
    expect(fallout(ONE_SMALL, kerb(51))).toHaveLength(0);
    expect(fallout(ONE_SMALL, kerb(50))).toHaveLength(1);
    expect(fallout(ONE_SMALL, kerb(141), air)).toHaveLength(0);
    expect(fallout(ONE_SMALL, kerb(140), air)).toHaveLength(1);
  });
''')

one(SHEET, 'it("raises nothing at a house with no limit anywhere"', 'it("stays quiet about a house nobody gave a limit"')
one(FLAGS, 'it("carries fallout downwind of where the wind comes from"', 'it("takes the bearing as where the wind blows from, not towards"')
one(FLAGS, 'it("quotes the nearest hard boundary and each house on the permit"', 'it("prints a site section with the closest line and every house"')
print("ok")
