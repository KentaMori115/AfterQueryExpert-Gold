#!/usr/bin/env python3
"""Break the reference one rule at a time and check the held-back cases notice.

Each mutant edits repo/ in place, runs the two held-back files, then puts the
file back. A mutant that leaves every case green is a rule nothing grades.
"""
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE / "repo"
HELDOUT = HERE / "heldout"
FILES = {
    "ladder-disputes.test.ts": "tests/engine/ladder-disputes.test.ts",
    "operator-desk.test.ts": "tests/engine/operator-desk.test.ts",
}

SERVICE = "src/engine/tournament/tournament-service.ts"
REBUILD = "src/engine/scoring/rebuild.ts"
VOIDS = "src/engine/audit/voids.ts"
PUBLISHED = "src/engine/ranking/published.ts"
PROJECTOR = "src/events/replay/projector.ts"
CODES = "src/engine/catalog/codes.ts"
MATCH_ROUTES = "src/api/routes/matches.ts"
RANK_ROUTES = "src/api/routes/rankings.ts"
TNM_ROUTES = "src/api/routes/tournaments.ts"
SDK_MATCHES = "src/sdk/matches.ts"
SDK_RANKINGS = "src/sdk/rankings.ts"
SDK_TNM = "src/sdk/tournaments.ts"
CLI = "src/cli/commands/index.ts"
CLI_MATCH = "src/cli/commands/match.ts"
CLI_HELP = "src/cli/index.ts"
REPORT = "src/engine/reporting/report.ts"

