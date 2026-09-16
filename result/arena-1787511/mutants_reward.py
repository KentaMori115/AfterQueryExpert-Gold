#!/usr/bin/env python3
"""Break the reference one rule at a time and check the held-back cases notice."""
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE / "repo"
HELDOUT = HERE / "heldout"
FILES = {
    "prize-desk.test.ts": "tests/engine/prize-desk.test.ts",
    "payout-surfaces.test.ts": "tests/engine/payout-surfaces.test.ts",
}

RECALL = "src/engine/rewards/recall.ts"
STATEMENT = "src/engine/rewards/statement.ts"
CLAIMS = "src/engine/rewards/claims.ts"
ENGINE = "src/engine/rewards/reward-engine.ts"
SERVICE = "src/engine/tournament/tournament-service.ts"
ROUTES = "src/api/routes/rewards.ts"
SDK = "src/sdk/rewards.ts"
CLI = "src/cli/commands/index.ts"
CLI_REWARD = "src/cli/commands/reward.ts"
CLI_HELP = "src/cli/index.ts"

# Two mutants dropped rather than fixed, both equivalent by construction:
# listing claimed rewards as recallable changes nothing, because
# assertRecallable refuses before that list is read; and dating a round from
# its latest grant rather than its earliest changes nothing, because a round is
# granted by one call at one timestamp.
MUTANTS = [
    ("a second round overwrites the first", RECALL,
     'return round === FIRST_ROUND ? "" : `_r${round}`;',
     'return "";'),
    ("the round never advances", RECALL,
     "return mine.reduce((highest, reward) => Math.max(highest, roundOf(reward.id)), FIRST_ROUND) + 1;",
     "return FIRST_ROUND;"),
    ("a round suffix is misread", RECALL,
     "const ROUND_SUFFIX = /_r([0-9]+)$/;",
     "const ROUND_SUFFIX = /_round([0-9]+)$/;"),
    ("a claimed prize does not block a recall", RECALL,
     "  if (plan.claimed.length > 0) {",
     "  if (false) {"),
    ("a recall runs without a reason", RECALL,
     '  if (!trimmed) {\n    throw new InvalidArgumentError("a recall needs a reason", { reason });\n  }',
     "  if (false) {\n    throw new InvalidArgumentError(\"a recall needs a reason\", { reason });\n  }"),
    ("a recall answers in the wrong order", RECALL,
     "    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));\n  const revoking",
     "    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));\n  const revoking"),
    ("nothing expires", RECALL,
     "        at > reward.grantedAt + claimWindowMs,",
     "        at > reward.grantedAt + claimWindowMs * 1000,"),
    ("a missing window expires everything", RECALL,
     "  if (claimWindowMs === undefined) {\n    return [];\n  }",
     "  if (claimWindowMs === undefined) {\n    claimWindowMs = 0;\n  }"),
    ("a claimed reward can still be revoked", ENGINE,
     '    if (current.status === "claimed") {',
     "    if (false) {"),
    ("revoking twice is allowed", ENGINE,
     '    if (current.status === "revoked") {\n      throw new ConflictError("reward is already revoked", { rewardId });\n    }',
     '    if (false) {\n      throw new ConflictError("reward is already revoked", { rewardId });\n    }'),
    ("the claim window is ignored", ENGINE,
     "    assertClaimWindow(current, at, claimWindowMs);",
     "    void claimWindowMs;"),
    ("the deadline itself is too late", CLAIMS,
     "  return at <= reward.grantedAt + claimWindowMs;",
     "  return at < reward.grantedAt + claimWindowMs;"),
    ("a revoked prize still counts as waiting", CLAIMS,
     '    .filter((reward) => reward.playerId === playerId && reward.status === "granted")',
     '    .filter((reward) => reward.playerId === playerId && reward.status !== "claimed")'),
    ("a claimed prize is counted twice", CLAIMS,
     '    .filter((reward) => reward.playerId === playerId && reward.status === "claimed")',
     '    .filter((reward) => reward.playerId === playerId && reward.status !== "granted")'),
    ("the service never passes the window on", SERVICE,
     "      tournament.rewards.claimWindowMs,",
     "      undefined,"),
    ("the service ignores the round", SERVICE,
     "      nextRound(tournamentId, ledger),",
     "      1,"),
    ("a recall revokes without checking first", SERVICE,
     "    const plan = assertRecallable(planRecall(tournamentId, this.store.listRewards(), at));",
     "    const plan = planRecall(tournamentId, this.store.listRewards(), at);"),
    ("the revocation is never recorded", SERVICE,
     '      type: "RewardRevoked",',
     '      type: "AntiCheatFlagged" as "RewardRevoked",'),
    ("a statement counts a recalled round as standing", STATEMENT,
     '      const alive = records.filter((reward) => reward.status !== "revoked");',
     "      const alive = records;"),
    ("a statement puts the newest round first", STATEMENT,
     "    .sort((a, b) => a[0] - b[0])",
     "    .sort((a, b) => b[0] - a[0])"),
    ("a statement dates a round from nothing at all", STATEMENT,
     "        grantedAt: records.reduce(",
     "        grantedAt: 0 * records.reduce("),
    ("a statement confuses paid with owed", STATEMENT,
     '  const outstanding = sum(mine.filter((reward) => reward.status === "granted"));\n  const paid = sum(mine.filter((reward) => reward.status === "claimed"));',
     '  const outstanding = sum(mine.filter((reward) => reward.status === "claimed"));\n  const paid = sum(mine.filter((reward) => reward.status === "granted"));'),
    ("the claim route is missing", ROUTES,
     'router.add("POST", "/rewards/:id/claim"',
     'router.add("POST", "/rewards/:id/claim-disabled"'),
    ("the revoke route is missing", ROUTES,
     'router.add("POST", "/rewards/:id/revoke"',
     'router.add("POST", "/rewards/:id/revoke-disabled"'),
    ("the recall route is missing", ROUTES,
     'router.add("POST", "/rewards/recall"',
     'router.add("POST", "/rewards/recall-disabled"'),
    ("the expire route is missing", ROUTES,
     'router.add("POST", "/rewards/expire"',
     'router.add("POST", "/rewards/expire-disabled"'),
    ("the statement route is missing", ROUTES,
     'router.add("GET", "/rewards/statement/:tournamentId"',
     'router.add("GET", "/rewards/statement-disabled/:tournamentId"'),
    ("the balance route is missing", ROUTES,
     'router.add("GET", "/rewards/:playerId/balance"',
     'router.add("GET", "/rewards/:playerId/balance-disabled"'),
    ("the sdk cannot recall", SDK,
     "  recall(tournamentId: string, at: number, reason: string)",
     "  recallDisabled(tournamentId: string, at: number, reason: string)"),
    ("the sdk cannot read a statement", SDK,
     "  statement(tournamentId: string)",
     "  statementDisabled(tournamentId: string)"),
    ("the cli forgets a command", CLI,
     '    "rewards:recall",\n',
     ""),
    ("the cli reward list forgets them", CLI_REWARD,
     '  "rewards:balance",',
     ""),
    ("the cli help forgets them", CLI_HELP,
     "  rewards:recall\n",
     ""),
    ("the cli recall takes no reason", CLI,
     '        requiredFlag(flags, "reason"),\n      );\n    case "rewards:expire":',
     '        flags.reason ?? "unspecified",\n      );\n    case "rewards:expire":'),
]


def run_cases():
    proc = subprocess.run(
        ["npx", "vitest", "run", *FILES.values(), "--reporter=dot"],
        cwd=REPO, capture_output=True, text=True,
    )
    return proc.returncode


def main() -> int:
    for name, path in FILES.items():
        target = REPO / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(HELDOUT / name, target)
    if run_cases() != 0:
        print("the reference does not pass its own cases; stopping")
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
        caught = run_cases() != 0
        target.write_text(original)
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
