#!/usr/bin/env python3
"""Mutate the reference solution one rule at a time and run the held-out
suite against each mutant in a scratch worktree. A mutant the suite lets
through is a rule the suite does not enforce.

    python3 local/mutants.py            # all
    python3 local/mutants.py name ...   # some
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
DEV = TASK / "dev"
NODE_MODULES = pathlib.Path("/root/mindriftwork/AQ_dragan/result/portfire/repo/node_modules")
HELD_OUT = ["tests/script/quickmatchRuns.test.ts", "tests/timeline/oneOutput.test.ts"]
SUPPORT = ["tests/support/frozenExpect.ts"]

# name -> (file, old, new)
MUTANTS = {
    "followers_take_pins": (
        "src/rig/allocate.ts",
        "    if (isFollower(shot)) {\n      const head = chainHeads.get(chainKeyOf(shot));",
        "    if (false) {\n      const head = chainHeads.get(chainKeyOf(shot));",
    ),
    "cursor_advances_per_shot": (
        "src/rig/allocate.ts",
        "      if (head !== undefined) {\n        assignments.push({ shot, address: head });\n      }\n      continue;",
        "      if (head !== undefined) {\n        assignments.push({ shot, address: head });\n        cursor.set(shot.position, ((cursor.get(shot.position) ?? 0) + 1) % Math.max(1, rig.modulesAt(shot.position).length));\n      }\n      continue;",
    ),
    "fixed_pin_on_every_shot": (
        "src/script/expand.ts",
        "        pin: i === 0 ? (statement.pin ?? { kind: \"auto\" }) : { kind: \"auto\" },",
        "        pin: statement.pin ?? { kind: \"auto\" },",
    ),
    "fuse_from_index": (
        "src/script/expand.ts",
        "      ms(at - head),",
        "      ms(i),",
    ),
    "followers_snapped_too": (
        "src/timeline/quantise.ts",
        "  const events: QuantisedEvent[] = panelEvents(schedule.events).map(",
        "  const events: QuantisedEvent[] = schedule.events.map(",
    ),
    "followers_snapped_alone": (
        "src/timeline/quantise.ts",
        "    const shift = headShift.get(pinKey(event.address));",
        "    const shift = undefined;",
    ),
    "followers_keep_own_drift": (
        "src/timeline/quantise.ts",
        "    events.push(shifted(event, shift));\n  }\n  events.sort(compareEvents);",
        "    events.push({ ...shifted(event, shift), drift: ms(0) });\n  }\n  events.sort(compareEvents);",
    ),
    "load_counts_followers": (
        "src/timeline/load.ts",
        "    .filter((event) => isHead(event) && event.address.module === unit.number)",
        "    .filter((event) => event.address.module === unit.number)",
    ),
    "table_lists_followers": (
        "src/export/firingTable.ts",
        "  return panelEvents(schedule.events).map((event, index) => [",
        "  return schedule.events.map((event, index) => [",
    ),
    "rowcount_counts_shots": (
        "src/export/firingTable.ts",
        "  return panelEvents(schedule.events).length;",
        "  return schedule.events.length;",
    ),
    "find_by_shot_number": (
        "src/export/explain.ts",
        "    return panelEvents(schedule.events)[asNumber - 1];",
        "    return schedule.events[asNumber - 1];",
    ),
    "rehearsal_counts_followers": (
        "src/timeline/rehearsal.ts",
        "  const sorted = panelEvents(schedule.events).sort(",
        "  const sorted = [...schedule.events].sort(",
    ),
    "wiring_runs_followers": (
        "src/rig/wiring.ts",
        "    if (isFollower(assignment.shot)) {\n      continue;\n    }",
        "    if (false) {\n      continue;\n    }",
    ),
    "moduleloads_counts_shots": (
        "src/rig/allocate.ts",
        "  const used = countBy(onePerPin(assignments), (assignment) =>",
        "  const used = countBy(assignments, (assignment) =>",
    ),
    "doubling_backs_followers": (
        "src/rig/redundancy.ts",
        "    if (isFollower(assignment.shot) || !shouldDouble(assignment, rule)) {",
        "    if (!shouldDouble(assignment, rule)) {",
    ),
    "candidates_include_chained": (
        "src/timeline/chain.ts",
        "    schedule.events.filter((event) => !isFused(event)),",
        "    schedule.events,",
    ),
    "diff_ignores_run_shape": (
        "src/timeline/diff.ts",
        "    if (wasRun?.shots !== isRun?.shots || wasRun?.fuses !== isRun?.fuses) {",
        "    if (false) {",
    ),
    "diff_keys_every_shot": (
        "src/timeline/diff.ts",
        "  const newByPin = new Map(\n    panelEvents(after.events).map((event) => [keyOf(event), event]),\n  );",
        "  const newByPin = new Map(after.events.map((event) => [keyOf(event), event]));",
    ),
    "permit_cues_count_shots": (
        "src/export/permit.ts",
        "    cueCount: panelEvents(schedule.events).length,",
        "    cueCount: schedule.events.length,",
    ),
    "no_length_limit": (
        "src/script/expand.ts",
        "  if (statement.count > MAX_CHAIN_LENGTH) {",
        "  if (statement.count > MAX_CHAIN_LENGTH * 100) {",
    ),
    "no_interval_check": (
        "src/script/expand.ts",
        "  if (statement.count > 1 && interval <= 0) {",
        "  if (false && interval <= 0) {",
    ),
    "jitter_allowed": (
        "src/script/parser.ts",
        "      if (trailers.chained !== undefined && trailers.jitter !== undefined) {",
        "      if (false) {",
    ),
    "chase_chainable": (
        "src/script/parser.ts",
        "      if (trailers.chained !== undefined) {\n        refuseChain(diagnostics, file, line, \"chase\");",
        "      if (false) {\n        refuseChain(diagnostics, file, line, \"chase\");",
    ),
    "format_drops_clause": (
        "src/script/format.ts",
        "    parts.push(\"chained\");",
        "    parts.push(\"\");",
    ),
    "follower_ignition_own": (
        "src/timeline/schedule.ts",
        "        ignitionAt = ms(raw(head) + raw(shot.fuse ?? ms(0)));",
        "        ignitionAt = ignitionAt;",
    ),
    "chain_key_ignores_play": (
        "src/timeline/fusing.ts",
        "  return `${shot.origin.start}:${shot.origin.end}@${head}`;",
        "  return `${shot.origin.start}:${shot.origin.end}`;",
    ),
}


def run(names):
    results = {}
    for name in names:
        file, old, new = MUTANTS[name]
        work = pathlib.Path(tempfile.mkdtemp(prefix=f"mut-{name}-"))
        subprocess.run(["git", "-C", str(DEV), "worktree", "add", "-q", "--detach", str(work), "solution"], check=True)
        try:
            target = work / file
            text = target.read_text()
            if text.count(old) != 1:
                results[name] = f"PATTERN {text.count(old)}"
                continue
            target.write_text(text.replace(old, new))
            for f in HELD_OUT + SUPPORT:
                blob = subprocess.check_output(["git", "-C", str(DEV), "show", f"heldout:{f}"])
                (work / f).parent.mkdir(parents=True, exist_ok=True)
                (work / f).write_bytes(blob)
            os.symlink(NODE_MODULES, work / "node_modules")
            report = work / "junit.xml"
            subprocess.run(
                ["node", "node_modules/vitest/vitest.mjs", "run", "--reporter=junit", f"--outputFile={report}"] + HELD_OUT,
                cwd=work, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if not report.exists():
                results[name] = "CAUGHT (no report: build broken)"
                continue
            root = ET.parse(report).getroot()
            cases = list(root.iter("testcase"))
            failed = [c.get("name") for c in cases if any(k.tag in ("failure", "error") for k in c)]
            results[name] = f"CAUGHT by {len(failed)}: {failed[:3]}" if failed else "SURVIVED"
        finally:
            subprocess.run(["git", "-C", str(DEV), "worktree", "remove", "--force", str(work)], stdout=subprocess.DEVNULL)
    return results


if __name__ == "__main__":
    names = sys.argv[1:] or list(MUTANTS)
    out = run(names)
    for name, verdict in out.items():
        print(f"{name:32s} {verdict}")
    print(f"{sum(1 for v in out.values() if v.startswith('CAUGHT'))}/{len(out)} caught")
