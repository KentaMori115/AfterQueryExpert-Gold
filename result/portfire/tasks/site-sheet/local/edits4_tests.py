#!/usr/bin/env python3
"""Round 3 held-out edits (quality behavior_in_tests): every show command has
to accept --site, and the permit has to quote the nearest hard boundary rather
than the only one. Asserted replacements: each anchor must match exactly once."""
from pathlib import Path
HERE = Path(__file__).resolve().parent
FLAGS = HERE.parent / "held-out/tests/cli/siteFlags.test.ts"

def one(old: str, new: str) -> None:
    text = FLAGS.read_text()
    assert text.count(old) == 1, (text.count(old), old[:60])
    FLAGS.write_text(text.replace(old, new))

one('''const BROKEN = ["site water meadow", "hard hedge -300 90 300 90"].join("\\n");''',
'''const BROKEN = ["site water meadow", "hard hedge -300 90 300 90"].join("\\n");

// Two hard lines, the wall nearer the only position than the ridge.
const TWO_HARD = [
  "site water meadow",
  "audience -300 -150 300 -150",
  "hard far.ridge -300 260 300 260",
  "hard near.wall -300 130 300 130",
].join("\\n");''')

one('''    "broken.site": BROKEN,''',
    '''    "broken.site": BROKEN,
    "two.site": TWO_HARD,''')

one('''  it("prints a site section with the closest line and every house", () => {
    const env = envWith();
    main(["permit", "small.pf", "--site", "meadow.site", ...base], env);
    expect(env.stdout).toContain("hedge");
    expect(env.stdout).toContain("mill.cottage");
    expect(env.stdout).toContain("far.farm");
  });''',
'''  it("prints a site section with the closest line and every house", () => {
    const env = envWith();
    main(["permit", "small.pf", "--site", "meadow.site", ...base], env);
    expect(env.stdout).toContain("hedge");
    expect(env.stdout).toContain("mill.cottage");
    expect(env.stdout).toContain("far.farm");
  });

  it("quotes the nearer of two hard boundaries, at its own distance", () => {
    const env = envWith();
    main(["permit", "small.pf", "--site", "two.site", ...base], env);
    expect(env.stdout).toContain("130m to the near.wall");
    expect(env.stdout).not.toContain("far.ridge");
  });

  it("passes over a soft line closer than the nearest hard one", () => {
    // The path lies 40 m out and the hedge 90 m; only hard lines are quoted.
    const env = envWith();
    main(["permit", "small.pf", "--site", "meadow.site", ...base], env);
    expect(env.stdout).toContain("90m to the hedge");
    expect(env.stdout).not.toContain("to the path");
  });''')

one('''describe("crowd with a sheet"''',
'''describe("every show command", () => {
  // Each of these compiles one show and differs only in what it prints, so a
  // sheet has to reach all of them, not the handful that read it back out.
  const COMMANDS = [
    "check",
    "annotate",
    "continuity",
    "double",
    "explain",
    "hazard",
    "inventory",
    "pack",
    "permit",
    "plan",
    "preview",
    "rehearse",
    "sheet",
    "table",
  ];

  it("takes a sheet without calling it a usage mistake", () => {
    assertionsIntact();
    const refused: string[] = [];
    for (const name of COMMANDS) {
      const env = envWith();
      const code = main([name, "small.pf", "--site", "meadow.site", ...base], env);
      if (code === EXIT_BAD_USAGE) {
        refused.push(name);
      }
    }
    expect(refused).toEqual([]);
  });

  it("refuses a sheet beside an audience distance in every one of them", () => {
    const refused: string[] = [];
    for (const name of COMMANDS) {
      const env = envWith();
      const code = main(
        [name, "small.pf", "--site", "meadow.site", "--audience", "200", ...base],
        env,
      );
      if (code !== EXIT_BAD_USAGE) {
        refused.push(name);
      }
    }
    expect(refused).toEqual([]);
  });
});

describe("crowd with a sheet"''')
print("ok")
