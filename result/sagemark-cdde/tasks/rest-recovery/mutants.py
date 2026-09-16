#!/usr/bin/env python3
"""Semantic mutants of the reference. Each one must fail at least one held-out
case: a mutant that survives is a rule the graded suite does not enforce.

Four earlier rows were dropped on 2026-09-06 as equivalent rather than
uncaught. `regainDice` already stops at what was spent, so the outer
`Math.min` around the long rest count changes nothing; `easeExhaustion` is
never reached at 0 or at 6, because the engine returns before it; and
`spendPact` left the graded surface when the instruction stopped naming it.
Their rules are covered by `regain-past-spent`, `never walks below rested` and
`exhaustion-drops-two`. Four more went on 2026-09-07 with the rules they
mutated: pact slots and the exhaustion-6 exception left the task when
Calibration II came back at 0 of 8 twice.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE / "work"
HELDOUT = HERE / "work-heldout"
NODE_MODULES = HERE.parent.parent / "repo" / "node_modules"
REST = "src/core/rules/rest.ts"
DICE = "src/core/rules/hit-dice.ts"
COND = "src/core/rules/conditions.ts"
SLOTS = "src/core/rules/spell-slots.ts"
SPECS = ["src/core/rules/checks/camp-ledger.spec.ts", "src/core/rules/checks/dice-pool.spec.ts"]

MUTANTS = {
    "short-rest-hours-zero": (REST, "return kind === 'long' ? LONG_REST_HOURS : SHORT_REST_HOURS", "return kind === 'long' ? LONG_REST_HOURS : 0"),
    "break-at-the-hour": (REST, "plan.breakMinutes > LONG_REST_BREAK_MINUTES", "plan.breakMinutes >= LONG_REST_BREAK_MINUTES"),
    "hours-against-the-plan": (REST, "if (plan.hours < requiredHours(kind)) {", "if (plan.hours < requiredHours(plan.kind)) {"),
    "no-downgrade": (REST, "if (plan.kind === 'long' && plan.breakMinutes > LONG_REST_BREAK_MINUTES) return 'short'", "if (false) return 'short'"),
    "dice-back-rounds-up": (REST, "Math.max(1, Math.floor(Math.max(0, level) / 2))", "Math.max(1, Math.ceil(Math.max(0, level) / 2))"),
    "smallest-die-first": (DICE, "for (const g of sortPool(pool)) {", "for (const g of [...sortPool(pool)].reverse()) {"),
    "regain-smallest-first": (DICE, "  for (const group of next) {", "  for (const group of [...next].reverse()) {"),
    "no-heal-floor": (DICE, "healed: Math.max(1, rolled + Math.floor(conModifier))", "healed: rolled + Math.floor(conModifier)"),
    "spends-past-full": (REST, "while (wanted > 0 && hp < member.hpMax && availableDice(pool) > 0)", "while (wanted > 0 && availableDice(pool) > 0)"),
    "incapacitated-spends": (REST, "if (kind === 'short' && !isIncapacitated(member.conditions))", "if (kind === 'short')"),
    "long-rest-spends-dice": (REST, "if (kind === 'short' && !isIncapacitated(member.conditions))", "if (!isIncapacitated(member.conditions))"),
    "short-rest-fills-hp": (REST, "    if (kind === 'long') {\n      hp = member.hpMax", "    if (true) {\n      hp = member.hpMax"),
    "short-rest-fills-slots": (REST, "      slots = refillSlots(slots)", "    }\n    {\n      slots = refillSlots(slots)"),
    "exhaustion-drops-two": (REST, "      if (member.fed) conditions = easeExhaustion(conditions)", "      if (member.fed) conditions = easeExhaustion(conditions, 2)"),
    "exhaustion-without-food": (REST, "      if (member.fed) conditions = easeExhaustion(conditions)", "      conditions = easeExhaustion(conditions)"),
    "unconscious-always-cleared": (REST, "    if (hp > 0) conditions = withoutConditions(conditions, ['unconscious'])", "    conditions = withoutConditions(conditions, ['unconscious'])"),
    "nothing-rests-off": (REST, "    conditions = withoutConditions(conditions, RESTS_OFF)", "    conditions = conditions"),
    "pool-keeps-flat-terms": (DICE, "      throw new HitDiceError(`hit dice cannot carry a flat term in \"${text}\"`)", "      continue"),
    "pool-keeps-modifiers": (DICE, "      throw new HitDiceError(`hit dice cannot carry a die modifier in \"${text}\"`)", "      continue"),
    "pool-keeps-negatives": (DICE, "      throw new HitDiceError(`hit dice cannot be subtracted in \"${text}\"`)", "      continue"),
    "pool-does-not-merge": (DICE, "    bySides.set(term.sides, (bySides.get(term.sides) ?? 0) + term.count)", "    bySides.set(term.sides, term.count)"),
    "regain-past-spent": (DICE, "    const back = Math.min(group.spent, left)", "    const back = left"),
    "incomplete-rest-still-rests": (REST, "  if (plan.hours < requiredHours(kind)) {", "  if (false) {"),
    "ledger-loses-order": (REST, "  for (const member of plan.party) {", "  for (const member of [...plan.party].reverse()) {"),
    
}


def run(only):
    survived = []
    for name, edit in MUTANTS.items():
        if only and name not in only:
            continue
        edits = edit if isinstance(edit, list) else [edit]
        with tempfile.TemporaryDirectory() as tmp:
            tree = pathlib.Path(tmp) / "t"
            tree.mkdir()
            tar = subprocess.run(["git", "-C", str(WORK), "archive", "HEAD"], check=True, capture_output=True).stdout
            subprocess.run(["tar", "-xf", "-", "-C", str(tree)], input=tar, check=True)
            solution = (HERE / "solution" / "solution.patch").read_text()
            subprocess.run(["git", "apply", "--whitespace=nowarn", "-"], cwd=tree, input=solution, text=True, check=True)
            for spec in SPECS:
                target = tree / spec
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text((HELDOUT / spec).read_text())
            (tree / "node_modules").symlink_to(NODE_MODULES)
            for rel, old, new in edits:
                path = tree / rel
                body = path.read_text()
                if body.count(old) != 1:
                    # A stale anchor tests nothing, so it counts against the run
                    # rather than scrolling past as a note.
                    print(f"SKIP     {name:28s} anchor hits {body.count(old)} times in {rel}")
                    survived.append(name)
                    break
                path.write_text(body.replace(old, new))
            else:
                out = tree / "report.json"
                subprocess.run(["npx", "vitest", "run", "--reporter=json", f"--outputFile={out}", *SPECS],
                               cwd=tree, capture_output=True, text=True)
                doc = json.loads(out.read_text()) if out.exists() else {"testResults": []}
                failed = [t for s in doc.get("testResults", []) for t in s.get("assertionResults", []) if t.get("status") != "passed"]
                crashed = [s for s in doc.get("testResults", []) if s.get("status") == "failed" and not s.get("assertionResults")]
                if failed or crashed:
                    print(f"OK       {name:28s} {len(failed):3d} cases fail" + (f", {len(crashed)} suites crashed" if crashed else ""))
                else:
                    print(f"SURVIVED {name:28s}")
                    survived.append(name)
    print(f"\n{len(survived)} survived" if survived else "\nevery mutant was caught")
    return 1 if survived else 0


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
