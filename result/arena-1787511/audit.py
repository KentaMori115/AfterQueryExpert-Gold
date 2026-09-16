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
TASK = HERE / "tasks" / "match-void-rescore"
INSTRUCTION = TASK / "instruction.md"
CONFIG = json.loads((TASK / "tests" / "config.json").read_text())
HELDOUT = sorted((HERE / "heldout").glob("*.test.ts"))
BASE = HERE / "base-tree"

# Sentences that set the scene rather than state a rule. They carry no case
# by design and are listed here so the count below stays honest.
SCENE = {
    "ArenaFlow can void a match down in `domain/matches/match.ts`, and nothing above that layer ever calls it, so a result that should never have counted sits on the board forever.",
    "Leave existing tests as they are.",
    "IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.",
}

# sentence fragment -> the graded case names it is enforced by
MAP = {
    "Give `TournamentService` a `voidMatch": ["takes the match out of play and keeps what it recorded"],
    "Blank reason is an": [
        "needs a reason",
        "refuses once the tournament is over",
        "refuses the same match twice",
        "refuses a match nobody created",
        "turns a missing reason into a bad request",
        "turns a repeated withdrawal into a conflict",
        "turns a withdrawal after the end into a conflict",
    ],
    "The match takes voided status": [
        "takes the match out of play and keeps what it recorded",
        "refuses a further result on a match that left play",
        "answers with the match once it has left play",
    ],
    "Standings for that tournament are then decided": [
        "pays back the points the withdrawn win carried",
        "rebuilds the other side of the match as well",
        "keeps counting the results that came after the withdrawn one",
        "folds results that finished together in match id order",
        "leaves a player the withdrawal never reached exactly where they were",
        "changes no standing when the match never scored",
        "pays the tournament out on the rebuilt standings",
        "withdraws a result and reads the ledger back",
    ],
    "Nothing is subtracted.": ["pays back the points the withdrawn win carried"],
    "A bonus a later win only reached": [
        "stops paying a bonus the surviving wins no longer reach",
        "decides a vip award again at the same multiplier",
        "leaves one reason on the record for each surviving result",
        "dates the record from the last result that still counts",
    ],
    "A player left with nothing starts over": [
        "hands back an empty record dated at the void when nothing survives",
    ],
    "`MatchVoided` carries": [
        "records the withdrawal on the match's own stream",
        "replays the journal onto the same standings",
    ],
    "`voidHistory(tournamentId)` and `voidsForPlayer": [
        "keeps one entry for each withdrawal, oldest first",
        "answers for one player across the withdrawals that touched them",
        "holds nothing before a result is withdrawn",
    ],
    "Each entry holds `matchId`": [
        "keeps one entry for each withdrawal, oldest first",
        "lists only the players whose total moved, with the points either side",
        "keeps an entry for a withdrawal that moved no total",
        "lists what a tournament has withdrawn",
    ],
    "`buildTournamentReport` takes those entries last": ["prints what a tournament withdrew"],
    "`publishLeaderboard(tournamentId, at)` freezes a board.": [
        "measures movement against the board an operator stood behind",
        "publishes the board an operator stands behind",
    ],
    "Rankings handed out afterwards": [
        "measures movement against the board an operator stood behind",
        "moves the baseline on every publication",
        "moves a single player's ranking against the published board too",
        "leaves every rank new until a board is published",
    ],
    "`publishedLeaderboard` finds nothing until then": [
        "hands back the last published board",
        "has nothing to hand back before the first publication",
        "keeps every publication, oldest first",
        "has nothing published until something is",
    ],
    "Reach it through `POST /matches/:id/void`": [
        "answers with the match once it has left play",
        "publishes the board an operator stands behind",
        "has nothing published until something is",
        "lists what a tournament has withdrawn",
        "withdraws a result and reads the ledger back",
        "offers the commands the desk needs",
        "prints the new commands in its help",
        "insists on a reason when a result is withdrawn",
    ],
    "Catalog `match.voided`": ["registers its explanation codes in the catalog"],
}


def sentences(text: str):
    body = " ".join(line.strip() for line in text.strip().splitlines())
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", body) if s.strip()]


def case_names():
    names = []
    for node in CONFIG["f2p_node_ids"] + CONFIG["p2p_node_ids"]:
        head, sep, rest = node.partition(".test.ts.")
        if not sep or "ladder-disputes" not in head and "operator-desk" not in head:
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
