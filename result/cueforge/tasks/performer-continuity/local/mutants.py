#!/usr/bin/env python3
"""Mutant sweep: each mutant edits one decision in the solution and the graded
suite must fail at least one case. Run from the work/ git repo on the solution
branch with the held-out tests checked out (untracked). Uses -B and clears
__pycache__ first so stale bytecode never inflates a count."""

import pathlib
import shutil
import subprocess
import sys

CONT = "src/cueforge/movement/continuity.py"
PLAN = "src/cueforge/compiler/plan.py"
VALIDATE = "src/cueforge/compiler/validate.py"
EVAL = "src/cueforge/assertions/evaluate.py"
SCHED = "src/cueforge/simulation/scheduler.py"

MUTANTS = {
    # moves followed in identifier order instead of start order
    "follow_in_id_order": (CONT,
        "    return (END_OF_SHOW if start_ms is None else start_ms, cue_id)",
        "    return (0, cue_id)"),
    # a move during a running move departs from the running move's from (the position)
    "running_departs_from_position": (CONT,
        "                departs = running_to\n            else:\n                departs = position",
        "                departs = position\n            else:\n                departs = position"),
    # the running check treats the end instant as still running
    "running_end_inclusive": (CONT,
        "            if running_until is not None and move.start_ms >= running_until:",
        "            if running_until is not None and move.start_ms > running_until:"),
    # (dropped) "stated_from_wins": honouring the stated from inside the
    # pre-pass callback only moves the running window; the compile loop
    # recomputes travel from the resolved mark, so the mutant is equivalent for
    # every compiled figure. loop_uses_stated_from below is the real one.
    # no CF5004 for a disagreeing from
    "no_disagree_finding": (CONT,
        "                findings.append(_disagree_finding(move, departs))",
        "                pass"),
    # no CF5004 for a move during a running move
    "no_running_finding": (CONT,
        "                findings.append(_running_finding(move, running_id, running_until))",
        "                pass"),
    # unknown positions resolved from the initial mark instead of CF3005
    "unknown_position_guessed": (CONT,
        "        known = all(move.start_ms is not None for move in group)",
        "        known = True"),
    # rehearsal: a running move counts as arrived at its destination
    "moving_counts_as_arrived": (CONT,
        "        if run.end_ms is not None and time_ms < run.end_ms:\n            return None",
        "        if run.end_ms is not None and time_ms < run.end_ms:\n            return run.to"),
    # rehearsal: a failed move still moves the performer
    "failed_move_arrives": (CONT,
        "        if run.completed and run.end_ms is not None:",
        "        if run.end_ms is not None:"),
    # rehearsal: the arrival instant still counts as moving
    "arrival_instant_moving": (CONT,
        "        if run.end_ms is not None and time_ms < run.end_ms:",
        "        if run.end_ms is not None and time_ms <= run.end_ms:"),
    # rehearsal: position decided by the last move started, not the last finished
    "last_started_wins": (CONT,
        "            if arrived is None or key > arrived:",
        "            if True:"),
    # rehearsal never reports CF5004
    "rehearsal_silent": (CONT,
        "        if actual == run.from_mark:\n            continue",
        "        if True:\n            continue"),
    # the compiled action keeps the authored from
    "action_keeps_authored_from": (PLAN,
        '    if move is not None and move.from_mark is not None:\n        payload["from"] = move.from_mark',
        "    pass"),
    # travel computed from the stated from in the compile loop
    "loop_uses_stated_from": (PLAN,
        "            cue, numbers, None if move is None else move.from_mark",
        "            cue, numbers, None if move is None else (cue.action.from_mark or move.from_mark)"),
    # unknown initial marks pass
    "initial_mark_unchecked": (VALIDATE,
        "        if performer.initial_mark not in production.locations:",
        "        if False:"),
    # mark assertion: unknown location reported as a plain failure
    "unknown_location_is_failure": (EVAL,
        '        return [_unknown_subject("location", expr.expected)]',
        '        return [Finding(code=CF6001_ASSERTION_FAILED, severity=Severity.ERROR, message="x", subject_kind="assertion", subject_id=expression)]'),
    # rehearsal marks: a failed-while-running move reported as completed
    "failed_run_completed": (SCHED,
        '                completed=status.status == "completed",',
        '                completed=status.start_ms is not None,'),
}

NEW = ["tests/integration/test_performer_continuity.py", "tests/integration/test_rehearsal_marks.py"]


def run(files):
    for p in pathlib.Path(".").rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)
    r = subprocess.run(
        [sys.executable, "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", *files],
        capture_output=True, text=True,
    )
    tail = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:]
    return r.returncode, tail


def main() -> int:
    survivors = []
    for name, (path, old, new) in MUTANTS.items():
        p = pathlib.Path(path)
        original = p.read_text()
        if old not in original:
            print(f"{name:32s} PATTERN NOT FOUND in {path}")
            survivors.append(name)
            continue
        p.write_text(original.replace(old, new, 1))
        try:
            rc, tail = run(NEW)
        finally:
            p.write_text(original)
        verdict = "caught" if rc != 0 else "*** SURVIVED ***"
        if rc == 0:
            survivors.append(name)
        print(f"{name:32s} {verdict:18s} {tail}")
    rc, tail = run(NEW)
    print(f"{'restored solution':32s} {'green' if rc == 0 else '*** RED ***':18s} {tail}")
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main())
