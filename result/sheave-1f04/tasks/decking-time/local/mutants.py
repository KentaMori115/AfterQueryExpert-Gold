#!/usr/bin/env python3
"""Mutate the reference solution one stated rule at a time.

Every rule the instruction states should have a case that fails when the
rule is broken. Each row here breaks exactly one of them, builds the patch
an agent would have committed, and runs the real tests/test.sh in the
verifier mirror. A row that still scores 1 is a rule nothing grades.
"""

import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
DEV = (TASK / ".." / ".." / "repo").resolve()
OUT = HERE / "mutants"

MODULE = "src/cycle/decking.ts"

# name -> (file, before, after)
MUTANTS = {
    "stand-adds-both-ends": (
        MODULE,
        "return Math.max(standAt(one, rising, creep), standAt(one, falling, creep));",
        "return round(standAt(one, rising, creep) + standAt(one, falling, creep), 1);",
    ),
    "redecking-moves-once-a-deck": (
        MODULE,
        "return round((decks - 1) * deckMove(one, creep), 1);",
        "return round(decks * deckMove(one, creep), 1);",
    ),
    "move-forgets-the-keps": (
        MODULE,
        "return round(one.pitch / creep + one.settle, 1);",
        "return round(one.pitch / creep, 1);",
    ),
    "deck-change-forgets-the-tubs": (
        MODULE,
        "return round(one.perTub * one.tubsADeck, 1);",
        "return round(one.perTub, 1);",
    ),
    "skip-stands-once-a-deck": (
        MODULE,
        'if (what.kind === "skip") return round(one.discharge, 1);',
        'if (what.kind === "skip") return round(what.decks * one.discharge, 1);',
    ),
    "counterweight-stands-like-a-cage": (
        MODULE,
        'if (what.kind === "counterweight") return 0;',
        'if (what.kind === "counterweight") return round(deckChange(one), 1);',
    ),
    "profile-loses-its-other-figures": (
        MODULE,
        "return profile({ ...how, rest: stand(one, rising, falling, how.creep) });",
        "return profile({ rest: stand(one, rising, falling, how.creep) });",
    ),
    "cage-tared-at-its-payload": (
        MODULE,
        "tare: round(CAGE_TARE * held, 1),",
        "tare: round(held, 1),",
    ),
    "cage-ignores-the-rope": (
        MODULE,
        "return room >= held ? built : conveyance({ ...built, payload: round(room, 1) });",
        "return built;",
    ),
    "decks-allowed-counts-past-the-rope": (
        MODULE,
        "if (cage.payload < held) break;",
        "if (cage.payload < 0) break;",
    ),
    "best-decks-takes-the-higher-tie": (
        MODULE,
        "if (found > raised) {",
        "if (found >= raised) {",
    ),
    "deck-payload-forgets-the-tubs-a-deck": (
        MODULE,
        "return round(decks * one.tubsADeck * aTub, 1);",
        "return round(decks * aTub, 1);",
    ),
    "standing-share-against-the-wind": (
        MODULE,
        "return round(working.rest / whole, 4);",
        "return round(working.rest / (whole - working.rest), 4);",
    ),
    "a-day-is-always-sixteen-hours": (
        MODULE,
        "return round(raises(how, one, decks, distance, allowed, aTub) * hours, 1);",
        "return round(raises(how, one, decks, distance, allowed, aTub) * 16, 1);",
    ),
    "keps-take-five-seconds": (
        MODULE,
        "export const SETTLING = 4;",
        "export const SETTLING = 5;",
    ),
    "a-settling-of-nothing-is-refused": (
        MODULE,
        'nonNegative(found.settle, "settle");',
        'positive(found.settle, "settle");',
    ),
    "a-negative-discharge-is-allowed": (
        MODULE,
        'nonNegative(found.discharge, "discharge");',
        'real(found.discharge, "discharge");',
    ),
    "half-a-tub-a-deck-is-allowed": (
        MODULE,
        'count(found.tubsADeck, "tubsADeck");',
        'positive(found.tubsADeck, "tubsADeck");',
    ),
    "worth-of-a-deck-the-other-way-round": (
        MODULE,
        "raises(how, one, decks + 1, distance, allowed, aTub) - raises(how, one, decks, distance, allowed, aTub),",
        "raises(how, one, decks, distance, allowed, aTub) - raises(how, one, decks + 1, distance, allowed, aTub),",
    ),
}


def build(name, spec):
    path, before, after = spec
    OUT.mkdir(exist_ok=True)
    work = tempfile.mkdtemp()
    subprocess.run(["git", "-C", str(DEV), "worktree", "add", "-q", "--detach", work, "solution"], check=True)
    target = pathlib.Path(work) / path
    text = target.read_text()
    if before not in text:
        subprocess.run(["git", "-C", str(DEV), "worktree", "remove", "--force", work], check=False)
        raise SystemExit(f"{name}: pattern not found in {path}")
    target.write_text(text.replace(before, after, 1))
    subprocess.run(["git", "-C", work, "add", "-A", "."], check=True)
    patch = subprocess.run(["git", "-C", work, "diff", "--binary", "main", "--cached"],
                           capture_output=True, text=True, check=True).stdout
    (OUT / f"{name}.patch").write_text(patch)
    subprocess.run(["git", "-C", str(DEV), "worktree", "remove", "--force", work], check=False)
    return OUT / f"{name}.patch"


def main():
    only = sys.argv[1:] or list(MUTANTS)
    bad = 0
    for name in only:
        patch = build(name, MUTANTS[name])
        out = subprocess.run(["bash", str(HERE / "verify_task.sh"), "patch", str(patch)],
                             capture_output=True, text=True).stdout
        found = re.search(r'"reward": ([0-9.]+)', out)
        reward = found.group(1) if found else "none"
        counts = re.search(r'"f2p_passed": (\d+).*?"p2p_passed": (\d+)', out)
        detail = f"f2p {counts.group(1)}/91 p2p {counts.group(2)}/350" if counts else out.strip()[-200:]
        verdict = "OK" if reward == "0" else "SURVIVED"
        if verdict != "OK":
            bad += 1
        print(f"{verdict:9} {name:38} reward={reward}  {detail}", flush=True)
    print(f"{bad} mutants survived of {len(only)}")


if __name__ == "__main__":
    main()
