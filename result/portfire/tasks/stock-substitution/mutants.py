#!/usr/bin/env python3
"""Mutate one decision at a time in the reference solution and count how many
graded held-out cases each mutant fails. A mutant nothing catches is a
decision nothing enforces.

    ./mutants.py            # run every mutant
    ./mutants.py NAME       # run one
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
HELD_OUT = HERE / "held-out" / "tests"
DRAW = "src/catalog/draw.ts"
COMPILE = "src/compile.ts"
SHEETS = "src/export/sheets.ts"
SCHEDULE = "src/timeline/schedule.ts"
INVENTORY = "src/cli/commands/inventory.ts"

# (name, file, old, new)
MUTANTS = [
    ("inventory-counts-what-fires", INVENTORY,
     "(event) => event.substitutedFor ?? event.effectId,",
     "(event) => event.effectId,"),
    ("lot-column-only-when-drawn", SHEETS,
     "const drawn = options.lot ?? drawnFromStock(schedule);",
     "const drawn = drawnFromStock(schedule);"),
    ("lend-in-time-order", DRAW,
     """  for (const shot of ordered) {
    const lot = store.take(shot.effect);
    if (lot === undefined) {
      waiting.push(shot);
    } else {
      drawn.set(shot, { ...shot, lot });
    }
  }
""",
     """  for (const shot of ordered) {
    const lot = store.take(shot.effect);
    if (lot === undefined) {
      const list = substitutesFor(shot.resolved, catalog, options.substitute ?? {});
      const chosen = list.find((c) => store.left(c.effect.id) > 0);
      const lent = chosen === undefined ? undefined : store.take(chosen.effect.id);
      if (chosen !== undefined && lent !== undefined) {
        drawn.set(shot, { ...shot, effect: chosen.effect.id, resolved: chosen.effect, substitutedFor: shot.effect, lot: lent });
        const key = coverKey(shot.effect, chosen.effect.id);
        const held = covers.get(key);
        covers.set(key, held === undefined ? { asked: shot.effect, used: chosen.effect.id, quality: chosen.quality, count: 1, leadDifferenceMs: chosen.leadDifferenceMs } : { ...held, count: held.count + 1 });
        continue;
      }
      waiting.push(shot);
    } else {
      drawn.set(shot, { ...shot, lot });
    }
  }
"""),
    ("draw-in-script-order", DRAW,
     "    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index)",
     "    .sort((a, b) => a.index - b.index)"),
    ("draw-latest-first", DRAW,
     "    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index)",
     "    .sort((a, b) => raw(b.shot.at) - raw(a.shot.at) || a.index - b.index)"),
    ("one-substitute-per-effect", DRAW,
     "    const chosen = list.find(\n      (candidate) => store.left(candidate.effect.id) > 0,\n    );",
     "    const chosen = list[0];"),
    ("lot-by-number-only", DRAW,
     """  if (a.received !== b.received) {
    if (a.received === undefined) {
      return 1;
    }
    if (b.received === undefined) {
      return -1;
    }
    return a.received < b.received ? -1 : 1;
  }
""", ""),
    ("undated-first", DRAW,
     """    if (a.received === undefined) {
      return 1;
    }
    if (b.received === undefined) {
      return -1;
    }""",
     """    if (a.received === undefined) {
      return -1;
    }
    if (b.received === undefined) {
      return 1;
    }"""),
    ("newest-lot-first", DRAW,
     "    return a.received < b.received ? -1 : 1;",
     "    return a.received < b.received ? 1 : -1;"),
    ("pull-ignored", DRAW,
     "    pulled.set(key, (pulled.get(key) ?? 0) + copy.quarantine(key));",
     "    pulled.set(key, 0);"),
    ("pull-mutates-caller", DRAW,
     "  const copy = Magazine.from(magazine.stock().flatMap((line) => line.lots));",
     "  const copy = magazine;"),
    ("keep-original-effect-on-cover", DRAW,
     """      effect: chosen.effect.id,
      resolved: chosen.effect,
      substitutedFor: shot.effect,""",
     """      substitutedFor: shot.effect,"""),
    ("near-as-note", DRAW,
     '    if (cover.quality === "exact") {',
     '    if (cover.quality !== undefined) {'),
    ("short-as-warning", DRAW,
     """    diagnostics.error({
      code: "PF1600",""",
     """    diagnostics.warning({
      code: "PF1600","""),
    ("one-diagnostic-per-shot", DRAW,
     "        : { ...held, count: held.count + 1 },",
     "        : held,"),
    ("drop-uncovered-shot", COMPILE,
     "    shots = stock.shots;",
     "    shots = stock.shots.filter((shot) => shot.lot !== undefined);"),
    ("lot-column-always", SHEETS,
     "  return schedule.events.some((event) => event.lot !== undefined);",
     "  return true;"),
    ("no-lot-on-event", SCHEDULE,
     "      ...(shot.lot === undefined ? {} : { lot: shot.lot }),",
     ""),
    ("height-dropped-on-cover", DRAW,
     """      effect: chosen.effect.id,
      resolved: chosen.effect,""",
     """      effect: chosen.effect.id,
      resolved: chosen.effect,
      height: undefined,"""),
]


def run(name: str, path: str, old: str, new: str) -> tuple[int, int, list[str]]:
    tmp = Path(tempfile.mkdtemp(prefix="mutant-"))
    try:
        subprocess.run(["git", "-C", str(WORK), "worktree", "add", "-q", "--detach", str(tmp / "app"), "solution"],
                       check=True)
        app = tmp / "app"
        os.symlink(WORK / "node_modules", app / "node_modules")
        target = app / path
        text = target.read_text()
        if old not in text:
            raise SystemExit(f"{name}: anchor not found in {path}")
        target.write_text(text.replace(old, new, 1))
        shutil.copytree(HELD_OUT, app / "tests", dirs_exist_ok=True)
        report = tmp / "junit.xml"
        subprocess.run(["node", "node_modules/vitest/vitest.mjs", "run", "--reporter=junit",
                        f"--outputFile={report}", "tests/timeline/fromStock.test.ts",
                        "tests/cli/bookFlags.test.ts"], cwd=app, capture_output=True)
        failed, total = [], 0
        if report.exists():
            for tc in ET.parse(report).getroot().iter("testcase"):
                total += 1
                if any(ch.tag in ("failure", "error") for ch in tc):
                    failed.append(tc.attrib["name"])
        return total, len(failed), failed
    finally:
        subprocess.run(["git", "-C", str(WORK), "worktree", "remove", "--force", str(tmp / "app")],
                       capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    wanted = sys.argv[1:]
    survivors = []
    for name, path, old, new in MUTANTS:
        if wanted and name not in wanted:
            continue
        total, nfail, failed = run(name, path, old, new)
        print(f"{name:34s} {nfail:3d}/{total} graded cases fail")
        for f in failed[:4]:
            print(f"      {f}")
        if nfail == 0:
            survivors.append(name)
    if survivors:
        print("SURVIVORS:", ", ".join(survivors))
        return 1
    print("every mutant caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())
