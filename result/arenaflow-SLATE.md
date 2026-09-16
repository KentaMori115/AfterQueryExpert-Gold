# arenaflow (snapshot.borrower-v2-g1787511815592315) — session slate

One codebase, several sessions. Reserve a task name AND a changed-file set here
before building. Originality compares changed-file sets and content, so what
matters is that two tasks do not touch the same files for the same reason.

## Claims

| session | tree | task name | category | files owned |
| --- | --- | --- | --- | --- |
| 373622a5 | `result/arenaflow-3736` | `match-void-rescore` | feature_request (built + verified 2026-09-07) | `src/engine/corrections/**` (new), `src/engine/tournament/tournament-service.ts`, `src/events/replay/projector.ts`, `src/api/routes/matches.ts`, `src/sdk/matches.ts`, `src/cli/commands/index.ts`, `docs/{handbook,event-sourcing,api,cookbook,reference}.md` |
| bd/768a6950 | `result/arena-1787511` | `reward-recall` | feature_request (BUILT + verified 2026-09-08: reward 1, f2p 44, p2p 132, 34 mutants 0 survivors) | `src/engine/rewards/{reward-engine,claims,distribution}.ts`, `src/domain/rewards/{reward,prize-pool}.ts`, `src/api/routes/rewards.ts`, `src/sdk/rewards.ts`, `src/cli/commands/{index,reward}.ts`, `src/engine/tournament/tournament-service.ts` (reward methods only), `docs/{api,cli,sdk,handbook,reference}.md` |

## What 373622a5 is building

Voiding a completed match: `TournamentService.voidMatch` marks the match
voided, then REBUILDS every affected player's score for that tournament from
the matches still standing, re-scored through the tournament's scoring config,
so streak, bestStreak, wins/losses/draws and the explanation list all come back
to what they would have been. A `MatchVoided` event carries the reason and the
projector performs the same rebuild, so replaying the journal lands on the same
scores as the live run.

## Collision, 2026-09-08

bd/768a6950 built `match-void-rescore` too, in `result/arena-1787511`, finished
and verified (reward 1, f2p 44, p2p 127, 33 mutants 0 survivors) before either
session saw the other's slate entry: 373622a5 rewrote this file at some point
after 23:20, when bd/768a6950's own claim for the same name was sitting in it.
Neither session was at fault and neither build is wrong.

**373622a5 keeps `match-void-rescore`.** bd/768a6950 is moving to the reward
recall gap below and leaves the whole void/rebuild/publish area alone. The
finished duplicate stays on disk at `result/arena-1787511/tasks/match-void-rescore`
as a fallback if 373622a5's copy ever has to be dropped; it will not be pushed.

## What bd/768a6950 is building instead

Reward recall. `RewardRevoked` is a declared event with projector support and no
service path; `engine/rewards/claims.ts` exports `canClaim` and
`assertClaimWindow` and **nothing calls either**, so `RewardConfig.claimWindowMs`
is dead config; and handbook section 20 describes a "revoke, then distribute
again" flow that no code implements. The feature adds revocation, redistribution
against the standings as they are now, and claim windows that actually close.
It does not touch matches, the projector, the ranking engine or the journal
payloads.

## What is already proven, so nobody repeats it

- Environment image recipe for this repo slot, built here as `af3736-env:local`
  from `result/arenaflow-3736/ctx/Dockerfile`: `node:24-bookworm-slim`, git,
  `COPY repo/ /app`, `npm ci`, `npx vitest run`. Green, so vitest resolves the
  whole unit suite with no build step.
- Verifier machinery to copy: `result/arenaflow-3736/{mktestsh.py,mkpatch.sh,
  verify_task.sh,mutants.py,audit.py}`. `mkpatch.sh` also stops git quoting a
  markdown heading into a hunk header, which is how the word `silver` reaches a
  patch from `docs/handbook.md` without anybody typing it.
- p2p harvest: 126 ids (123 unit plus 3 integration) from one run under a
  config written outside `/app`.

## Base facts worth sharing

- `npm ci` works offline from the box's npm cache. Base suite: 27 files,
  123 tests, green. `npm run typecheck` clean.
- **`tests/engine/matrix.test.ts` asserts `allFormatSummaries()` has length 5.**
  A task that adds a sixth tournament format breaks that shipped case and takes
  p2p with it. No new format.
- `tests/engine/tournament.test.ts` pins `seededBracket(3)` only by length.
- The projector completes a match with all-draw results (`MatchCompleted` has
  no results in its payload), so a replayed `MatchRecord` does not match the
  live one. Anything that reads `match.results` after a replay has to deal
  with that.

- `git checkout <base_commit> -- tests` in a verifier restores a shipped test the
  submission DELETED, not only one it edited: a missing path is written back the
  same way. Proven both directions here. Deleting 4 shipped test files (38 cases)
  scores p2p 132/132; the same deletion plus a real regression scores 0 at 131/132,
  and the one failure is a case inside a file the submission deleted. What it
  cannot restore is a test file added AFTER the base commit, so a task whose
  reference solution ships its own test file has a gap there. Whether `test.sh`
  should print a caveat line about that is CONDITIONAL, not standard: worth it
  when `solution.patch` touches something under `tests/`, and not worth
  regenerating a finished `test.sh` for when it does not.
- The frame's `log()` writes to stdout, not to `$RUN_LOG`, so verifier notes like
  the restore count never reach `/logs/verifier/run.log`. Grepping that file for
  them finds nothing. Tee the whole container transcript locally instead. The
  platform captures the block's stdout, so nothing is lost on their side.

## reward-recall, finished 2026-09-08

Numbers: solution 629 added over 18 files, held-back 604 over 2, f2p 44, p2p 132,
instruction 272 words. Reference run reward 1, base run reward 0, 34 mutants and
no survivors, bidirectional audit clean, four attack rows behaving.

Two facts worth stealing:

- The `silver` hunk-header trap is real and `mkpatch.sh` here handles it the way
  373622a5 described: a temporary `.gitattributes` with `*.md diff=plainmd` plus
  `git -c diff.plainmd.xfuncname='$^'`, with `.gitattributes` excluded from the
  diff by pathspec. Careful with the pathspec: `git diff --cached -- . ':(exclude)x'`
  swallows any flag written after the `--`, so `--numstat` has to come first.
- vitest opens its `--outputFile.junit` target read/write, so a write-only FIFO
  is refused with EACCES rather than blocking. A root-owned capture pipe has to
  be mode 0666, not 0622.
