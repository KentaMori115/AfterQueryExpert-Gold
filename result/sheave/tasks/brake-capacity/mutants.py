#!/usr/bin/env python3
"""Mutate the reference solution and check the held-back suites catch it.

Every mutation is a mistake a careful build could actually make: a sign the
wrong way round, a cap left off, a unit dropped, a rule read at the wrong
strength. A mutation the suites do not catch is a rule nothing grades.
"""
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE / ".." / ".." / "work"
SCRATCH = pathlib.Path("/tmp/sheave-mutants")
HELD = ["test/holding.test.ts", "test/lowering.test.ts"]

MUTANTS = [
    ("winding takes the most", "src/safety/brake.ts",
     "const force = heldPull(of) + leastOutOfBalance(dutyOf(of));",
     "const force = heldPull(of) + mostOutOfBalance(dutyOf(of));"),
    ("lowering takes the least", "src/safety/brake.ts",
     "const force = heldPull(of) - mostOutOfBalance(dutyOf(of));",
     "const force = heldPull(of) - leastOutOfBalance(dutyOf(of));"),
    ("lowering may go negative", "src/safety/brake.ts",
     "  const force = heldPull(of) - mostOutOfBalance(dutyOf(of));\n  return round(Math.max(0, (force * 1000) / movingMass(dutyOf(of))), 4);",
     "  const force = heldPull(of) - mostOutOfBalance(dutyOf(of));\n  return round((force * 1000) / movingMass(dutyOf(of)), 4);"),
    ("winding may go negative", "src/safety/brake.ts",
     "  const force = heldPull(of) + leastOutOfBalance(dutyOf(of));\n  return round(Math.max(0, (force * 1000) / movingMass(dutyOf(of))), 4);",
     "  const force = heldPull(of) + leastOutOfBalance(dutyOf(of));\n  return round((force * 1000) / movingMass(dutyOf(of)), 4);"),
    ("the wheel never caps the shoes", "src/safety/brake.ts",
     "  if (of.drive.kind === \"drum\") return shoes;\n  return round(Math.min(shoes, gripPull(of)), 4);",
     "  return shoes;"),
    ("grip uses the whole capstan ratio", "src/safety/brake.ts",
     "const allowed = workingRatio(wheelOf(of), margin);",
     "const allowed = mostRatio(wheelOf(of));"),
    ("grip measures the taut side", "src/safety/brake.ts",
     "const passes = found.slack * (allowed - 1);",
     "const passes = found.taut * (allowed - 1);"),
    ("grip forgets the margin below one", "src/safety/brake.ts",
     "const passes = found.slack * (allowed - 1);",
     "const passes = found.slack * allowed;"),
    ("a drum winder answers the grip", "src/safety/brake.ts",
     "insist(of.drive.kind === \"koepe\", \"a drum winder holds by the shoes and not by the ropes\", \"drive\");",
     "if (of.drive.kind !== \"koepe\") return Number.POSITIVE_INFINITY;"),
    ("the worst is the end of the wind", "src/power/duty.ts",
     "  return round(Math.max(Math.abs(leastOutOfBalance(one)), Math.abs(mostOutOfBalance(one))), 4);",
     "  return round(Math.abs(outOfBalance(one, 0)), 4);"),
    ("holding ignores the wheel", "src/safety/brake.ts",
     "return heldPull(of) >= margin * worstOutOfBalance(dutyOf(of));",
     "return holdingPull(of) >= margin * worstOutOfBalance(dutyOf(of));"),
    ("the margin is two", "src/safety/brake.ts",
     "export const HOLDING_MARGIN = 3;",
     "export const HOLDING_MARGIN = 2;"),
    ("pressure sweeps the whole path", "src/safety/brake.ts",
     "const swept = Math.PI * one.diameter * (one.arc / 360) * one.width;",
     "const swept = Math.PI * one.diameter * one.width;"),
    ("pressure is left in kilonewtons", "src/safety/brake.ts",
     "return round(one.force / (swept * 1000), 4);",
     "return round(one.force / swept, 4);"),
    ("torque acts at the path diameter", "src/safety/brake.ts",
     "return round(one.friction * one.force * one.shoes * (one.diameter / 2), 4);",
     "return round(one.friction * one.force * one.shoes * one.diameter, 4);"),
    ("torque counts one shoe", "src/safety/brake.ts",
     "return round(one.friction * one.force * one.shoes * (one.diameter / 2), 4);",
     "return round(one.friction * one.force * (one.diameter / 2), 4);"),
    ("the pull is referred to the path", "src/safety/brake.ts",
     "return round(torque(brakeOf(of)) / dutyOf(of).radius, 4);",
     "return round(torque(brakeOf(of)) / (brakeOf(of).diameter / 2), 4);"),
    ("the overwind is answered lowering", "src/safety/brake.ts",
     "return retardationWinding(of) >= retardationFor(of.profile.full, overwindRoom(of.shaft));",
     "return retardationLowering(of) >= retardationFor(of.profile.full, overwindRoom(of.shaft));"),
    ("the force wanted is the capped one", "src/safety/brake.ts",
     "  const wanted = margin * worstOutOfBalance(dutyOf(of)) * dutyOf(of).radius;",
     "  const wanted = margin * heldPull(of) * dutyOf(of).radius;"),
    ("a sheet with no brake gets one anyway", "src/safety/brake.ts",
     "  const found = of.brake;\n  if (found === undefined) {\n    throw new WindingError(\"nothing has been said about that winder's brake\", \"brake\");\n  }\n  return found;",
     "  return of.brake ?? brake();"),
    ("the audit speaks about an unmeasured winder", "src/winder/audit.ts",
     "  const post = one.brake;\n  if (post === undefined) return out;",
     "  const post = one.brake ?? brake();"),
    ("the shoe limit is the lining's", "src/winder/audit.ts",
     "if (pressure(post) > MOST_SHOE_PRESSURE) {",
     "if (pressure(post) > 2) {"),
    ("a brake line defaults its arc", "src/winder/parse.ts",
     "    arc: plain(must(fields, \"arc\", \"brake\"), \"arc\"),",
     "    arc: orElse(fields, \"arc\", 60, plain),"),
    ("a brake line reads force as a number", "src/winder/parse.ts",
     "    force: parseForce(must(fields, \"force\", \"brake\"), \"force\"),",
     "    force: plain(must(fields, \"force\", \"brake\"), \"force\"),"),
    ("two brake lines are allowed", "src/winder/parse.ts",
     "  insist(building.brake === undefined, \"that file puts two brakes on one winder\", \"brake\");\n",
     ""),
    ("a brake line takes any word", "src/winder/parse.ts",
     "  onlyKnown(fields, [\"diameter\", \"width\", \"arc\", \"shoes\", \"friction\", \"force\"], \"brake\");\n",
     ""),
]

