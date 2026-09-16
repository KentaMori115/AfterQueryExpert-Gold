# arenaflow — match-void-rescore (session 373622a5, tree result/arenaflow-3736)

## Snapshot

`snapshot.borrower-v2-g1787511815592315.zip`. ArenaFlow, a deterministic
competitive-gaming engine: tournaments, matchmaking, scoring, rankings,
rewards, anti-cheat, seasons, an event journal with replay and snapshots,
memory and `node:sqlite` persistence, plus HTTP, SDK and CLI surfaces over one
`TournamentService`. TypeScript 5.8 strict, Node 24, vitest 3.2, no runtime
dependencies.

`npm ci` runs offline from the box's npm cache. Base state, all green:

| check | result |
| --- | --- |
| `npm test` | 27 files, 123 tests |
| `npm run test:integration` | 2 files, 3 tests |
| `npm run typecheck` / `npm run lint` / `npm run build` | clean |

`npx prettier --check` fails on 73 files at the base commit, including shipped
test files, so formatting is not a gate here and CI does not run it.

## Claim

**Task name:** `match-void-rescore`  **Category:** `feature_request`
Reserved in `result/arenaflow-SLATE.md`. A peer session unpacked the same
snapshot into `result/arena-1787511` minutes earlier and had claimed nothing
at the time of writing.

## Step 0 — can this snapshot be graded?

Proven locally, not yet against the platform's own log (that needs a repo id,
and a repo id only appears beside a task that already exists on the repo).
`ctx/Dockerfile` is the generator recipe seen in
`result/sagemark-48bf/env-log.v1.txt` for this repo slot:

```
FROM node:24-bookworm-slim
(install git, ca-certificates)
COPY repo/ /app
RUN npm ci
RUN npx vitest run --reporter=dot
RUN git init && commit
```

Built here as `af3736-env:local`. `npm ci` and the bare `npx vitest run` both
succeed in it: the repo has a root `vitest.config.ts`, so a bare run resolves
the whole unit suite with no build step. The verifier does not depend on that
anyway, since `test.sh` writes its own runner configuration.

**To confirm once a draft exists:** `envs <repoId>`, `env-log <repoId>
<version>`, and grep the `Step` lines for `npm ci`. vitest is a devDependency,
so an image built without it cannot run a single case.

## The gap

`MatchVoided` is in the event catalog, `voidMatch` is in
`domain/matches/match.ts`, the projector has a `MatchVoided` branch, the
handbook promises movement is measured against a published board "after a
voided match", and `docs/reference.md` says a voided event "includes reason".
Nothing in `TournamentService` reaches any of it. A result recorded wrong
keeps its points forever, and there is no way to take it back.

## What the feature is

`TournamentService.voidMatch({ matchId, reason, at })` withdraws a completed
match of an active tournament. The match becomes `voided`, stamped `at`, still
carrying the results it was completed with. Every player who held a result on
it has that tournament's score **rebuilt** from the matches that still stand,
oldest settlement first and ties by match id, each result scored again through
the tournament's scoring config against the score built so far. A player left
with nothing keeps a record reading zero stamped at the withdrawal. Players
the match never touched are not rebuilt. The call answers with `match`,
`tournamentId`, the trimmed `reason`, `at` and `rebuilt`. `MatchVoided` lands
on the match stream, and replaying the journal reaches the same scores.
`POST /matches/:id/void`, `match:void` and `matches.voidMatch` reach the same
correction, and a tournament report counts `withdrawn`.

Difficulty lives in the interaction, not the surface:

1. **Rebuild, not subtraction.** Totals, win/loss/draw counts, the live
   streak, the best streak and the explanation list all depend on the order
   results arrived in. Take one win away and a five-win streak bonus later was
   never earned. Subtracting the awarded points leaves five of those wrong.
2. **The projector has to agree.** `MatchCompleted` carries no results, so the
   base projector sealed every replayed match with all-draw results. A rebuild
   that reads match results therefore diverges on replay unless each
   `ScoreSubmitted` is held on its match first. The instruction states the
   parity, not the mechanism.
3. **Two orderings.** The service reads matches from a store that sorts by id;
   the projector reads a Map in creation order. Only an explicit
   `completedAt`-then-id order makes the live run and the replay agree, and
   one graded case builds a fixture where those two orders disagree.
4. **The zeroed player.** A player whose only match is withdrawn keeps a
   record, stamped at the withdrawal rather than at any match.

## Numbers

| | |
| --- | --- |
| solution.patch | 707 added, 12 removed, 21 files (485 added non-test over 20) |
| test.patch | 694 added, 2 files |
| held-out over churn | 694 / 719 = 0.965 |
| held-out under solution added | 694 < 707 |
| f2p | 43 |
| p2p | 126 (123 unit, 3 integration) |
| instruction | 259 words, 8.3 articles per 100, detector clean, correct trailer |
| solution lines per instruction word | 2.73 |

