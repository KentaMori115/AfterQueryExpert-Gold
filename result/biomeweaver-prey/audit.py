#!/usr/bin/env python3
"""Four checks between instruction.md and the graded cases.

1. every property the cases read off a result appears in the instruction
2. every function the cases import or call is named in the instruction, or
   lives in the base checkout
3. every function the instruction names is reached by a case
4. every field the instruction names carries at least one assertion
"""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTRUCTION = (HERE / "tasks/prey-competition/instruction.md").read_text()
TESTS = [HERE / "heldout/rationing.test.ts", HERE / "heldout/saturation.test.ts"]
BASE = HERE / "base-tree"

SKIP = {
    # vitest and language builtins
    "toBe", "toEqual", "toHaveLength", "not", "map", "filter", "reduce", "find",
    "sort", "join", "split", "replace", "includes", "length", "push", "keys",
    "values", "entries", "toString", "slice", "text", "each", "some", "every",
    "flatMap", "concat", "trim", "startsWith", "endsWith", "then", "catch",
    # helpers defined inside the test files themselves
    "predation", "maxIntakePerTick", "perPredatorPerTick", "preyStage",
    "saturation", "prey", "stage", "region", "asked", "taken", "quantity",
    "predator", "rule", "count", "condition", "species", "removals",
    "pressure", "cohorts", "diagnostics", "model", "severity", "biome",
    "initialStage", "stages", "needs", "mortality", "transitions", "id",
    "name", "ageTicks", "scale", "rounding", "precision", "root", "recursive",
}


def base_symbols() -> set[str]:
    out = subprocess.run(
        ["grep", "-rhoE", r"export (function|const|type|class) [A-Za-z][A-Za-z0-9_]*",
         str(BASE / "packages"), str(BASE / "ecosystem-lab")],
        capture_output=True, text=True,
    ).stdout
    found = {line.split()[-1] for line in out.splitlines()}
    # node builtins and the runner's own globals are not task contracts
    return found | {
        "describe", "expect", "it", "cpSync", "mkdtempSync", "readFileSync",
        "writeFileSync", "tmpdir", "join", "fromEntries", "js", "yaml", "records",
        "Error", "Map", "Set", "Object", "JSON",
    }


def main() -> int:
    text = "\n".join(path.read_text() for path in TESTS)
    instruction = INSTRUCTION
    known = base_symbols()
    problems = []

    # 1 + 2: names the cases reach for
    reached = set(re.findall(r"\.([a-z][A-Za-z0-9]*)\b", text))
    imported = set(re.findall(r"import \{([^}]*)\}", text))
    called = set()
    for group in imported:
        for item in group.split(","):
            item = item.strip().removeprefix("type ").strip()
            if item:
                called.add(item)
    for symbol in sorted(reached | called):
        if symbol in SKIP or symbol in known:
            continue
        if symbol in instruction:
            continue
        problems.append(f"[1/2] cases reach `{symbol}`, which is neither in the base "
                        f"checkout nor named in the instruction")

    # 3: every backticked name in the instruction is reached by a case
    named = set(re.findall(r"`([A-Za-z][A-Za-z0-9]*)`", instruction))
    for symbol in sorted(named):
        if symbol not in text:
            problems.append(f"[3] instruction names `{symbol}`, no case mentions it")

    # 4: every field named in the instruction carries an assertion
    fields = ["maxIntakePerTick", "saturation", "perPredatorPerTick", "asked", "taken",
              "prey", "stage", "region"]
    for field in fields:
        if field not in instruction:
            continue
        hits = len(re.findall(rf"\b{field}\b", text))
        if hits == 0:
            problems.append(f"[4] instruction names `{field}`, no case asserts on it")

    for line in problems:
        print(line)
    print(f"\n{len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
