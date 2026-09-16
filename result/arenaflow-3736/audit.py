#!/usr/bin/env python3
"""Both directions of the instruction-to-case audit, plus a name sweep.

1. every sentence of instruction.md maps to at least one graded case
2. every graded case maps to a sentence
3. every identifier and string literal the held-back suite touches is either in
   the base checkout or named by the instruction
"""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "match-void-rescore"
BASE = HERE / "base-tree"
HELDOUT = HERE / "heldout"

# sentence number (1 based, over instruction.md) -> case names it is graded by
MAP = {
    3: ["marks the match voided at the withdrawal time"],
    4: ["marks the match voided at the withdrawal time",
        "keeps the results the match was completed with",
        "keeps the withdrawn match on the tournament and leaves the rest completed"],
    5: ["refuses a match that was never completed",
        "refuses a match that is already withdrawn",
        "refuses once the tournament is no longer active"],
    6: ["refuses a blank reason",
        "refuses a match nobody recorded",
        "writes nothing when it refuses"],
    8: ["rebuilds the total from the matches that still stand",
        "rebuilds the win, loss and draw counts",
        "stamps the rebuilt record with the last match that still counts",
        "walks two matches settled together by match id",
        "orders matches settled together the same way the live run did",
        "never lets a withdrawn match feed a later rebuild",
        "rebuilds only from the tournament the match belongs to",
        "scores the rebuild through the tournament's own multiplier",
        "scores the rebuild through a custom formula"],
    9: ["brings the best streak back down",
        "leaves one reason behind per result that still counts",
        "stops paying a streak bonus the withdrawn win earned",
        "rebuilds a player's profile with it",
        "reranks the board on the rebuilt totals"],
    10: ["zeroes a player left with nothing",
         "stamps an emptied record with the withdrawal time",
         "keeps an emptied player on the board",
         "empties the same player the live run emptied"],
    11: ["leaves a player the match never touched exactly as it was",
         "rebuilds nobody outside the withdrawn match"],
    12: ["answers with the match, the tournament, the reason and the moment",
         "answers with the rebuilt records in player id order",
         "withdraws over http and answers with the rebuilt records"],
    13: ["lands on the match stream carrying the reason",
         "leaves the streams of the matches it did not touch alone",
         "reaches the scores the live run left behind",
         "marks the match voided in the projection too",
         "reaches the same scores after two withdrawals",
         "survives a reload of the store",
         "continues from a snapshot taken before the withdrawal"],
    14: ["withdraws over http and answers with the rebuilt records",
         "maps a refused withdrawal onto its usual status",
         "withdraws through the sdk",
         "offers the withdrawal on the command line"],
    15: ["counts what a tournament had withdrawn"],
}
# sentences that set the scene rather than state a rule
CONTEXT = {1, 2, 7}

# names the suite may use that the instruction does not spell out, each one
# already in the base checkout or a language built-in
BASE_NAMES = {
    "test", "ts", "map", "filter", "find", "sort", "every", "some", "length",
    "get", "toBe", "toEqual", "toContain", "toBeCloseTo", "toBeDefined",
    "toHaveLength", "toThrow", "handle", "then", "catch", "push", "slice",
    "trim", "join", "split", "keys", "values", "entries", "status", "body",
    "at", "id", "name", "type", "payload", "reason", "match", "rebuilt",
}

# ids and locals the cases author themselves. None of these is a contract the
# build has to invent.
FIXTURE_NAMES = {
    "plr_ann", "plr_ben", "plr_cal", "plr_dot", "tnm_cup", "tnm_open",
    "mch_1", "mch_2", "mch_3", "mch_a", "mch_b", "mch_z", "mch_x", "mch_s",
    "Ann", "Ben", "Cal", "Dot", "Cup", "Open", "opponent disconnected",
    "misreported", "too early", "too late", "again", "wrong winner",
    "duplicate submission", "leaderboard", "arena", "store", "service",
    "scoreOf", "play", "seeded", "compare", "withdrawal", "projected",
}


def sentences(text):
    body = text.split("IMPORTANT: Please work")[0]
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", body.strip()) if s.strip()]


def main():
    instruction = (TASK / "instruction.md").read_text()
    sents = sentences(instruction)
    cfg = json.loads((TASK / "tests" / "config.json").read_text())
    held_files = {f.name for f in HELDOUT.glob("*.ts")}
    held_names = set()
    for node in cfg["f2p_node_ids"]:
        cut = node.find(".test.ts.")
        path, name = node[: cut + 8], node[cut + 9 :]
        if Path(path).name in held_files:
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
    # colon commands such as `match:void` are one name, not two
    words.update(re.findall(r"[A-Za-z][A-Za-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*", instruction))
    base_text = subprocess.run(
        ["git", "grep", "-h", "-o", "-E", r"[A-Za-z][A-Za-z0-9_.-]+"],
        cwd=BASE, capture_output=True, text=True,
    ).stdout
    base_words = set(base_text.split())
    for suite in sorted(HELDOUT.glob("*.ts")):
        text = suite.read_text()
        surface = set()
        for line in text.splitlines():
            hit = re.match(r'\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"', line)
            if hit and not hit.group(2).startswith("node:") and hit.group(2) != "vitest":
                surface.update(part.strip() for part in hit.group(1).split(","))
        surface.update(re.findall(r"\.([a-zA-Z_][A-Za-z0-9_]*)\b(?!\s*\()", text))
        for call in re.findall(r"(?:toBe|toContain|toEqual)\(([^)]*)\)", text):
            surface.update(re.findall(r'"([^"]+)"', call))
        for token in sorted(surface):
            if not token:
                continue
            if token in words or token in base_words or token in BASE_NAMES or token in FIXTURE_NAMES:
                continue
            problems.append("%s leans on %r, which is neither in the base tree nor named" % (suite.name, token))

    if problems:
        for line in sorted(set(problems)):
            print("PROBLEM:", line)
        return 1
    print("sentences: %d (%d scene setting, %d graded)" % (len(sents), len(CONTEXT), len(MAP)))
    print("graded held-back cases: %d, all mapped" % len(held_names))
    print("no unexplained name in the held-back suite")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