## Verified locally

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:integration` and `npm run build` all clean with the feature.
- Shipped suite green with the feature: no regression, 126 of 126.
- `./verify_task.sh`: builds the verifier image from the environment image and
  runs the real `tests/test.sh` and `tests/grader.py` in a container with
  `--network none`: **reward 1, f2p 43/43, p2p 126/126**.
- `./verify_task.sh base`, no solution: **reward 0, f2p 0/43, p2p 126/126**.
  Every held-back case fails on its own reason (`service.voidMatch is not a
  function`, a 404 from the router, an unknown CLI command), not because a
  file would not load: the suites import only modules that exist at the base
  commit.
- `python3 mutants.py`: 19 mutants, **0 survivors**. Every stated rule is
  caught by at least one case, including the settlement order, the id
  tie-break, re-scoring through the tournament's own config, the zeroed
  record's stamp, both refusal guards, the trimmed reason, the projector's
  rebuild, the projector's result tracking, the event's reason, the report
  count, the CLI command and the route body.
- `python3 audit.py`: 15 sentences, 3 of them scene setting, 12 mapped to 43
  graded cases, every graded case mapped back, and no name or literal in the
  held-back suite that is neither in the base checkout nor named by the
  request.
- Attack runs, all three scoring **reward 0**:
  `attacks/stub-graded.patch` commits trivially passing files at the held-back
  paths (the grader resets them from `test.patch`);
  `attacks/config-shadow.patch` rewrites `vitest.config.ts` and the `test`
  script to run one harmless file (both selections run under configs written
  by `test.sh`, never one read out of `/app`); and
  `attacks/p2p-rewrite.patch` carries the reference solution plus a real
  regression in `presetNames()` **and** the edit to
  `tests/engine/catalog.test.ts` that hides it.

  That third one scored **reward 1** against the first cut of this verifier,
  which is the hole session bd/768a6950 reported from `reward-recall` on
  2026-09-08. A submission owns the tree its p2p evidence lives in. `test.sh`
  now runs `git checkout <base_commit> -- tests` after `grader.py prepare`, so
  every test file the base commit carries goes back the way it was while
  anything the submission added on top is left alone. The same attack now
  scores **reward 0 at p2p 125/126**, and the reference is unchanged at
  126/126 because its own new `tests/engine/corrections.test.ts` is not a base
  file and survives the restore. The step degrades rather than refusing: no
  base commit, no git, or a failed checkout logs a warning and runs the shipped
  files as submitted.

  `attacks/p2p-delete.patch` is the other half of that: the reference solution
  with two shipped test files and the reference's own new one deleted. Both
  shipped files come back and their cases run, so it scores **reward 1 at p2p
  126/126**, which is the right answer for a build that is functionally
  correct. The block logs `restored 29 shipped test files from <commit>` for
  the run audit, and logs alongside it that the cover is shipped files only: a
  test file added after the base commit is not in that tree and cannot be
  restored. That costs nothing here, because no case in
  `tests/engine/corrections.test.ts` is graded, but it is not a guarantee to
  lean on elsewhere.

  Deleting on its own only shows the restore ran. `attacks/p2p-delete-regress.patch`
  is the row that shows the restored cases are also graded: the same deletions
  plus the `presetNames()` regression score **reward 0 at p2p 125/126**, and the
  one failure is `tests/engine/catalog.test.ts.scoring presets and catalog >
  lists presets`, a case inside a file the submission deleted. Session
  bd/768a6950 measured the same pair on `reward-recall` against four deleted
  files and 38 cases, with the same verdicts.

Full matrix, all five runs re-measured after the hardening:

| run | reward | f2p | p2p |
| --- | --- | --- | --- |
| reference | 1 | 43/43 | 126/126 |
| base, no solution | 0 | 0/43 | 126/126 |
| attack: rewrite a shipped test | 0 | 43/43 | 125/126 |
| attack: delete shipped tests | 1 | 43/43 | 126/126 |
| attack: delete shipped tests AND regress | 0 | 43/43 | 125/126 |
| attack: stub the graded files | 0 | 0/43 | 126/126 |
| attack: shadow the runner config | 0 | 0/43 | 126/126 |
- Residual, and the same one the shipped machinery on this seat carries: a
  submitted module could in principle spawn a detached process that rewrites
  `new_junit.xml` after the reporter has written it. The canary case plus the
  guard catch a neutered runner, a missing report and a run that dies with
  nothing marked failed, which is what the accepted design covers.

## ciChecks codename sweep

`grep -ric silver` over the bundle: **0**. The base repo uses `silver` as a
reward tier in `docs/handbook.md`, `docs/cookbook.md`, `src/examples/recipes.ts`
and two shipped test files, and the base repo is not scanned. Two hunks came
close: the handbook section was placed at the end of the file rather than
renumbered into `## 20`, so no hunk touches the worked reward example, and
`mkpatch.sh` gives `*.md` a diff driver whose `xfuncname` can never match, so
git stops quoting the nearest heading into the `@@ ... @@` text. Without that,
the header of the handbook hunk read `@@ ... @@ Prize pool 1000. Gold 70% for
rank 1, silver 30% for rank 2.`

## Files

Owned: `src/engine/corrections/{rescore,void-match,index}.ts` (new).
Edited: `src/engine/tournament/tournament-service.ts`,
`src/events/replay/projector.ts`, `src/domain/matches/match.ts`,
`src/engine/reporting/report.ts`, `src/engine/index.ts`,
`src/api/routes/matches.ts`, `src/sdk/matches.ts`, `src/cli/index.ts`,
`src/cli/commands/index.ts`, `tests/engine/corrections.test.ts` (new),
`README.md`, `docs/{api,cli,cookbook,event-sourcing,handbook,reference,sdk}.md`.
Held back: `tests/engine/withdrawn-results.test.ts`,
`tests/events/withdrawn-replay.test.ts`.

## Left to do, all of it needing the draft

1. `gold_bot.py call gold.tasks.get` on the draft for the repo id and the base
   commit.
2. `envs` / `env-log`, then rebuild that image locally and re-run
   `./verify_task.sh` with `AF_ENV_IMAGE` set to it.
3. Fill five markers: `repository_url` and `base_commit_hash` in `task.toml`,
   `base_commit` in `tests/config.json`, and `FROM PENDING_IMAGE` in both
   Dockerfiles. Leave `pre_artifacts.sh` as the draft holds it, it carries the
   base commit already.
4. `gold_bot.py check`, push, report, say submit.
