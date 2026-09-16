#!/usr/bin/env python3
"""Break the reference one rule at a time and check the held-back cases notice.

Each mutant edits repo/ in place, runs the two held-back files, then puts the
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
    "withdrawn-results.test.ts": "tests/engine/withdrawn-results.test.ts",
    "withdrawn-replay.test.ts": "tests/events/withdrawn-replay.test.ts",
}

RESCORE = "src/engine/corrections/rescore.ts"
VOID = "src/engine/corrections/void-match.ts"
PROJECTOR = "src/events/replay/projector.ts"
SERVICE = "src/engine/tournament/tournament-service.ts"
REPORT = "src/engine/reporting/report.ts"
CLI = "src/cli/commands/index.ts"
ROUTES = "src/api/routes/matches.ts"

MUTANTS = [
    ("matches settled together are left unordered", RESCORE,
     "  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;",
     "  return 0;"),
    ("the rebuild walks newest first", RESCORE,
     "    .sort(compareSettled);",
     "    .sort((left, right) => compareSettled(right, left));"),
    ("a withdrawn match still feeds the rebuild", RESCORE,
     '&& match.status === "completed")',
     '&& match.status !== "pending")'),
    ("every result is scored from an empty record", RESCORE,
     "      current: score,",
     "      current: undefined,"),
    ("rebuilt results are stamped at the withdrawal", RESCORE,
     "      at: match.completedAt ?? at,",
     "      at,"),
    ("an emptied record keeps the epoch", RESCORE,
     "  let score = emptyScore(player.id, tournament.id, at);",
     "  let score = emptyScore(player.id, tournament.id, 0);"),
    ("the rebuild ignores the tournament's config", RESCORE,
     "      player,\n      tournament,",
     "      player,\n      tournament: { ...tournament, scoring: DEFAULT_SCORING_MUTANT },"),
    ("rebuilt records come back in result order", RESCORE,
     "  for (const playerId of [...new Set(input.playerIds)].sort()) {",
     "  for (const playerId of [...new Set(input.playerIds)]) {"),
    ("a tournament past active still withdraws", VOID,
     '  if (tournament.status !== "active") {',
     "  if (false) {"),
    ("a match that never completed still withdraws", VOID,
     '  if (match.status !== "completed") {',
     "  if (false) {"),
    ("a blank reason is accepted", VOID,
     "  if (trimmed.length === 0) {",
     "  if (false) {"),
    ("the reason is stored untrimmed", VOID,
     "  const trimmed = reason.trim();",
     "  const trimmed = reason;"),
    ("nobody is rebuilt", VOID,
     "  const playerIds = affectedPlayerIds(input.match);",
     "  const playerIds: string[] = [];"),
    ("a replay marks the match and stops there", PROJECTOR,
     "      const tournament = maps.tournaments.get(current.tournamentId);",
     "      const tournament = undefined;"),
    ("a replay forgets what each player did in a match", PROJECTOR,
     "      const pending = maps.matches.get(event.payload.matchId);",
     "      const pending = undefined;"),
    ("the event carries no reason", SERVICE,
     "        reason: outcome.reason,",
     '        reason: "",'),
    ("the report counts matches that still stand", REPORT,
     '    (match) => match.tournamentId === tournament.id && match.status === "voided",',
     '    (match) => match.tournamentId === tournament.id && match.status === "completed",'),
    ("the command line does not offer it", CLI,
     '    "match:void",\n',
     ""),
    ("the route ignores the body", ROUTES,
     '        reason: String(body.reason ?? ""),',
     '        reason: "route default",'),
]

# Extra edits some mutants need. Player id order is settled twice, once where
# the touched players are collected and once where they are rebuilt, so only
# breaking both sites changes what comes back.
EXTRA = {
    "the rebuild ignores the tournament's config": [
        (RESCORE,
         'import { emptyScore } from "../../domain/scores/score.js";',
         'import { emptyScore } from "../../domain/scores/score.js";\n'
         'import { DEFAULT_SCORING as DEFAULT_SCORING_MUTANT } from "../../types.js";'),
    ],
    "rebuilt records come back in result order": [
        (VOID,
         "  return [...new Set(match.results.map((result) => result.playerId))].sort();",
         "  return [...new Set(match.results.map((result) => result.playerId))];"),
    ],
}


def run_cases():
    proc = subprocess.run(
        ["npx", "vitest", "run", *FILES.values(), "--reporter=dot"],
        cwd=REPO, capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main():
    for name, path in FILES.items():
        target = REPO / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(HELDOUT / name, target)
    code, output = run_cases()
    if code != 0:
        print("the reference does not pass its own cases; stopping")
        print(output[-3000:])
        return 1
    print("reference: all cases green")

    survivors = []
    for label, rel, before, after in MUTANTS:
        target = REPO / rel
        original = target.read_text()
        touched = [(target, original)]
        if before not in original:
            print("SKIP  %-46s (anchor not found in %s)" % (label, rel))
            survivors.append(label)
            continue
        target.write_text(original.replace(before, after, 1))
        for extra_rel, extra_before, extra_after in EXTRA.get(label, []):
            extra_target = REPO / extra_rel
            extra_original = extra_target.read_text()
            if extra_before not in extra_original:
                print("      (extra anchor not found in %s)" % extra_rel)
            if all(path != extra_target for path, _ in touched):
                touched.append((extra_target, extra_original))
            extra_target.write_text(extra_original.replace(extra_before, extra_after, 1))
        code, output = run_cases()
        for path, content in reversed(touched):
            path.write_text(content)
        caught = code != 0
        print("%-6s %s" % ("caught" if caught else "LIVES", label))
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
