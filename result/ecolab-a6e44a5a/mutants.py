#!/usr/bin/env python3
"""Break the reference one rule at a time and check the held-back cases notice.

Each mutant edits repo/ in place, runs the three held-back files, then puts the
file back. A mutant that leaves every case green is a rule nothing grades.
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE / "repo"
HELDOUT = HERE / "heldout"
FILES = {
    "fixed-events.test.ts": "packages/tick-runtime/src/fixed-events.test.ts",
    "event-validation.test.ts": "packages/biome-model/src/event-validation.test.ts",
    "event-commands.test.ts": "packages/biomeweaver-cli/src/event-commands.test.ts",
}

MUTANTS = [
    ("leftovers walk the wrong way", "packages/tick-runtime/src/events.ts",
     "  const order = indices.map((index) => String(index));",
     "  const order = [...indices].reverse().map((index) => String(index));"),
    ("empty pools give it all to the first", "packages/tick-runtime/src/events.ts",
     "    amount: held === 0n ? 1n : (holdings[position] ?? 0n),",
     "    amount: held === 0n ? (position === 0 ? 1n : 0n) : (holdings[position] ?? 0n),"),
    ("a withdrawal ignores what a pool holds", "packages/tick-runtime/src/events.ts",
     "    const moved = adding ? share : min(share, pool.quantity);",
     "    const moved = share;"),
    ("the flow reports the share asked for", "packages/tick-runtime/src/events.ts",
     """        moved,
        scale,
        "fixed-event",""",
     """        share,
        scale,
        "fixed-event","""),
    ("the flow names the first pool's region", "packages/tick-runtime/src/events.ts",
     """        effect.resource,
        pool.region,""",
     """        effect.resource,
        pools[0]?.region ?? "unknown","""),
    ("the window runs one tick too long", "packages/biome-model/src/records.ts",
     "  return tick >= atTick && tick < atTick + effect.forTicks;",
     "  return tick >= atTick && tick <= atTick + effect.forTicks;"),
    ("hooks fire in file order", "packages/tick-runtime/src/events.ts",
     """  const hooks = [...scenario.events].sort(
    (left, right) => left.atTick - right.atTick || left.event.localeCompare(right.event),
  );""",
     "  const hooks = [...scenario.events];"),
    ("overlapping factors multiply without rounding", "packages/resource-engine/src/modifiers.ts",
     "    factor = mul(factor, override.factor, scale, \"half-even\");",
     "    factor = (factor * override.factor) / scale;"),
    ("a modifier reaches every region", "packages/resource-engine/src/modifiers.ts",
     "  return override.region === undefined || override.region === region;",
     "  return true;"),
    ("an unknown region compiles", "packages/biome-model/src/compile.ts",
     "      if (effect.region !== undefined && !regions[effect.region]) {",
     "      if (false && effect.region !== undefined && !regions[effect.region]) {"),
    ("an unknown resource compiles", "packages/biome-model/src/compile.ts",
     "      if (effect.resource !== undefined && !resources[effect.resource]) {",
     "      if (false && effect.resource !== undefined && !resources[effect.resource]) {"),
    ("a short window compiles", "packages/biome-model/src/decode.ts",
     "  if (raw < 1) {",
     "  if (false) {"),
    ("a negative factor compiles", "packages/biome-model/src/decode.ts",
     "    if (factor < 0n) {",
     "    if (false) {"),
    ("an effect carrying nothing compiles", "packages/biome-model/src/decode.ts",
     "  if (!isQuantityEffect(effect) && !isModifierEffect(effect)) {",
     "  if (false) {"),
    ("event show prints one line for the event", "packages/biomeweaver-cli/src/router.ts",
     "      return result(\n        ExitCode.OK,\n        `${event.effects.map((effect) => effectLine(effect, scale)).join(\"\\n\")}\\n`,\n      );",
     "      return result(ExitCode.OK, `${event.id}\\n`);"),
    ("event list ignores order", "packages/biomeweaver-cli/src/router.ts",
     "        `${Object.keys(loaded.compiled.model?.events ?? {})\n          .sort()\n          .join(\"\\n\")}\\n`,",
     "        `${Object.keys(loaded.compiled.model?.events ?? {})\n          .sort()\n          .reverse()\n          .join(\"\\n\")}\\n`,"),
]


def run_cases():
    proc = subprocess.run(
        ["npx", "vitest", "run", "--config", "vitest.unit.config.ts", *FILES.values(),
         "--reporter=dot"],
        cwd=REPO, capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main():
    for name, path in FILES.items():
        shutil.copy(HELDOUT / name, REPO / path)
    code, output = run_cases()
    if code != 0:
        print("the reference does not pass its own cases; stopping")
        print(output[-2000:])
        return 1
    print("reference: all cases green")

    survivors = []
    for label, rel, before, after in MUTANTS:
        target = REPO / rel
        original = target.read_text()
        if before not in original:
            print("SKIP  %-46s (anchor not found in %s)" % (label, rel))
            survivors.append(label)
            continue
        target.write_text(original.replace(before, after, 1))
        code, output = run_cases()
        target.write_text(original)
        caught = code != 0
        print("%-5s %s" % ("caught" if caught else "LIVES", label))
        if not caught:
            survivors.append(label)

    for path in FILES.values():
        (REPO / path).unlink(missing_ok=True)
    print("\n%d mutants, %d survivors" % (len(MUTANTS), len(survivors)))
    for s in survivors:
        print("  survivor:", s)
    return 1 if survivors else 0


if __name__ == "__main__":
    raise SystemExit(main())
