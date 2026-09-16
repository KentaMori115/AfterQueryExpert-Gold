#!/usr/bin/env python3
"""Both directions of the instruction-to-case audit, plus a name sweep.

1. every sentence of instruction.md maps to at least one graded case
2. every graded case maps to a sentence
3. every identifier and string literal the held-back suite touches is either in
   the base checkout or named by the instruction
4. the declared id sets and the reports agree
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "event-effects"
BASE = HERE / "base-tree"
HELDOUT = HERE / "heldout"

# sentence number (1 based, over instruction.md) -> case names it is graded by
MAP = {
    3: ["splits a withdrawal in proportion to what each pool holds",
        "carries the moving pool's own region on each flow",
        "reports the quantity a pool really gave up"],
    4: ["reaches only the region an effect names",
        "keeps a modifier effect inside the region it names",
        "runs an effect that named no window on its hook tick alone"],
    5: ["keeps an effect running for the whole window it authored",
        "closes a window on the tick after it ends",
        "runs only the part of a window that falls inside the run"],
    6: ["runs two disturbances on one tick in event id order",
        "runs the effects of one event in the order the file lists them"],
    7: ["reaches only the region an effect names",
        "does nothing for a resource the scenario never pooled"],
    8: ["splits a withdrawal in proportion to what each pool holds",
        "spreads an addition the same way it spreads a withdrawal"],
    9: ["hands a single leftover unit to the first region in id order",
        "walks two leftover units down the region order",
        "splits evenly across pools that hold nothing between them"],
    10: ["takes no more from a pool than the pool holds"],
    11: ["publishes one flow for every pool that moved",
         "carries the moving pool's own region on each flow",
         "reports the quantity a pool really gave up",
         "says nothing about a pool it never moved"],
    12: ["scales renewal while a modifier window runs",
         "keeps a modifier effect inside the region it names",
         "gives renewal back once the window closes"],
    13: ["multiplies two windows over one key, rounding at each step"],
    14: ["scales renewal while a modifier window runs"],
    15: ["leaves a modifier effect out of the flow record"],
    16: ["refuses an effect naming a resource the capsule never defines",
         "refuses an effect naming a region the capsule never defines",
         "refuses an unknown region on a modifier effect too",
         "refuses a resource carrying no quantity",
         "refuses a modifier carrying no factor",
         "refuses an effect that carries nothing at all",
         "refuses an effect that is not a record",
         "refuses a window shorter than one tick",
         "refuses a window that is not a whole number of ticks",
         "refuses a negative factor",
         "accepts an effect that moves a resource in a region it knows",
         "accepts an effect that scales a modifier for several ticks"],
    17: ["lists every authored event in id order",
         "lists nothing for a capsule that authors no event"],
    18: ["prints one line for each effect an event carries",
         "names the resource an effect moves",
         "names the modifier an effect scales",
         "refuses an event id the capsule never defines"],
}
# sentences that set the scene rather than state a rule
CONTEXT = {1, 2}

# names the suite may use that the instruction does not spell out, each one
# already in the base checkout
BASE_NAMES = {
    "compileCapsule", "simulate", "runCommand", "fixed-event", "resource-renewal",
    "biomeweaver.yaml", "initialPopulations", "initialResources", "durationTicks",
    "atTick", "kind", "seasons", "startTick", "endTick", "renewable",
    "renewalPerTick", "modifiers", "capacity", "include", "precision", "scale",
    "rounding", "defaultScenario", "displayName", "calendar", "effects",
    "diagnostics", "severity", "model", "pools", "states", "flows", "cause",
    "tick", "exitCode", "stdout", "quantity", "region", "resource", "id", "name",
    "biome", "moss-growth", "salt-growth", "message", "scenarios", "length",
    "test", "ts", "json", "yaml", "map", "filter", "find", "sort", "split",
    "trim", "entries", "get", "toString", "slice", "join", "reduce", "some",
    "every", "keys", "values", "push", "concat", "replace", "startsWith",
    "endsWith", "includes", "spec", "stderr", "0", "1", "2",
}

# ids and locals the suites author themselves, plus the six decimal form that
# docs/fixed-point-policy.md and formatFixed already fix. None of these is a
# contract the build has to invent.
FIXTURE_NAMES = {
    "CAPSULE", "BASE", "overrides",
    "east", "north", "west", "salt", "moss", "flats", "flat-year", "dry",
    "north-flat", "spring-melt", "autumn-flood", "drain", "seed", "bloom",
    "2.000000", "8.000000",
}


def sentences(text):
    body = text.split("IMPORTANT: Please work")[0]
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", body.strip()) if s.strip()]


def main():
    instruction = (TASK / "instruction.md").read_text()
    sents = sentences(instruction)
    cfg = json.loads((TASK / "tests" / "config.json").read_text())
    declared = cfg["f2p_node_ids"] + cfg["p2p_node_ids"]
    held_names = set()
    for node in declared:
        cut = node.find(".test.ts.")
        path, name = node[: cut + 8], node[cut + 9 :]
        if Path(path).name in {f.name for f in HELDOUT.glob("*.ts")}:
            held_names.add(name.split(" > ", 1)[-1])

    problems = []

    for index in range(1, len(sents) + 1):
        if index in CONTEXT:
            continue
        if index not in MAP or not MAP[index]:
            problems.append("sentence %d has no graded case: %s" % (index, sents[index - 1][:70]))
    for index, names in MAP.items():
        if index > len(sents):
            problems.append("mapping names sentence %d, which does not exist" % index)
        for case in names:
            if case not in held_names:
                problems.append("mapping names a case nobody declared: %s" % case)

    mapped = {c for names in MAP.values() for c in names}
    for case in sorted(held_names - mapped):
        problems.append("graded case maps to no sentence: %s" % case)

    # the contract surface a case leans on: what it imports, the properties it
    # reads off whatever the build returns, and the fixed strings it compares
    # against. Fixture ids and local names are the case's own inputs, not
    # contracts, so they are left out.
    words = set(re.findall(r"[A-Za-z][A-Za-z0-9_-]+", instruction))
    base_text = subprocess.run(
        ["git", "grep", "-h", "-o", "-E", r"[A-Za-z][A-Za-z0-9_.-]+"],
        cwd=BASE, capture_output=True, text=True,
    ).stdout
    base_words = set(base_text.split())
    for suite in HELDOUT.glob("*.ts"):
        text = suite.read_text()
        surface = set()
        for line in text.splitlines():
            hit = re.match(r'\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"', line)
            if hit:
                if not hit.group(2).startswith("node:") and hit.group(2) != "vitest":
                    surface.update(part.strip() for part in hit.group(1).split(","))
                continue
        surface.update(re.findall(r"\.([a-zA-Z_][A-Za-z0-9_]*)\b(?!\s*\()", text))
        for call in re.findall(r"(?:toBe|toContain|toEqual)\(([^)]*)\)", text):
            surface.update(re.findall(r'"([^"]+)"', call))
        surface.update(re.findall(r'(?:cause|kind)\s*===\s*"([^"]+)"', text))
        for token in sorted(surface):
            if not token or token in words or token in base_words or token in BASE_NAMES or token in FIXTURE_NAMES:
                continue
            problems.append("%s leans on %r, which is neither in the base tree nor named" % (suite.name, token))

    if problems:
        for line in sorted(set(problems)):
            print("PROBLEM:", line)
        return 1
    print("sentences: %d (%d context, %d graded)" % (len(sents), len(CONTEXT), len(MAP)))
    print("graded held-back cases: %d, all mapped" % len(held_names))
    print("no unexplained name in the held-back suite")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