PRELUDE = {
    "grip uses the whole capstan ratio": (
        "src/safety/brake.ts",
        'import { SLIP_MARGIN, tensions, workingRatio } from "../drum/koepe.ts";',
        'import { SLIP_MARGIN, mostRatio, tensions, workingRatio } from "../drum/koepe.ts";',
    ),
    "the audit speaks about an unmeasured winder": (
        "src/winder/audit.ts",
        "import {\n  HOLDING_MARGIN,",
        "import {\n  brake,\n  HOLDING_MARGIN,",
    ),
}


def prepare():
    if SCRATCH.exists():
        shutil.rmtree(SCRATCH)
    shutil.copytree(WORK, SCRATCH, symlinks=True, ignore=shutil.ignore_patterns(".git"))
    modules = SCRATCH / "node_modules"
    if modules.is_symlink():
        modules.unlink()
    if not modules.exists():
        modules.symlink_to((WORK / ".." / "repo" / "node_modules").resolve())


def run_held():
    found = subprocess.run(
        ["node_modules/.bin/vitest", "run", *HELD, "--reporter=dot"],
        cwd=SCRATCH, capture_output=True, text=True,
    )
    return found.returncode, found.stdout + found.stderr


def main():
    prepare()
    code, output = run_held()
    if code != 0:
        print("the reference does not pass its own suites:\n" + output[-2000:])
        return 1
    print("reference: held-back suites green")

    caught = 0
    for name, path, before, after in MUTANTS:
        prepare()
        target = SCRATCH / path
        text = target.read_text()
        if before not in text:
            print(f"  MISSING  {name} ({path})")
            continue
        text = text.replace(before, after, 1)
        target.write_text(text)
        extra = PRELUDE.get(name)
        if extra:
            other = SCRATCH / extra[0]
            other.write_text(other.read_text().replace(extra[1], extra[2], 1))
        code, output = run_held()
        if code == 0:
            print(f"  SURVIVED {name}")
        else:
            caught += 1
            print(f"  caught   {name}")
    print(f"{caught} of {len(MUTANTS)} mutants caught")
    return 0 if caught == len(MUTANTS) else 2


if __name__ == "__main__":
    raise SystemExit(main())
