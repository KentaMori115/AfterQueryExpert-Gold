#!/usr/bin/env python3
"""Break the reference one edit at a time and check the graded cases notice.

Each mutant is a single substitution in the reference solution: the wrong mass
in a formula, the wrong sign, the wrong length. A mutant that still passes is a
promise the request makes and nothing checks.

Run against a work tree that already has the solution and the held-back tests
in it. Vitest is used here rather than the verifier's own runner because the
two agree case for case (350 of 350 and 110 of 110 in the reference run), and
this way a mutant costs three seconds instead of a minute.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

MUTANTS = [
    ("whole rope swings, not a third",
     "src/rope/dynamics.ts", "own * MOVING_THIRD", "own"),
    ("balance rope left out of the swing",
     "src/rope/dynamics.ts", "one.carried + one.balance + own * MOVING_THIRD", "one.carried + own * MOVING_THIRD"),
    ("balance rope swings at a third too",
     "src/rope/dynamics.ts", "one.carried + one.balance + own * MOVING_THIRD", "one.carried + (one.balance + own) * MOVING_THIRD"),
    ("stiffness off the caliper circle, not the steel",
     "src/rope/dynamics.ts", "const area = steelArea(one.rope) * one.ropes;", "const area = circleArea(one.rope.diameter) * one.ropes;"),
    ("stiffness at the steel's own modulus",
     "src/rope/dynamics.ts", "return round(YOUNGS * share, 1);", "return round(YOUNGS, 1);"),
    ("locked coil no stiffer than laid",
     "src/rope/dynamics.ts", "export const LOCKED_MODULUS = 0.75;", "export const LOCKED_MODULUS = 0.55;"),
    ("ropes do not add stiffness",
     "src/rope/dynamics.ts", "const area = steelArea(one.rope) * one.ropes;", "const area = steelArea(one.rope);"),
    ("own weight stretches it in full",
     "src/rope/dynamics.ts", "stretchUnder(one, own / 2)", "stretchUnder(one, own)"),
    ("period without the two pi",
     "src/rope/dynamics.ts", "2 * Math.PI * Math.sqrt(mass / rate)", "Math.sqrt(mass / rate)"),
    ("a sudden load does what a gentle one does",
     "src/rope/shock.ts", "export const SUDDEN = 2;", "export const SUDDEN = 1;"),
    ("falling adds instead of taking off",
     "src/rope/shock.ts", "return round(staticPull(one) - SUDDEN * steadyRise(one, retardation), 4);",
     "return round(staticPull(one) + SUDDEN * steadyRise(one, retardation), 4);"),
    ("the set's strength counted as one rope",
     "src/rope/shock.ts", "(breakingLoad(one.rope) * one.ropes) / peak", "breakingLoad(one.rope) / peak"),
    ("rope measured from the bank, not the sheave",
     "src/winder/model.ts", "length: ropeWanted(one) - up,", "length: windLength(one) - up,"),
    ("balance rope as long as the rope above it",
     "src/winder/model.ts", "balance: one.balance * up,", "balance: one.balance * (windLength(one) - up),"),
    ("worst point taken at the pit bottom",
     "src/winder/model.ts", "for (let up = 1; up <= wind; up += 1) {", "for (let up = 1; up <= 0; up += 1) {"),
    ("no allowance for the worst rope of a set",
     "src/winder/model.ts", "const uneven = worstShare(one.ropes) * one.ropes;", "const uneven = 1;"),
    ("the stop check floored above the rule",
     "src/design/checks.ts", "stop: over.stop ?? DEEPEST_FACTOR,", "stop: over.stop ?? 5,"),
    ("the command sheet leaves the period off",
     "src/cli/commands/bounce.ts",
     '["the period it bounces at", seconds(bouncePeriod(one))],', ""),
    ("the command sheet reports a period that ignores the rope",
     "src/cli/commands/bounce.ts", "seconds(bouncePeriod(one))", "seconds(1)"),
    ("the command sheet reports a factor that ignores the rope",
     "src/cli/commands/bounce.ts", "sayFactor(shockFactor(one, retardation))", "sayFactor(9)"),
    ("the audit says nothing about a stop",
     "src/winder/audit.ts", "if (worst.factor < DEEPEST_FACTOR) {", "if (false) {"),
]


def main():
    tree = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    survivors = []
    for name, where, before, after in MUTANTS:
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp) / "repo"
            shutil.copytree(tree, work, symlinks=True,
                            ignore=shutil.ignore_patterns(".git", "node_modules"))
            (work / "node_modules").symlink_to(tree / "node_modules")
            target = work / where
            text = target.read_text()
            if before not in text:
                print(f"  ?? {name}: pattern not found in {where}")
                survivors.append(name)
                continue
            target.write_text(text.replace(before, after, 1))
            done = subprocess.run(
                ["node_modules/.bin/vitest", "run", "--reporter=basic"],
                cwd=work, capture_output=True, text=True, timeout=600,
            )
            caught = done.returncode != 0
            print(f"  {'caught ' if caught else 'SURVIVED'} {name}")
            if not caught:
                survivors.append(name)
    print(f"\n{len(MUTANTS) - len(survivors)} of {len(MUTANTS)} caught")
    for each in survivors:
        print(f"  survivor: {each}")
    return 1 if survivors else 0


if __name__ == "__main__":
    raise SystemExit(main())
