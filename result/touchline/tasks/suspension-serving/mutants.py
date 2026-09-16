#!/usr/bin/env python3
"""Semantic mutants of the reference. Each must fail at least one held-out case."""
import pathlib, shutil, subprocess, sys, tempfile, json
T = pathlib.Path(__file__).resolve().parent
WORK = T / "work"
NM = "/root/mindriftwork/AQ_dragan/result/touchline/repo/node_modules"
TYPES = "src/modules/suspensions/suspension.types.ts"
SERVICE = "src/modules/suspensions/suspension.service.ts"
DISC = "src/modules/discipline/discipline.service.ts"

MUTANTS = {
 "awarded-serves": (TYPES, "  return fixture.status === 'played';", "  return fixture.status === 'played' || fixture.status === 'awarded';"),
 "postponed-serves": (TYPES, "  return fixture.status === 'played';", "  return fixture.status !== 'awarded';"),
 "own-game-counts": (TYPES, "  if (entry.outstanding === 0 || entry.shownOn >= day) return false;", "  if (entry.outstanding === 0 || entry.shownOn > day) return false;"),
 "sum-not-max": (TYPES, "  return Math.max(card.straightBan, card.accumulationBan);", "  return card.straightBan + card.accumulationBan;"),
 "fine-only-cards-listed": (TYPES, "  return matchesFor(card) > 0;", "  return true;"),
 "newest-card-first": (TYPES, "    const serving = servings.find((candidate) => canServe(candidate, teamId, game));", "    const serving = [...servings].reverse().find((candidate) => canServe(candidate, teamId, game));"),
 "cleared-on-any-game": (TYPES, "    if (entry.outstanding === 0) entry.clearedOn = game.playedOn;", "    entry.clearedOn = game.playedOn;"),
 "playerid-order-only": (TYPES, "  if (leftHome !== rightHome) return leftHome - rightHome;", ""),
 "no-wait": (TYPES, "export const ACCUMULATION_WAIT_DAYS = 14;", "export const ACCUMULATION_WAIT_DAYS = 0;"),
 "wait-off-by-one": (TYPES, "  return serving.accumulated - entry.served > 0 && day >= serving.accumulatedFrom;", "  return serving.accumulated - entry.served > 0 && day > serving.accumulatedFrom;"),
 "wait-applies-to-whole-card": (TYPES, "  if (serving.straight - entry.served > 0) return true;", "  if (serving.straight - entry.served > 0 && serving.accumulated === 0) return true;"),
 "parts-served-separately": (TYPES, "  return serving.accumulated - entry.served > 0 && day >= serving.accumulatedFrom;", "  return serving.accumulated - Math.max(0, entry.served - serving.straight) > 0 && day >= serving.accumulatedFrom;"),
 "earliest-outstanding-not-servable": (TYPES, "    const serving = servings.find((candidate) => canServe(candidate, teamId, game));", "    const serving = servings.find((candidate) => candidate.entry.teamId === teamId && candidate.entry.outstanding > 0 && candidate.entry.shownOn < game.playedOn);\n    if (serving !== undefined && !canServe(serving, teamId, game)) continue;"),
 "eligibility-by-outstanding": (SERVICE, "    if (!servings.some((serving) => dueOn(serving, fixture.playedOn))) return 0;", "    void fixture;"),
 "eligibility-needs-serving-side": (SERVICE, "    if (!servings.some((serving) => dueOn(serving, fixture.playedOn))) return 0;", "    if (!servings.some((serving) => dueOn(serving, fixture.playedOn) && (serving.entry.teamId === fixture.homeTeamId || serving.entry.teamId === fixture.awayTeamId))) return 0;"),
 "asof-ignores-games": (SERVICE, "this.fixtures.list({ teamId }).filter((game) => !isAfter(game.playedOn, day));", "this.fixtures.list({ teamId });"),
 "asof-ignores-cards": (SERVICE, "this.cards.forPlayerUpTo(playerId, day)", "this.cards.forPlayer(playerId)"),
 "eligibility-day-of-game": (SERVICE, "    const asOf = addDays(fixture.playedOn, -1);", "    const asOf = fixture.playedOn;"),
 "released-listed": (SERVICE, "this.players.list({ clubId: side.clubId, status: 'registered' })", "this.players.list({ clubId: side.clubId })"),
 "standing-unchanged": (DISC, "standing: outstanding > 0 ? 'suspended'", "standing: matchesBanned > 0 ? 'suspended'"),
 "entries-newest-first": (SERVICE, "    const totals = totalsOf(entries);", "    entries.reverse();\n    const totals = totalsOf(entries);"),
 "club-sides-serve": [
   (SERVICE, "    for (const teamId of sidesOf(servings)) {", "    for (const teamId of this.teams.list({ clubId: this.players.get(playerId).clubId }).map((team) => team.id)) {"),
   (TYPES, "  return serving.entry.teamId === teamId && dueOn(serving, fixture.playedOn);", "  void teamId;\n  return dueOn(serving, fixture.playedOn);"),
 ],
 "eligibility-by-card-club": (SERVICE, "      for (const player of this.players.list({ clubId: side.clubId, status: 'registered' })) {", "      for (const player of this.players.list({ status: 'registered' })) {"),
}

def main():
    only = sys.argv[1:]
    results = {}
    for name in MUTANTS:
        if only and name not in only: continue
        with tempfile.TemporaryDirectory() as tmp:
            tree = pathlib.Path(tmp) / "t"; tree.mkdir()
            tar = subprocess.run(["git", "-C", str(WORK), "archive", "solution"], check=True, capture_output=True).stdout
            subprocess.run(["tar", "-xf", "-", "-C", str(tree)], input=tar, check=True)
            for f in ["ban-serving.test.ts", "matchday-eligibility.test.ts"]:
                shutil.copy(T / "authoring" / f, tree / "tests" / f)
            (tree / "node_modules").symlink_to(NM)
            edits = MUTANTS[name] if isinstance(MUTANTS[name], list) else [MUTANTS[name]]
            for rel_, old_, new_ in edits:
                p = tree / rel_; s = p.read_text()
                assert s.count(old_) == 1, (name, rel_, s.count(old_)); p.write_text(s.replace(old_, new_))
            out = tree / "r.json"
            subprocess.run(["npx", "jest", "--ci", "--json", f"--outputFile={out}", "tests/ban-serving.test.ts", "tests/matchday-eligibility.test.ts"],
                           cwd=tree, capture_output=True, text=True)
            d = json.loads(out.read_text()) if out.exists() else {"testResults": []}
            failed = [t["fullName"] for s_ in d["testResults"] for t in s_["assertionResults"] if t["status"] != "passed"]
            crashed = [s_["name"] for s_ in d["testResults"] if s_.get("status") == "failed" and not s_["assertionResults"]]
            results[name] = failed
            flag = "OK  " if failed or crashed else "SURVIVED"
            print(f"{flag} {name:26s} {len(failed):3d} cases fail" + (f" (+{len(crashed)} suites crashed)" if crashed else ""))
            if failed and len(failed) <= 3:
                for f in failed: print("      ", f)
    json.dump(results, open(T / "authoring" / "mutants.json", "w"), indent=1)

main()
