#!/usr/bin/env python3
"""Two checks that quality review has failed tasks on before.

1. Bidirectional: every sentence of the request is enforced by at least one
   graded case, and every graded case traces back to a sentence.
2. Reading side: every identifier and string literal the held-back suite
   touches is either in the base checkout or named by the request. A name that
   is in neither is a contract nobody stated.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "reward-recall"
INSTRUCTION = TASK / "instruction.md"
CONFIG = json.loads((TASK / "tests" / "config.json").read_text())
HELDOUT = sorted((HERE / "heldout").glob("*.test.ts"))
BASE = HERE / "base-tree"

# Sentences that set the scene rather than state a rule. They carry no case
# by design and are listed here so the count below stays honest.
SCENE = {
    "ArenaFlow pays a tournament once and can never take it back.",
    "`RewardRevoked` is a declared event nothing appends, and `engine/rewards/claims.ts` exports a window check nobody calls, so `claimWindowMs` decides nothing.",
    "Leave existing tests as they are.",
    "IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.",
}

# sentence fragment -> the graded case names it is enforced by
MAP = {
    "`revokeReward(rewardId, at, reason)` takes one reward back.": [
        "revokes it and keeps the record",
        "revokes one reward and refuses a claimed one",
    ],
    "Blank reason is an invalid argument": [
        "needs a reason",
        "refuses a reward nobody granted",
        "refuses the same reward twice",
        "refuses a prize somebody already took",
        "turns a missing reason into a bad request",
        "revokes one reward and refuses a claimed one",
    ],
    "`RewardRevoked` lands on": ["records it on the reward's own stream"],
    "`recallRewards(tournamentId, at, reason)` takes a whole payout back": [
        "recalls every reward the tournament still holds",
        "recalls a whole payout",
        "needs a reason of its own",
    ],
    "A claimed prize anywhere in that tournament": [
        "takes nothing back when one prize has been claimed",
        "refuses a recall over a claimed prize",
    ],
    "Nothing left to take is an empty answer.": ["has nothing to do twice over"],
    "Distribution keeps refusing while any reward stands": [
        "refuses while the payout still stands",
        "still refuses when only part of the payout came back",
    ],
    "After a recall it runs again as a fresh round": [
        "mints a second round once the payout is recalled",
        "leaves the round it replaced where it was",
        "counts on to a third round",
        "pays the same tiers the config always paid",
        "recalls, pays again, and reads both rounds back",
    ],
    "Claims honour `claimWindowMs`": [
        "lets a prize be taken inside the window",
        "never closes when the config sets no window",
        "refuses a prize that came back",
        "refuses a reward nobody granted",
        "takes a prize on request",
        "has nothing to hand a reward nobody granted",
    ],
    "The deadline still counts": [
        "counts the deadline itself as inside",
        "refuses one millisecond later",
        "turns a closed window into a conflict",
    ],
    "`expireClaims(tournamentId,": [
        "revokes everything past its deadline",
        "leaves a prize somebody took",
        "does nothing before the deadline",
        "does nothing at all without a window",
        "closes out what nobody came for",
    ],
    "`payoutStatement(tournamentId)` answers `rounds` oldest first": [
        "states one round with what it handed out",
        "states nothing at all before a tournament pays",
        "shows a recalled round standing at nothing",
        "keeps both rounds, oldest first",
        "splits what was paid from what is owed",
        "states the payout round by round",
    ],
    "`rewardBalance(playerId)` answers": [
        "counts a granted prize as waiting",
        "counts a taken prize as paid",
        "counts a recalled prize as neither",
        "refuses a player nobody created",
        "answers a player's balance",
    ],
    "Reach it through `POST /rewards/:id/claim`": [
        "takes a prize on request",
        "recalls a whole payout",
        "closes out what nobody came for",
        "states the payout round by round",
        "answers a player's balance",
        "recalls, pays again, and reads both rounds back",
        "offers the commands the desk needs",
        "prints them in its help",
        "insists on a reason when a payout is recalled",
        "insists on a player when a balance is read",
    ],
}


def sentences(text: str):
    body = " ".join(line.strip() for line in text.strip().splitlines())
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", body) if s.strip()]


def case_names():
    names = []
    for node in CONFIG["f2p_node_ids"] + CONFIG["p2p_node_ids"]:
        head, sep, rest = node.partition(".test.ts.")
        if not sep or ("prize-desk" not in head and "payout-surfaces" not in head):
            continue
        names.append(rest.split(" > ", 1)[-1])
    return names


def main() -> int:
    text = INSTRUCTION.read_text()
    all_sentences = sentences(text)
    graded = case_names()
    problems = []

    covered_cases = set()
    for sentence in all_sentences:
        if sentence in SCENE:
            continue
        hits = [frag for frag in MAP if frag in sentence]
        if not hits:
            problems.append(f"sentence enforced by nothing: {sentence[:80]}")
            continue
        for frag in hits:
            for case in MAP[frag]:
                if case not in graded:
                    problems.append(f"mapped case is not graded: {case}")
                covered_cases.add(case)

    for case in graded:
        if case not in covered_cases:
            problems.append(f"graded case traces to no sentence: {case}")

    # Reading side. Whatever the suite ASSERTS has to exist in the base
    # checkout or be named by the request. Fixture inputs and case titles are
    # not contracts, so only what sits inside an expect(...) is checked.
    base_text = "\n".join(
        path.read_text(errors="ignore")
        for path in list((BASE / "src").rglob("*.ts"))
        + list((BASE / "tests").rglob("*.ts"))
        + list((BASE / "docs").rglob("*.md"))
    )
    matchers = {
        "toBe", "toEqual", "toHaveLength", "toContain", "toMatchObject", "toBeCloseTo",
        "toBeUndefined", "toBeDefined", "toBeGreaterThan", "rejects", "resolves", "not",
        "map", "filter", "find", "length", "slice", "push", "every", "some", "handle",
        "then", "catch", "body", "status", "test", "ts", "js",
    }
    ids = re.compile(r"(plr|tnm|mch|ssn|rwd|evt|snp)_[a-z0-9_]+")

    def normalise(value: str) -> str:
        return ids.sub(":id", value)

    for path in HELDOUT:
        body = path.read_text()
        asserted = re.findall(r"expect\((.*?)\)\s*\.([\s\S]*?);", body)
        blob = "\n".join(a + " " + b for a, b in asserted)
        for ident in sorted(set(re.findall(r"\.([a-zA-Z_][a-zA-Z0-9_]*)\b", blob))):
            if ident in matchers or ident in base_text or ident in text:
                continue
            problems.append(f"{path.name}: asserts on `.{ident}`, named neither in the base tree nor the request")
        for literal in sorted(set(re.findall(r'"([^"\n]{2,})"', blob) + re.findall(r"'([^'\n]{2,})'", blob))):
            probe = normalise(literal)
            if probe in base_text or probe in text or literal in base_text or literal in text:
                continue
            # A value the case itself handed in and then reads back is a round
            # trip, not a contract the request failed to state.
            if body.count(f'"{literal}"') + body.count(f"'{literal}'") > blob.count(literal):
                continue
            problems.append(f"{path.name}: pins the string {literal!r}, named neither in the base tree nor the request")

    print(f"{len(all_sentences)} sentences, {len(SCENE)} of them scene setting")
    print(f"{len(graded)} graded cases from the held-back files, {len(covered_cases)} mapped")
    if problems:
        for p in problems:
            print("  PROBLEM:", p)
        return 1
    print("bidirectional audit clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
