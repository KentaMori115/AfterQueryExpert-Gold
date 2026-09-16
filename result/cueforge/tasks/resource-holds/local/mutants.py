#!/usr/bin/env python3
"""Mutant sweep: each mutant edits one decision in the solution and the graded
suite must fail at least one case. Runs in the work/ repo on the solution
branch with the held-out files present as untracked files."""

import pathlib
import shutil
import subprocess
import sys

WORK = pathlib.Path(__file__).resolve().parents[3] / "work"
PY = WORK.parent / ".venv" / "bin" / "python"
SCHED = "src/cueforge/simulation/scheduler.py"
HOLDS = "src/cueforge/simulation/holds.py"
TESTS = ["tests/integration/test_holds.py", "tests/unit/test_hold_reports.py"]

MUTANTS = {
    # the base behaviour: never hold, start on a busy resource
    "never_hold": (SCHED, "            busy = ledger.busy(cue.uses)\n            if busy:",
                          "            busy = ledger.busy(cue.uses)\n            if busy and False:"),
    # retry in insertion order rather than planned instant then id
    "queue_insertion_order": (HOLDS, "        for entry in sorted(self._entries.values(), key=lambda item: item.sort_key()):",
                                     "        for entry in list(self._entries.values()):"),
    # dependents keep the static schedule (base behaviour)
    "followers_not_deferred": (SCHED, "    deferred = {cue_id for group in followers.values() for cue_id in group}",
                                      "    deferred = set()"),
    # negative offsets follow the actual start too
    "negative_offsets_follow": (SCHED, "        if cue.trigger_kind == \"after\" and cue.depends_on and cue.offset_ms >= 0:",
                                       "        if cue.trigger_kind == \"after\" and cue.depends_on:"),
    # a zero-length wait is reported as a hold
    "zero_hold_reported": (SCHED, "and time_ms > entry.planned_ms:", "and time_ms >= entry.planned_ms:"),
    # the witness names every used resource, not the busy ones
    "witness_all_uses": (SCHED, "records.append(HoldRecord(waiting.id, entry.planned_ms, time_ms, entry.busy))",
                                "records.append(HoldRecord(waiting.id, entry.planned_ms, time_ms, tuple(sorted(waiting.uses))))"),
    # a failure while running does not free the slot for the queue
    "failure_release_ignored": (SCHED, "                reservations=live_reservations,\n            )\n            free(cue, item.time_ms)",
                                       "                reservations=live_reservations,\n            )\n            ledger.release(cue.id, cue.uses)"),
    # holds listed in start order
    "holds_in_start_order": (SCHED, "    holds_t = tuple(sorted(records, key=lambda item: item.sort_key()))",
                                    "    holds_t = tuple(records)"),
    # a hold is an error
    "hold_is_error": (HOLDS, "            severity=Severity.WARNING,", "            severity=Severity.ERROR,"),
    # capacity ignored: every resource has one slot
    "capacity_ignored": (HOLDS, "        return self.capacity(resource_id) - len(self._holders.get(resource_id, ()))",
                                "        return 1 - len(self._holders.get(resource_id, ()))"),
    # a dependency that fails before starting never calls its dependents
    "failed_dependency_silent": (SCHED, "                    started=False,\n                )\n                resolve(cue.id, item.time_ms)\n                continue\n            if cue.id in fails and fails[cue.id] is not None and fails[cue.id] > item.time_ms:",
                                        "                    started=False,\n                )\n                continue\n            if cue.id in fails and fails[cue.id] is not None and fails[cue.id] > item.time_ms:"),
    # held_ms mis-stated
    "held_ms_is_start": (HOLDS, "        return self.start_ms - self.planned_ms", "        return self.start_ms"),
    # requires state checked when called, not when started: a held cue that
    # passed the check at its planned instant starts without re-checking
    "state_checked_at_call": (SCHED, "            busy = ledger.busy(cue.uses)\n            if busy:\n",
                                     "            busy = ledger.busy(cue.uses)\n            if busy:\n                if any(states[r].current != s for r, s in cue.requires_state if r in states):\n                    _fail_cue(events, findings, statuses, cue, item.time_ms, ev_seq, started=False, extra_code=CF4003_ILLEGAL_STATE)\n                    resolve(cue.id, item.time_ms)\n                    continue\n                cue = CompiledCue(**{**{f: getattr(cue, f) for f in cue.__slots__}, 'requires_state': ()})\n                compiled[cue.id] = cue\n"),
    # the dependent's own delay is dropped when it follows an actual start
    "follower_delay_dropped": (SCHED, "            due = time_ms + compiled[follower].offset_ms + delays.get(follower, 0)",
                                      "            due = time_ms + compiled[follower].offset_ms"),
    # an interval-based slot check: a holder whose interval ends now counts as
    # gone when a cue is called, so the newcomer overtakes the waiting queue
    "release_by_interval_at_call": (SCHED, "            busy = ledger.busy(cue.uses)\n            if busy:\n",
                                           "            for r in list(live_reservations):\n                if r.interval.end_ms <= item.time_ms and statuses[r.cue_id].status == \"running\":\n                    ledger.release(r.cue_id, (r.resource_id,))\n            busy = ledger.busy(cue.uses)\n            if busy:\n"),
    # a held cue reserves its slots while it waits (blocks others)
    "held_cue_reserves": (SCHED, "                queue.add(item.time_ms, cue.id, busy)\n                continue",
                                 "                queue.add(item.time_ms, cue.id, busy)\n                ledger.acquire(cue.id, tuple(r for r in cue.uses if r not in busy))\n                continue"),
}


def run_suite() -> tuple[int, int]:
    for cache in WORK.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    proc = subprocess.run(
        [str(PY), "-B", "-m", "pytest", "-p", "no:cacheprovider", *TESTS],
        cwd=WORK, capture_output=True, text=True, env={"PYTHONPATH": "src", "PATH": "/usr/bin:/bin"},
    )
    tail = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr[-200:]
    failed = passed = 0
    for tok in tail.replace(",", " ").split():
        pass
    import re
    m = re.search(r"(\d+) failed", tail); failed = int(m.group(1)) if m else 0
    m = re.search(r"(\d+) passed", tail); passed = int(m.group(1)) if m else 0
    m = re.search(r"(\d+) error", tail); failed += int(m.group(1)) if m else 0
    return failed, passed


def main() -> int:
    assert subprocess.run(["git", "-C", str(WORK), "branch", "--show-current"], capture_output=True, text=True).stdout.strip() == "solution"
    ok = True
    for name, spec in MUTANTS.items():
        edits = spec if isinstance(spec, list) else [spec]
        originals = {}
        for path, old, new in edits:
            text = (WORK / path).read_text()
            assert text.count(old) == 1, (name, path, text.count(old))
            originals[path] = text
            (WORK / path).write_text(text.replace(old, new))
        try:
            failed, passed = run_suite()
        finally:
            for path, text in originals.items():
                (WORK / path).write_text(text)
        verdict = "caught" if failed else "*** SURVIVED ***"
        ok = ok and failed > 0
        print(f"{name:28s} failed={failed:3d} passed={passed:3d}  {verdict}")
    failed, passed = run_suite()
    print(f"{'(restored solution)':28s} failed={failed:3d} passed={passed:3d}")
    return 0 if ok and failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
