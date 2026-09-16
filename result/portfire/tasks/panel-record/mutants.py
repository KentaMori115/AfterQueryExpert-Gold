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
LOG = "src/timeline/panelLog.ts"
CONT = "src/rig/continuity.ts"
MISF = "src/timeline/misfire.ts"
REH = "src/cli/commands/rehearse.ts"
CLI = "src/cli/commands/continuity.ts"

# (name, file, old, new)
MUTANTS = [
    ("ignores-the-pre-roll", LOG,
     "  const preRoll = raw(schedule.preRoll);",
     "  const preRoll = 0;"),
    ("pre-roll-sign-flipped", LOG,
     "    const expected = raw(event.ignitionAt) + preRoll;",
     "    const expected = raw(event.ignitionAt) - preRoll;"),
    ("latest-row-wins", LOG,
     "  const ordered = [...rows].sort(\n    (a, b) => raw(a.at) - raw(b.at) || a.line - b.line,\n  );",
     "  const ordered = [...rows].sort(\n    (a, b) => raw(b.at) - raw(a.at) || a.line - b.line,\n  );"),
    ("repeat-rows-not-extra", LOG,
     "    if (event === undefined || matched.has(key)) {",
     "    if (event === undefined) {"),
    ("fired-in-log-order", LOG,
     "  for (const event of schedule.events) {\n    const match = matched.get(pinKey(event.address));\n    if (match === undefined) {\n      missed.push(event);\n    } else {\n      fired.push(match);\n    }\n  }",
     "  for (const event of schedule.events) {\n    const match = matched.get(pinKey(event.address));\n    if (match === undefined) {\n      missed.push(event);\n    }\n  }\n  fired.push(...matched.values());"),
    ("tolerance-is-half-a-frame", LOG,
     "  const tolerance = options.tolerance ?? frameDuration(schedule.format);",
     "  const tolerance = options.tolerance ?? ms(raw(frameDuration(schedule.format)) / 2);"),
    ("tolerance-boundary-off-by-one", LOG,
     "  const late = fired.filter((match) => raw(match.offset) > limit);",
     "  const late = fired.filter((match) => raw(match.offset) >= limit);"),
    ("early-never-reported", LOG,
     "  const early = fired.filter((match) => raw(match.offset) < -limit);",
     "  const early: LogMatch[] = [];"),
    ("worst-is-latest-only", LOG,
     "      Math.abs(raw(match.offset)) > Math.abs(raw(worst.offset))",
     "      raw(match.offset) > raw(worst.offset)"),
    ("extra-is-a-warning", LOG,
     "  for (const row of grade.extra) {\n    diagnostics.error({",
     "  for (const row of grade.extra) {\n    diagnostics.warning({"),
    ("late-is-an-error", LOG,
     "  for (const match of [...grade.late, ...grade.early]) {\n    diagnostics.warning({",
     "  for (const match of [...grade.late, ...grade.early]) {\n    diagnostics.error({"),
    ("bad-row-stops-the-log", LOG,
     "      diagnostics.error({\n        code: \"PF1422\",",
     "      rows.length = 0;\n      diagnostics.error({\n        code: \"PF1422\","),
    ("dead-without-before-walk", CONT,
     "        if (before !== undefined && beforeReadings.get(key) === \"open\") {",
     "        if (beforeReadings.get(key) !== \"connected\") {"),
    ("unknown-counts-as-fired", CONT,
     "    if (row === undefined) {\n      unknown.push(address);\n      continue;\n    }",
     "    if (row === undefined) {\n      fired.push(address);\n      continue;\n    }"),
    ("burnt-needs-no-before", CONT,
     "        row.reading === \"open\" &&\n        beforeReadings.get(key) === \"connected\"",
     "        row.reading === \"open\""),
    ("shorted-counted-fired", CONT,
     "      case \"short\":\n        shorted.push(address);\n        break;",
     "      case \"short\":\n        fired.push(address);\n        break;"),
    ("unknown-is-an-error", CONT,
     "  for (const address of walk.unknown) {\n    diagnostics.warning({",
     "  for (const address of walk.unknown) {\n    diagnostics.error({"),
    ("dead-is-a-warning", CONT,
     "  for (const address of walk.dead) {\n    diagnostics.error({",
     "  for (const address of walk.dead) {\n    diagnostics.warning({"),
    ("unfired-lists-unsorted", CONT,
     "  return [\n    ...walk.misfired,\n    ...walk.dead,\n    ...walk.unknown,\n    ...walk.shorted,\n  ].sort(comparePins);",
     "  return [...walk.misfired, ...walk.dead, ...walk.unknown, ...walk.shorted];"),
    ("clearance-from-own-last-cue", MISF,
     "      clearAt: ms(end + held.wait),",
     "      clearAt: ms(\n        Math.max(\n          ...misfires\n            .filter((m) => m.event.position === position)\n            .map((m) => raw(m.event.occupancy.end)),\n        ) + held.wait,\n      ),"),
    ("clearance-from-the-cue", MISF,
     "      clearAt: ms(end + held.wait),",
     "      clearAt: ms(held.wait),"),
    ("positions-latest-first", MISF,
     "        raw(a.clearAt) - raw(b.clearAt) || compareIds(a.position, b.position),",
     "        raw(b.clearAt) - raw(a.clearAt) || compareIds(a.position, b.position),"),
    ("shortest-wait-per-position", MISF,
     "    held.wait = Math.max(held.wait, raw(waitFor(misfire)));",
     "    held.wait = held.wait === 0 ? raw(waitFor(misfire)) : Math.min(held.wait, raw(waitFor(misfire)));"),
    ("usable-ignored", MISF,
     "      if (!taken.has(pinKey(address)) && usable(address)) {",
     "      if (!taken.has(pinKey(address))) {"),
    ("usable-beats-taken", MISF,
     "      if (!taken.has(pinKey(address)) && usable(address)) {",
     "      if (usable(address)) {"),
    ("cli-uses-connected-pins", CLI,
     "        usable: (address) => open.has(pinKey(address)),",
     "        usable: (address) => !open.has(pinKey(address)),"),
    ("cli-passes-on-misfire", CLI,
     "      return misfires.length > 0 || result.burnt.length > 0\n        ? EXIT_SHOW_PROBLEM\n        : EXIT_OK;",
     "      return result.burnt.length > 0 ? EXIT_SHOW_PROBLEM : EXIT_OK;"),
    ("cli-rehearse-passes-on-error", REH,
     "      return diagnostics.hasErrors() ? EXIT_SHOW_PROBLEM : outcomeCode(outcome);",
     "      return outcomeCode(outcome);"),
    ("cli-tolerance-ignored", REH,
     "        ...(tolerance === undefined ? {} : { tolerance: ms(tolerance) }),",
     ""),
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
                        f"--outputFile={report}", "tests/timeline/panelClock.test.ts",
                        "tests/cli/morningAfter.test.ts"], cwd=app, capture_output=True)
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
