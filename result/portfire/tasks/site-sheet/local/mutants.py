#!/usr/bin/env python3
"""Mutate one decision at a time in the reference solution and count how many
graded held-out cases each mutant fails. A mutant nothing catches is a
decision nothing enforces. Kills are judged by the junit report, never by
parsing summary text.

    ./mutants.py            # run every mutant
    ./mutants.py NAME       # run one
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE.parent
DEV = TASK / "dev"
HELD_OUT = TASK / "held-out" / "tests"
RULES = "src/safety/rules.ts"
SITE = "src/safety/site.ts"
SHEET = "src/safety/siteSheet.ts"
COMMON = "src/cli/commands/common.ts"
NOISE = "src/safety/noise.ts"
ENV = "src/cli/env.ts"
PLAN = "src/export/siteplan.ts"
PERMIT = "src/export/permit.ts"
CROWD = "src/cli/commands/crowd.ts"

# (name, file, old, new)
MUTANTS = [
    ("disc-stays-on-the-mortar", RULES,
     """    centre:
      air === undefined
        ? here
        : driftedCentre(here, envelope.centreHeight, air),""",
     """    centre: here,"""),
    ("disc-inflated-instead-of-moved", RULES,
     """  return {
    centre:
      air === undefined
        ? here
        : driftedCentre(here, envelope.centreHeight, air),
    radius: envelope.falloutRadius,
  };""",
     """  const drifted =
    air === undefined ? here : driftedCentre(here, envelope.centreHeight, air);
  const drift = Math.hypot(drifted.east - here.east, drifted.north - here.north);
  return {
    centre: here,
    radius: (raw(envelope.falloutRadius) + drift) as unknown as typeof envelope.falloutRadius,
  };"""),
    ("overflight-ignored", SITE,
     """        raw(distanceToBoundary(centre, line)) < raw(radius) ||
        flightCrosses(from, centre, line),""",
     """        raw(distanceToBoundary(centre, line)) < raw(radius),"""),
    ("soft-boundaries-count", SITE,
     """  return hardBoundaries(where)
    .filter(""",
     """  return where.boundaries
    .filter("""),
    ("wind-from-taken-as-towards", COMMON,
     "  return wind(metresPerSecond(Math.max(0, speed)), from + 180);",
     "  return wind(metresPerSecond(Math.max(0, speed)), from);"),
    ("houses-never-checked", RULES,
     """    .addAll(checkFallout(schedule, context).all())
    .addAll(checkHouses(schedule, context).all());""",
     """    .addAll(checkFallout(schedule, context).all());"""),
    ("sheet-limit-ignored", SHEET,
     """    held.limit === undefined && sheetLimit !== undefined
      ? house(held.name, held.at.east, held.at.north, sheetLimit)
      : held,""",
     """    held,"""),
    ("house-limit-overridden-by-sheet", SHEET,
     """    held.limit === undefined && sheetLimit !== undefined
      ? house(held.name, held.at.east, held.at.north, sheetLimit)
      : held,""",
     """    sheetLimit !== undefined
      ? house(held.name, held.at.east, held.at.north, sheetLimit)
      : held,"""),
    ("only-the-first-house", RULES,
     """  for (const house of context.site.houses) {
    diagnostics.addAll(
      checkNoise(schedule, contextAt(house, context.rig)).all(),
    );
  }""",
     """  for (const house of context.site.houses.slice(0, 1)) {
    diagnostics.addAll(
      checkNoise(schedule, contextAt(house, context.rig)).all(),
    );
  }"""),
    ("noise-error-becomes-warning", NOISE,
     """    diagnostics.error({
      code: "PF4200",""",
     """    diagnostics.warning({
      code: "PF4200","""),
    ("reports-added-as-loudest-only", NOISE,
     "    peak = Math.max(peak, combineLevels(levels));",
     "    peak = Math.max(peak, ...levels, 0);"),
    ("second-audience-line-accepted", SHEET,
     """        if (spectatorLine !== undefined) {
          diagnostics.error({
            code: "PF1701",""",
     """        if (spectatorLine !== undefined && false) {
          diagnostics.error({
            code: "PF1701","""),
    ("missing-audience-accepted", SHEET,
     """  if (spectatorLine === undefined) {
    diagnostics.error({
      code: "PF1700",""",
     """  if (spectatorLine === undefined && false) {
    diagnostics.error({
      code: "PF1700","""),
    ("unknown-statement-accepted", SHEET,
     """      default: {
        diagnostics.error({
          code: "PF1707",""",
     """      default: {
        diagnostics.note({
          code: "PF1707","""),
    ("bad-limit-accepted", SHEET,
     """          if (value === undefined || value <= 0 || rest.length !== 2) {
            diagnostics.error({
              code: "PF1706",""",
     """          if (value === undefined && false) {
            diagnostics.error({
              code: "PF1706","""),
    ("site-and-audience-merge", COMMON,
     """  if (
    valueOf(args, "site") !== undefined &&
    valueOf(args, "audience") !== undefined
  ) {""",
     """  if (
    valueOf(args, "site") !== undefined &&
    valueOf(args, "audience") !== undefined &&
    false
  ) {"""),
    ("houses-missing-from-key", PLAN,
     """  const houses = site.houses.map((house) => `H ${house.name}`);""",
     """  const houses: string[] = [];"""),
    ("permit-site-name-ignored", COMMON,
     """  return valueOf(args, "site-name") ?? where?.name ?? "unnamed site";""",
     """  return valueOf(args, "site-name") ?? "unnamed site";"""),
    ("permit-site-name-not-overridable", COMMON,
     """  return valueOf(args, "site-name") ?? where?.name ?? "unnamed site";""",
     """  return where?.name ?? valueOf(args, "site-name") ?? "unnamed site";"""),
    ("permit-quotes-the-farthest-hard-line", PERMIT,
     """    const nearest = clearances(position, site).find((line) => line.hard);""",
     """    const nearest = clearances(position, site)
      .filter((line) => line.hard)
      .at(-1);"""),
    ("permit-quotes-any-line-hard-or-soft", PERMIT,
     """    const nearest = clearances(position, site).find((line) => line.hard);""",
     """    const nearest = clearances(position, site)[0];"""),
    ("site-flag-only-on-the-commands-that-print-it", COMMON,
     """  { name: "site", kind: "value", help: "the site sheet" },""",
     """"""),
    ("permit-forgets-the-houses", PERMIT,
     """  for (const heard of houseNoise(schedule, { site, rig })) {""",
     """  for (const heard of houseNoise(schedule, { site, rig }).slice(0, 0)) {"""),
    ("crowd-frontage-not-from-sheet", CROWD,
     """  return { ok: true, value: frontageOf(where.spectatorLine) };""",
     """  return { ok: true, value: frontageOf(where.spectatorLine) / 2 };"""),
    ("polyline-first-segment-only", SITE,
     """  for (let i = 1; i < line.points.length; i += 1) {
    const a = line.points[i - 1];
    const b = line.points[i];
    if (a !== undefined && b !== undefined && segmentsCross(from, to, a, b)) {""",
     """  for (let i = 1; i < Math.min(2, line.points.length); i += 1) {
    const a = line.points[i - 1];
    const b = line.points[i];
    if (a !== undefined && b !== undefined && segmentsCross(from, to, a, b)) {"""),
    ("a-tangent-line-counts-as-crossed", SITE,
     """        raw(distanceToBoundary(centre, line)) < raw(radius) ||""",
     """        raw(distanceToBoundary(centre, line)) <= raw(radius) ||"""),
    ("one-bad-line-raises-two-errors", SHEET,
     """      default: {
        diagnostics.error({
          code: "PF1707",
          message: `unknown site statement ${keyword}`,""",
     """      default: {
        diagnostics.error({
          code: "PF1707",
          message: `unknown site statement ${keyword} (again)`,
          file,
          span: at,
        });
        diagnostics.error({
          code: "PF1707",
          message: `unknown site statement ${keyword}`,"""),
    ("reading-stops-at-the-first-bad-line", SHEET,
     """  for (const line of splitLines(text)) {""",
     """  let stop = false;
  for (const line of splitLines(text)) {
    if (stop) {
      break;
    }
    stop = diagnostics.hasErrors();"""),
    ("crossing-per-shot-not-per-effect", RULES,
     """      const key = `${event.position}|${line}|${event.effectId}`;""",
     """      const key = `${event.position}|${line}|${event.effectId}|${String(raw(event.ignitionAt))}`;"""),
]


def graded_ids() -> set[str]:
    import json

    config = json.loads((TASK / "tests" / "config.json").read_text())
    return set(config["f2p_node_ids"])


def run(name: str, path: str, old: str, new: str) -> tuple[int, int, list[str]]:
    tree = Path(tempfile.mkdtemp(prefix=f"mutant-{name}-"))
    try:
        subprocess.run(
            ["git", "-C", str(DEV), "worktree", "add", "-q", "--detach", str(tree), "solution"],
            check=True,
        )
        target = tree / path
        text = target.read_text()
        if text.count(old) != 1:
            return -1, 0, [f"anchor matched {text.count(old)} times"]
        target.write_text(text.replace(old, new))
        (tree / "node_modules").symlink_to(DEV / "node_modules")
        for f in HELD_OUT.rglob("*.ts"):
            dest = tree / "tests" / f.relative_to(HELD_OUT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, dest)
        report = tree / "mutant.xml"
        subprocess.run(
            [
                "node", "node_modules/vitest/vitest.mjs", "run",
                "tests/safety/siteSheet.test.ts", "tests/cli/siteFlags.test.ts",
                "--reporter=junit", f"--outputFile={report}",
            ],
            cwd=tree, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600,
        )
        wanted = graded_ids()
        failed: list[str] = []
        passed = 0
        seen = 0
        if report.exists():
            for tc in ET.parse(report).iter("testcase"):
                nid = f"{tc.get('classname')}.{tc.get('name')}"
                if nid not in wanted:
                    continue
                seen += 1
                if any(ch.tag in ("failure", "error", "skipped") for ch in tc):
                    failed.append(nid)
                else:
                    passed += 1
        # an id that never reported is a failure too
        missing = len(wanted) - seen
        return len(failed) + missing, passed, failed
    finally:
        subprocess.run(["git", "-C", str(DEV), "worktree", "remove", "--force", str(tree)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["git", "-C", str(DEV), "worktree", "prune"], stdout=subprocess.DEVNULL)


def main() -> int:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    survivors = []
    for name, path, old, new in MUTANTS:
        if only is not None and name != only:
            continue
        killed, passed, failed = run(name, path, old, new)
        if killed < 0:
            print(f"{name:40} ANCHOR PROBLEM: {failed[0]}")
            survivors.append(name)
            continue
        verdict = "caught" if killed > 0 else "SURVIVED"
        print(f"{name:40} {verdict:9} {killed:3} graded cases fail, {passed} pass")
        if killed == 0:
            survivors.append(name)
        elif only is not None:
            for nid in failed[:12]:
                print(f"    {nid}")
    print(f"\n{len(MUTANTS) - len(survivors)} of {len(MUTANTS)} mutants caught")
    if survivors:
        print("survivors:", ", ".join(survivors))
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main())