MUTANTS = [
    ("a withdrawal subtracts instead of deciding again", REBUILD,
     """  for (const result of results) {
    record = scoringEngine.decide({""",
     """  for (const result of results.slice(0, results.length)) {
    if (result.outcome === "win" && results.length > 3) {
      continue;
    }
    record = scoringEngine.decide({"""),
    ("a withdrawn match still counts", REBUILD,
     '.filter((match) => match.tournamentId === tournamentId && match.status === "completed")',
     '.filter((match) => match.tournamentId === tournamentId && match.status !== "pending")'),
    ("surviving results fold newest first", REBUILD,
     '.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));',
     '.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));'),
    ("a tie on completion time falls back to store order", REBUILD,
     '(a.completedAt ?? 0) - (b.completedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)',
     '(a.completedAt ?? 0) - (b.completedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)'),
    ("an emptied record keeps its old date", REBUILD,
     "let record = emptyScore(player.id, tournament.id, first ? first.at : fallbackAt);",
     "let record = emptyScore(player.id, tournament.id, first ? first.at : 1);"),
    ("the rebuild only touches one player", REBUILD,
     "  const scores = input.scores\n    .filter((score) => score.tournamentId === input.tournament.id)",
     "  const scores = input.scores\n    .filter((score) => score.tournamentId === input.tournament.id)\n    .slice(0, 1)"),
    ("a blank reason is accepted", SERVICE,
     '    if (!reason) {\n      throw new InvalidArgumentError("a void needs a reason", { matchId: input.matchId });\n    }',
     '    if (false) {\n      throw new InvalidArgumentError("a void needs a reason", { matchId: input.matchId });\n    }'),
    ("a finished tournament still takes a withdrawal", SERVICE,
     '    if (tournament.status !== "active") {\n      throw new IllegalStateError("matches can only be voided while their tournament is active", {',
     '    if (tournament.status === "draft") {\n      throw new IllegalStateError("matches can only be voided while their tournament is active", {'),
    ("a match is withdrawn twice", SERVICE,
     '    if (match.status === "voided") {\n      throw new ConflictError("match is already voided", { matchId: match.id });\n    }',
     '    if (false) {\n      throw new ConflictError("match is already voided", { matchId: match.id });\n    }'),
    ("the event travels without the rebuilt records", SERVICE,
     "        scores: this.store.listScores(tournament.id),",
     "        scores: [],"),
    ("the projector ignores the rebuilt records", PROJECTOR,
     "      for (const score of event.payload.scores) {\n        maps.scores.set(scoreKey(score.tournamentId, score.playerId), score);\n      }",
     "      for (const score of event.payload.scores.slice(0, 0)) {\n        maps.scores.set(scoreKey(score.tournamentId, score.playerId), score);\n      }"),
    ("the ledger keeps newest first", SERVICE,
     "  voidHistory(tournamentId: TournamentId): VoidEntry[] {\n    this.requireTournament(tournamentId);\n    return this.voids.forTournament(tournamentId);",
     "  voidHistory(tournamentId: TournamentId): VoidEntry[] {\n    this.requireTournament(tournamentId);\n    return this.voids.forTournament(tournamentId).reverse();"),
    ("the ledger lists players who never moved", VOIDS,
     "    if (was !== undefined && wasTotal === score.total) {\n      continue;\n    }",
     "    if (false) {\n      continue;\n    }"),
    ("a change reports the wrong side of the withdrawal", VOIDS,
     "        before: wasTotal,\n        after: score.total,\n        delta: score.total - wasTotal,",
     "        before: score.total,\n        after: wasTotal,\n        delta: wasTotal - score.total,"),
    ("the ledger loses the status the match had", VOIDS,
     "      previousStatus: input.previousStatus,",
     '      previousStatus: "voided" as typeof input.previousStatus,'),
    ("the ledger answers every player for every withdrawal", VOIDS,
     "    return this.entries.filter((entry) =>\n      entry.changes.some((change) => change.playerId === playerId),\n    );",
     "    return this.entries.filter(() => true);"),
    ("movement ignores the published board", SERVICE,
     "      this.published.baseline(tournamentId),",
     "      undefined,"),
    ("publishing does not move the baseline", PUBLISHED,
     "    this.boards.set(tournamentId, published);\n    this.log.push(published);",
     "    if (!this.boards.has(tournamentId)) {\n      this.boards.set(tournamentId, published);\n    }\n    this.log.push(published);"),
    ("nothing published answers with an empty board", SERVICE,
     '    if (!published) {\n      throw new NotFoundError("published leaderboard", tournamentId);\n    }',
     "    if (!published) {\n      return this.published.publish(tournamentId, [], 1);\n    }"),
    ("publication history keeps only the last board", PUBLISHED,
     "    return this.log.filter((entry) => entry.tournamentId === tournamentId);",
     "    return this.log.filter((entry) => entry.tournamentId === tournamentId).slice(-1);"),
    ("the withdrawal route is missing", MATCH_ROUTES,
     'router.add("POST", "/matches/:id/void"',
     'router.add("POST", "/matches/:id/void-disabled"'),
    ("the publish route is missing", RANK_ROUTES,
     'router.add("POST", "/leaderboards/:id/publish"',
     'router.add("POST", "/leaderboards/:id/publish-disabled"'),
    ("the published board route is missing", RANK_ROUTES,
     'router.add("GET", "/leaderboards/:id/published"',
     'router.add("GET", "/leaderboards/:id/published-disabled"'),
    ("the ledger route is missing", TNM_ROUTES,
     'router.add("GET", "/tournaments/:id/voids"',
     'router.add("GET", "/tournaments/:id/voids-disabled"'),
    ("the sdk cannot withdraw", SDK_MATCHES,
     "  voidMatch(id: string, at: number, reason: string)",
     "  voidMatchDisabled(id: string, at: number, reason: string)"),
    ("the sdk cannot publish", SDK_RANKINGS,
     "  publish(tournamentId: string, at: number)",
     "  publishDisabled(tournamentId: string, at: number)"),
    ("the sdk cannot read the ledger", SDK_TNM,
     "  voids(id: string)",
     "  voidsDisabled(id: string)"),
    ("the cli forgets the withdrawal command", CLI,
     '    "match:void",\n',
     ""),
    ("the cli match list forgets it too", CLI_MATCH,
     '"match:result", "match:void"',
     '"match:result"'),
    ("the cli help forgets the new commands", CLI_HELP,
     "  match:void\n",
     ""),
    ("the cli void takes no reason", CLI,
     '        reason: requiredFlag(flags, "reason"),',
     '        reason: flags.reason ?? "unspecified",'),
    ("the codes are never catalogued", CODES,
     '  MATCH_VOIDED: "match.voided",',
     '  MATCH_VOIDED: "match.voided.disabled",'),
    ("the report drops the withdrawals", REPORT,
     "    voids: buildVoids(voids),",
     "    voids: buildVoids([]),"),
]


def run_cases():
    proc = subprocess.run(
        ["npx", "vitest", "run", *FILES.values(), "--reporter=dot"],
        cwd=REPO, capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    for name, path in FILES.items():
        target = REPO / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(HELDOUT / name, target)
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
            print("SKIP  %-52s (anchor not found in %s)" % (label, rel))
            survivors.append(label)
            continue
        target.write_text(original.replace(before, after, 1))
        code, _ = run_cases()
        target.write_text(original)
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
