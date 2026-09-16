#!/usr/bin/env python3
"""Mutate the reference solution in place and check the graded cases object.

Each mutation is a plausible wrong reading of the request. A mutation that
leaves every graded case passing is a promise the tests do not enforce.
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE / "repo"
SRC = REPO / "packages/predation-engine/src"
GRADED = [
    "packages/predation-engine/src/rationing.test.ts",
    "packages/predation-engine/src/saturation.test.ts",
]

MUTATIONS = [
    ("greedy: settle one predator at a time off a running count",
     "settle.ts",
     "    const live = liveClaims(slate.claims, granted, left, budget);",
     "    const live = liveClaims(slate.claims, granted, left, budget).slice(0, 1);"),
    ("single round: never go round again",
     "settle.ts",
     "    if (moved === 0n) {\n      break;\n    }",
     "    if (moved >= 0n) {\n      break;\n    }"),
    ("budget trimmed by capping the first offers rather than in proportion",
     "rationing.ts",
     "  const shares = proportionalShares(",
     "  if (rows.length > 1 && pool > 0n) {\n"
     "    let room = pool;\n"
     "    for (const row of rows) {\n"
     "      const want = wanted.get(row.key) ?? 0n;\n"
     "      const give = want < room ? want : room;\n"
     "      offered.set(row.key, give);\n"
     "      room -= give;\n"
     "    }\n"
     "    return offered;\n"
     "  }\n"
     "  const shares = proportionalShares("),
    ("remainders handed out in claim order rather than key order",
     "rationing.ts",
     "  for (const share of assignRemainders(shares.assigned, shares.remainder, order)) {",
     "  for (const share of assignRemainders(shares.assigned, shares.remainder, [...order].reverse())) {"),
    ("prey split evenly instead of in proportion to the asks",
     "rationing.ts",
     "    rows.map((row) => ({ key: row.key, amount: wanted.get(row.key) ?? 0n })),",
     "    rows.map((row) => ({ key: row.key, amount: 1n })),"),
    ("saturated ask rounded twice instead of once",
     "response.ts",
     "  return roundHalfEven(\n    predatorCount * rule.perPredatorPerTick * preyCount,\n    precision.scale * density,\n  );",
     "  const flat = mul(predatorCount, rule.perPredatorPerTick, precision.scale, precision.rounding);\n"
     "  return roundHalfEven(flat * preyCount, density);"),
    ("condition blended for every hunter, fed or not",
     "hunger.ts",
     "  if (!tally || tally.asked <= 0n || tally.taken >= tally.asked) {",
     "  if (!tally || tally.asked <= 0n) {"),
    ("condition left alone entirely",
     "hunger.ts",
     "  return applyCondition(cohort, tally.asked, tally.taken, scale);",
     "  return cohort;"),
    ("pressure rows left in the order the claims were built",
     "consume.ts",
     "[...asked.keys()].sort(compareKeys)",
     "[...asked.keys()].sort((one, other) => compareKeys(other, one))"),
    ("claims that took nothing reported anyway",
     "consume.ts",
     "    if (quantity <= 0n) {\n      continue;\n    }",
     "    if (quantity < 0n) {\n      continue;\n    }"),
    ("saturated ask read against the prey left rather than the prey standing",
     "claims.ts",
     "      const ask = saturatedAsk(model.precision, rule, predator.count, prey.count);",
     "      const seen = availability.get(cohortKey(prey.species, prey.stage, prey.region));\n"
     "      const ask = saturatedAsk(\n"
     "        model.precision,\n"
     "        rule,\n"
     "        predator.count,\n"
     "        seen === undefined ? prey.count : seen / 2n,\n"
     "      );"),
    ("a species cap read per rule instead of across every rule",
     "consume.ts",
     "  const slate = buildClaims(model, cohorts);",
     "  const slate = buildClaims(model, cohorts);\n"
     "  for (const claim of slate.claims) {\n"
     "    const cap = slate.budgets.get(claim.predatorKey);\n"
     "    if (cap !== undefined) {\n"
     "      (slate.budgets as Map<string, bigint>).set(claim.predatorKey, cap * 2n);\n"
     "    }\n"
     "  }"),
]


def run_graded() -> tuple[int, int]:
    proc = subprocess.run(
        ["npx", "vitest", "run", "--config", "vitest.unit.config.ts", *GRADED, "--reporter=basic"],
        cwd=REPO, capture_output=True, text=True,
    )
    text = proc.stdout + proc.stderr
    passed = failed = 0
    for line in text.splitlines():
        if "Tests " in line and ("passed" in line or "failed" in line):
            for chunk in line.replace("|", " ").split():
                pass
            import re
            m = re.search(r"(\d+) failed", line)
            if m:
                failed = int(m.group(1))
            m = re.search(r"(\d+) passed", line)
            if m:
                passed = int(m.group(1))
    if passed == 0 and failed == 0:
        failed = -1
    return passed, failed


def main() -> int:
    caught = 0
    for label, filename, old, new in MUTATIONS:
        path = SRC / filename
        original = path.read_text()
        if old not in original:
            print(f"SKIP  {label}: anchor missing in {filename}")
            continue
        path.write_text(original.replace(old, new, 1))
        try:
            passed, failed = run_graded()
        finally:
            path.write_text(original)
        verdict = "caught" if failed != 0 else "MISSED"
        if failed != 0:
            caught += 1
        print(f"{verdict:7} {label}: {passed} passed, {failed} failed")
    print(f"\n{caught}/{len(MUTATIONS)} mutations caught")
    return 0 if caught == len(MUTATIONS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
