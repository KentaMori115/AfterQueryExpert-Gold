# arenaflow — reward-recall (session 768a6950, tree result/arena-1787511)

## Read this first: two tasks live in this tree

`reward-recall` is the deliverable. `match-void-rescore`, described further
down, was built first, finished and verified, and then turned out to duplicate
what session 373622a5 was building in `result/arenaflow-3736` at the same time.
Both sessions unpacked this snapshot within a minute of each other and neither
saw the other's slate entry in time. 373622a5 keeps that name and idea;
this tree moved to the reward gap instead. The old bundle is still on disk at
`tasks/match-void-rescore/` and must NOT be pushed.

## Snapshot

`snapshot.borrower-v2-g1787511815592315.zip`, 166 files, unpacks as **ArenaFlow**:
a single-package TypeScript competitive-gaming engine (tournaments, matchmaking,
scoring, rankings, rewards, anti-cheat, seasons, event sourcing, memory and
`node:sqlite` persistence, HTTP router, SDK, CLI). Node >= 24, vitest 3.2,
typescript 5.8, eslint, prettier. **Zero runtime dependencies**; `node:sqlite` is
a Node 24 builtin, so nothing native is compiled.

The zip name is a platform repo NAME and not a codebase: the same name has
already carried sagemark (Vue) and BiomeWeaver (npm workspaces). This one is
neither.

`npm ci` clean. Base green here and inside the image:

| suite | files | tests |
| --- | --- | --- |
| `npm test` (`tests/**` minus integration) | 27 | 123 |
| `npm run test:integration` | 2 | 3 |

`npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Step 0 — can this snapshot be graded? YES, proven

The platform API has answered 429 (Vercel Security Checkpoint) to every call
from this box since 2026-09-07 11:04, so `envs` / `env-log` are unreachable and
there is no repo id without a draft. Step 0 was closed the other way, by
rebuilding the generator's own recipe locally and running the base suite in it.

Recipe, from `result/sagemark-48bf/env-log.v1.txt`, the log of an earlier
snapshot under this same repository name, kept here as `ctx/Dockerfile`:

```
FROM node:24-bookworm-slim
RUN apt-get install ca-certificates git
COPY repo/ /app
RUN npm ci
RUN npx vitest run --reporter=dot
RUN git config --global --add safe.directory /app
```

Built as `arena-env:local`. `npm ci` succeeds, and step 5's bare
`npx vitest run` is green here (27 files, 123 tests) because ArenaFlow ships a
root `vitest.config.ts` that a bare run picks up. That was the open question on
BiomeWeaver, where a bare run collapses; it does not arise here. Every local
verification below ran against that image with `--network none`.

## Claim

**Task name:** `reward-recall`   **Category:** `feature_request`
Claimed in `result/arenaflow-SLATE.md`. Session 373622a5 has confirmed by
message that its own changed-file set touches nothing under
`src/engine/rewards/` or `src/domain/rewards/`, and that we overlap only in
`tournament-service.ts` (its `voidMatch` above `leaderboard(`, my reward
methods), `cli/commands/index.ts`, `cli/index.ts` and the docs, in different
regions. Its feature refuses once a tournament is `completed` and mine only
starts there, so the two never meet at runtime.

## The gap

Rewards can be granted and claimed and never taken back. `RewardRevoked` is a
declared event with projector support that nothing ever appends;
`engine/rewards/claims.ts` exports `canClaim` and `assertClaimWindow` and
**nothing calls either**, so `RewardConfig.claimWindowMs` is dead configuration;
and handbook section 20 describes a "revoke, then distribute again" flow that no
code implements, because `RewardEngine.qualify` refuses while any non-revoked
reward exists and nothing can revoke one.

## What the feature is

`revokeReward` takes one reward back and appends `RewardRevoked` on the reward's
own stream. `recallRewards` takes a whole payout back, and refuses without
touching anything when one of the tournament's prizes has been claimed.
`distributeRewards` then runs again as a numbered round: ids gain `_r2`, `_r3`,
so every earlier round keeps its own records instead of being overwritten.
Claims honour `claimWindowMs` counted from `grantedAt`, the deadline itself
still counts, and `expireClaims` sweeps up what nobody came for.
`payoutStatement` reads the rounds back out of the ledger and `rewardBalance`
splits one player's prizes into claimed and pending.

Difficulty sits where an implementation has to agree with something outside
itself:

1. reward ids are derived from tournament, player and tier, so a second payout
   silently overwrites the first unless the round is written into the id;
2. a partial revoke does not unlock redistribution, because the conflict is
   about any reward still standing rather than about all of them;
3. a claimed prize blocks a recall entirely, and the recall has to refuse
   before it revokes anything rather than stop halfway;
4. the claim deadline is inclusive, so the boundary millisecond decides it;
5. `standing` versus `granted` on a round, and `recalled` / `outstanding` /
   `paid` across a tournament, are four different splits of the same records.

## Numbers

| | |
| --- | --- |
| solution.patch | 629 added, 7 removed, 18 files |
| test.patch | 604 added, 2 files |
| held-out over churn | 604 / 636 = 0.950 |
| f2p | 44 |
| p2p | 132 (126 shipped, 6 held-back cases that already pass) |
| instruction | 272 words, 7.4 articles per 100, detector clean, correct trailer |
| solution lines per instruction word | 2.31 |

Account floors from `gold.me`: solution 459 lines / 4 files, held-out 596 lines /
2 files, instruction 100 to 300 words, f2p 8, p2p 50, 0.9 to 7.5 lines per word.
All met.

## Verified locally

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:integration`, `npm run build` all clean with the feature applied.
  Shipped suite green, 126 of 126, no regression. Prettier is not a gate: the
  base tree already fails `--check` on 54 files.
- `./verify_task_reward.sh` builds the verifier image from `arena-env:local` and
  runs the real `tests/test.sh` and `tests/grader.py` with `--network none`:
  **reward 1, f2p 44/44, p2p 132/132**.
- `./verify_task_reward.sh base`, no solution at all: **reward 0, f2p 0/44, p2p
  132/132**.
- `python3 mutants_reward.py`: **34 mutants, 0 survivors**. Two further mutants
  were dropped as equivalent by construction, and the file says why.
- `python3 audit_reward.py`: 18 sentences, 4 of them scene setting, 50 graded
  cases, mapped in both directions, and nothing the suite asserts on is absent
  from both the base checkout and the request.

## Attack runs

| attack | result |
| --- | --- |
| submitted `src/errors.ts` registers an exit hook that writes a forged junit to `/logs/verifier/new_junit.xml` and to the capture pipe | **reward 0** |
| submission deletes 3 of 4 cases from `tests/domain/rewards.test.ts` | **reward 1, p2p 132/132** (restored from the base commit) |
| same attack with the restore block removed | **reward 0, p2p 130/132** — the discriminator, so the restore is doing real work |
| differently shaped build: `recall.ts` and `statement.ts` reduced to type holders, every decision moved into the service under different names | **reward 1** — the cases grade behaviour, not internals |
| submission DELETES 4 shipped test files (`tests/domain/rewards.test.ts`, `tests/engine/rewards.test.ts`, `tests/engine/catalog.test.ts`, `tests/engine/matrix.test.ts`, 38 cases) | **reward 1, p2p 132/132** — `git checkout <base> -- tests` writes a path that is missing from the work tree just as happily as one that was edited, so all 38 come back and pass; reward 1 is the right answer for a build that is otherwise correct |
| same deletion plus a real regression (`presetNames()` returns the preset list reversed) | **reward 0, p2p 131/132**, and the single failure is `scoring presets and catalog > lists presets` — a case inside a file the submission deleted. Deleting a shipped test hides nothing |

The restore covers **shipped** files only: `git checkout <base> -- tests` can only
write paths that exist at the base commit, so a test file added after it is not
recoverable. That costs nothing here, because `solution.patch` touches no file
under `tests/` at all (18 files, none of them a test), and the two held-back
files arrive from `test.patch` after the restore runs. A task whose reference
solution ships its own test file would need to know this.

## The ciChecks codename, and how it reaches a patch

`silver` fails validation anywhere in the pushed bundle. The base repo is not
scanned, but it uses that word as a reward tier in `docs/handbook.md` section 20,
`docs/cookbook.md`, `src/examples/recipes.ts` and both shipped reward tests,
which is exactly where this task works. Two defences, both in place:

1. no held-back case, no doc edit and no source edit of mine uses the word, and
   the handbook section is appended after section 20 rather than editing it;
2. `mkpatch.sh` writes a temporary `.gitattributes` marking `*.md diff=plainmd`
   and diffs with `-c diff.plainmd.xfuncname='$^'`, because git otherwise quotes
   the nearest unindented line above a hunk into the `@@` header, and for an
   append at the end of `docs/handbook.md` that line is the worked example that
   carries the word. Confirmed: without the driver the patch carried one hit,
   with it the whole bundle greps clean.

## Verifier design

`tests/test.sh` is generated by `mktestsh.py` from the frozen `frame/test.sh`,
which asserts the bytes above and below the markers never moved. Inside the
block:

1. every shipped test file is restored from the base commit, skipping the two
   held-back paths, so a submission cannot be graded on its own copy of the
   pass-to-pass suite. Degrades to the on-disk files when git or the base commit
   is missing.
2. a canary case that cannot pass runs in the graded selection. A report where
   it is missing or green is rejected and every declared id is published as
   failed, with the reason.
3. both selections run under configurations written in `/tmp`, never read out of
   `/app`, so a committed config cannot decide what a case reports.
4. the runner is dropped to `nobody` with `setpriv` and both junit reports are
   streamed through root-owned FIFOs; the reader keeps the FIRST document that
   comes out and writes it into root-owned `/logs/verifier`. A later rewrite by
   submitted code reaches neither. The pipes are mode 0666 because the runner
   opens its report file read/write and refuses a write-only pipe.
5. every step degrades. No root, no `setpriv`, no `mkfifo`, no git: the run still
   happens against plain files rather than refusing.

## Left to do, all platform side

The API has been 429 since before this task started, so nothing has been pushed
and no draft exists. Once a draft is created on this repo:

1. `gold_bot.py call gold.tasks.get` for the repo id and base commit.
2. `envs` / `env-log` and the `Step` lines; compare against `ctx/Dockerfile`.
3. `gold_bot.py pull` the draft and replace `frame/test.sh`, `grader.py`,
   `pre_artifacts.sh` and both Dockerfiles with the platform's own copies, then
   regenerate `test.sh` with `mktestsh.py`.
4. Fill the markers: `PENDING_REPO_ID` and `PENDING_BASE_COMMIT` in `task.toml`,
   `PENDING_IMAGE` in `task.toml` and both Dockerfiles, `PENDING_BASE_COMMIT` in
   `pre_artifacts.sh`, `"base_commit"` in `tests/config.json`.
5. `gold_bot.py check`, push, report, say submit.

---

# arenaflow — match-void-rescore (BUILT, DUPLICATE, DO NOT PUSH)

## Snapshot

`snapshot.borrower-v2-g1787511815592315.zip`, 166 files, unpacks as **ArenaFlow**:
a single-package TypeScript competitive-gaming engine (tournaments, matchmaking,
scoring, rankings, rewards, anti-cheat, seasons, event sourcing, memory and
`node:sqlite` persistence, HTTP router, SDK, CLI). Node >= 24, vitest 3.2,
typescript 5.8, eslint, prettier. **Zero runtime dependencies**; `node:sqlite` is
a Node 24 builtin, so nothing native is compiled.

The zip name is a platform repo NAME and not a codebase: the same name has
already carried sagemark (Vue) and BiomeWeaver (npm workspaces). This one is
neither.

`npm ci` clean. Base green here and inside the image:

| suite | files | tests |
| --- | --- | --- |
| `npm test` (`tests/**` minus integration) | 27 | 123 |
| `npm run test:integration` | 2 | 3 |

`npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Step 0 — can this snapshot be graded? YES, proven

The platform API has answered 429 (Vercel Security Checkpoint) to every call
from this box since 2026-09-07 11:04, so `envs` / `env-log` are unreachable and
there is no repo id without a draft. Step 0 was closed the other way, by
rebuilding the generator's own recipe locally and running the base suite in it.

Recipe, from `result/sagemark-48bf/env-log.v1.txt`, the log of an earlier
snapshot under this same repository name, kept here as `ctx/Dockerfile`:

```
FROM node:24-bookworm-slim
RUN apt-get install ca-certificates git
COPY repo/ /app
RUN npm ci
RUN npx vitest run --reporter=dot
RUN git config --global --add safe.directory /app
```

Built as `arena-env:local`. `npm ci` succeeds, and step 5's bare
`npx vitest run` is green here (27 files, 123 tests) because ArenaFlow ships a
root `vitest.config.ts` that a bare run picks up. That was the open question on
BiomeWeaver, where a bare run collapses; it does not arise here. Every local
verification below ran against that image with `--network none`.

## Claim

**Task name:** `match-void-rescore`   **Category:** `feature_request`
Reserved in `result/arenaflow-SLATE.md` at 23:20 on 2026-09-07. One other
session unpacked this snapshot at 23:15 into `result/arenaflow-3736`; the slate
lists seven further gaps that stay clear of this one.

## The gap

`voidMatch` is exported from `src/domain/matches/match.ts`, `MatchVoided` is a
declared event type, and `projectEvent` already knows how to mark a match
voided. Nothing above the domain layer ever calls any of it. `TournamentService`
has no way to withdraw a result, so points a match should never have awarded
stay on the board forever, and `RankingEngine.recomputePublished` — written for
exactly this, and named in handbook section 7 — has no caller either.

## What the feature is

`TournamentService.voidMatch({ matchId, at, reason })` takes a match out of play
while its tournament is active, then rebuilds every score record in that
tournament from the results that survive, oldest first, ties broken by match id.
Nothing is subtracted: awards are decided again through the scoring engine, so a
streak bonus a later win only reached because of the withdrawn one stops being
paid, and the counts, both streaks, the explanation trail and the last update all
follow the surviving chain. A player left with nothing gets a fresh record dated
at the withdrawal. `MatchVoided` carries the rebuilt records, so a replay of the
journal lands on the same standings the live arena holds.

A ledger answers `voidHistory` and `voidsForPlayer` with one entry per
withdrawal and one change per player whose total moved.
`publishLeaderboard` freezes a board and every ranking handed out afterwards
measures movement against it. The whole thing is reachable over HTTP, the SDK
and the CLI, and the report prints what a tournament withdrew.

Difficulty sits in the arithmetic, not the surface:

1. subtracting the recorded award is wrong whenever a streak bonus is involved,
   and five wins minus one is 400 rather than 450;
2. `bestStreak` cannot be decremented, it has to come out of the surviving run;
3. two matches finishing on the same millisecond change the answer depending on
   which one folds first;
4. an emptied record is dated at the withdrawal, not at the result it lost;
5. the standings after a withdrawal are not a delta any projector can fold, so
   the event has to carry them or replay diverges from the live store.

## Numbers

| | |
| --- | --- |
| solution.patch | 644 added, 11 removed, 26 files |
| test.patch | 621 added, 2 files |
| held-out over churn | 621 / 655 = 0.948 |
| f2p | 44 |
| p2p | 127 (126 shipped, 1 held-back case that already passes) |
| instruction | 290 words, 7.2 articles per 100, detector clean, correct trailer |
| solution lines per instruction word | 2.22 |

Account floors from `gold.me`: solution 459 lines / 4 files, held-out 596 lines /
2 files, instruction 100 to 300 words, f2p 8, p2p 50, 0.9 to 7.5 lines per word.
All met.

## Verified locally

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:integration`, `npm run build` all clean with the feature applied.
  Shipped suite green, 126 of 126, no regression. Prettier is not a gate: the
  base tree already fails `--check` on 54 files.
- `./verify_task.sh` builds the verifier image from `arena-env:local` and runs
  the real `tests/test.sh` and `tests/grader.py` with `--network none`:
  **reward 1, f2p 44/44, p2p 127/127**.
- `./verify_task.sh base`, no solution at all: **reward 0, f2p 0/44, p2p
  127/127**. Every held-back case fails at the base tree for its own reason.
- `python3 mutants.py`: **33 mutants, 0 survivors**. Every rule the request
  states is caught, including the fold order, the match-id tie-break, the
  emptied record's date, the event payload, the projector, both sides of a
  ledger change, the published baseline, all four routes, three SDK methods,
  four CLI commands and the catalog codes.
- `python3 audit.py`: 19 sentences, 3 of them scene setting, 45 graded cases,
  mapped in both directions, and nothing the suite asserts on is absent from
  both the base checkout and the request.

## Attack runs

| attack | result |
| --- | --- |
| submitted `src/errors.ts` registers an exit hook that writes a forged junit to `/logs/verifier/new_junit.xml` and to the capture pipe | **reward 0** |
| submission deletes 3 of 4 cases from `tests/domain/scores.test.ts` | **reward 1, p2p 127/127** (restored from the base commit) |
| same attack with the restore block removed | **reward 0, p2p 124/127** — the discriminator, so the restore is doing real work |
| differently shaped build: no rebuild module, no ledger class, no published-board class, plain maps and arrays inside the service | **reward 1** — the cases grade behaviour, not internals |

## Verifier design

`tests/test.sh` is generated by `mktestsh.py` from the frozen `frame/test.sh`,
which asserts the bytes above and below the markers never moved. Inside the
block:

1. every shipped test file is restored from the base commit, skipping the two
   held-back paths, so a submission cannot be graded on its own copy of the
   pass-to-pass suite. Degrades to the on-disk files when git or the base commit
   is missing.
2. a canary case that cannot pass runs in the graded selection. A report where
   it is missing or green is rejected and every declared id is published as
   failed, with the reason.
3. both selections run under configurations written in `/tmp`, never read out of
   `/app`, so a committed config cannot decide what a case reports.
4. the runner is dropped to `nobody` with `setpriv` and both junit reports are
   streamed through root-owned FIFOs; the reader keeps the FIRST document that
   comes out and writes it into root-owned `/logs/verifier`. A later rewrite by
   submitted code reaches neither. The pipes are mode 0666 because the runner
   opens its report file read/write and refuses a write-only pipe.
5. every step degrades. No root, no `setpriv`, no `mkfifo`, no git: the run still
   happens against plain files rather than refusing.

## Left to do, all platform side

The API has been 429 since before this task started, so nothing has been pushed
and no draft exists. Once a draft is created on this repo:

1. `gold_bot.py call gold.tasks.get` for the repo id and base commit.
2. `envs` / `env-log` and the `Step` lines; compare against `ctx/Dockerfile`.
3. `gold_bot.py pull` the draft and replace `frame/test.sh`, `grader.py`,
   `pre_artifacts.sh` and both Dockerfiles with the platform's own copies, then
   regenerate `test.sh` with `mktestsh.py`.
4. Fill the markers: `PENDING_REPO_ID` and `PENDING_BASE_COMMIT` in `task.toml`,
   `PENDING_IMAGE` in `task.toml` and both Dockerfiles, `PENDING_BASE_COMMIT` in
   `pre_artifacts.sh`, `"base_commit"` in `tests/config.json`.
5. `gold_bot.py check`, push, report, say submit.
