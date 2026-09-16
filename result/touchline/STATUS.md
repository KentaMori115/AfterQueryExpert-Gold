# touchline-league-api

Snapshot `snapshot.borrower-v2-g1787663275706337.zip`, unpacked 2026-09-06 to
`AQ_dragan/result/touchline/repo`. Seat: dragan (`auth-dragan.json`).

## What it is

Administration service for a grassroots football league. TypeScript, Express 4,
zod, `node:sqlite` (`DatabaseSync`, so Node >= 22.5), jest + ts-jest + supertest.
No native dependency anywhere; `npm ci` installs 498 packages in seconds.

13,858 lines of TypeScript. Twelve modules under `src/modules/<name>/`, each the
same six layers (types, schema, repository, service, controller, routes):
auth, audit, clubs, seasons, venues, divisions, teams, players, fixtures,
results, standings, discipline.

Base suite locally: **410 passed, 13 suites, 22 s** (`npx jest`, node 24.7).

## Repo id

Unknown. No task exists on this repo yet, so `gold_bot.py list` shows no id for
it and Step 0 (`envs` / `env-log`) cannot run until the user creates the first
draft.

**Step 0 risk is real here.** The image has to carry `node_modules`: express and
zod at runtime, jest + ts-jest + supertest + typescript to run a single test.
account-updater (2026-08-29) was the same shape and the generator installed
nothing, which made the task ungradable. Nothing is built on this repo until
`env-log` shows an `npm ci` step and a local rebuild of those Step lines runs
the base suite green.

## Slate

| task | who | changed files | state |
|---|---|---|---|
| suspension serving | this session | new `src/modules/suspensions/*`, `src/db/schema.ts`, `src/app.ts`, `src/modules/discipline/*` | proposed 2026-09-06, waiting on the user's draft |

## The gap

`banFor`, `stands`, `isOutstanding` and `counts` are exported and never called.
The discipline module works out what every card is worth and totals it into
`matchesBanned`, and nothing anywhere turns those matches into games actually
missed. `ineligiblePlayer` sits in `AWARD_REASONS` with no way to know who was
ineligible.

## 2026-09-06 15:15, session mindriftwork-4b takes the claim over

Earlier session (STATUS 09:55, DESIGN 11:15) is gone; no draft was ever made
on this repo (`gold_bot.py list` shows no touchline task). Same gap kept:
**suspension-serving**, `feature_request`. Two peers (mindriftwork-cb, -4f)
asked whether they hold this repo; no answer at the time of writing.

Facts checked this session:
- `record()` key set is pinned EXACTLY by a base test (ten keys). No new key on
  the record; the ledger goes on the new endpoints. `standing` may change
  meaning (suspended only while a match is still to serve) because no base
  test confirms a result, so no game is `played` there and every ban stays
  outstanding.
- Services and repositories import nothing outside `node:sqlite`; express and
  zod live in routes/controllers/schemas/middleware only. If Step 0 shows an
  image without `node_modules`, the held-out suite has to grade the service
  layer directly (cloudvault jest-shim machinery).
- `node_modules` is a real dir under `repo/` (347 entries), node 24.7.0.

Waiting on the user's draft for the repo id, then Step 0.

## suspension-serving: built, verified and PUSHED 2026-09-06 (session mindriftwork-4b)

Draft **Z7Y1DrVGciDwN7weC5q7**, repo **5I1rE8Y77wrdN5fMGbYP** (platform name
`touchline-league-api`), base `dcb5ed4892e0875ce4929893411d2eb565c6c567` (=
headSha), environment **v8**, category feature_request. Bundle in
`tasks/suspension-serving/`; work repo `tasks/suspension-serving/work`
(branches main = base, solution, heldout; `work-heldout` is the heldout
worktree). Awaiting the user's submit.

### Step 0, proven

Eight environment versions exist; v1, v6, v7, v8 published. Only v8 is clean:
`npm ci` into **/opt/deps/node_modules** (jest, ts-jest, typescript, express,
zod, supertest), `rm -rf /app/node_modules`, `/app` proven pristine by `git
status --porcelain --ignored`. v6/v7 `COPY . /app` the whole build context
into the checkout. No ENV, no NODE_PATH, no symlink, so an agent running
`npx jest` in /app gets nothing until it links `/opt/deps/node_modules`
(then 410/410). Rebuilt locally as `touchline-env-v8` from the exact Step
lines (`tasks/suspension-serving/envbuild/Dockerfile`); base suite 410/410
under `--network none` both agent-style (symlink) and verifier-style
(root-owned config, ts-jest by absolute path with `diagnostics: false`,
`modulePaths: ["/opt/deps/node_modules"]`, `testEnvironment` by absolute path).
ts-jest with full diagnostics fails there (`TS2580 Cannot find name 'process'`)
because `@types/node` is not under /app.

`.gitignore` says `node_modules/` (directory only), so a symlink named
`node_modules` is NOT ignored and `git add -A` commits it. The verifier
`rm -rf /app/node_modules` before running, so a committed symlink or fake
package tree is inert.

### Design

Derived module `src/modules/suspensions/` (types, schema, service,
controller, routes; no repository), wired before discipline in `app.ts`;
`DisciplineService` takes a `SuspensionService` and `record().standing`
follows `matchesOutstanding` instead of `matchesBanned > 0`. Two readings:
`GET /players/:playerId/suspensions?asOf=` (ledger) and
`GET /fixtures/:fixtureId/eligibility` (day-before reading). Rules: ban =
max(straight, accumulation); served by games of `card.teamId` with status
`played` only (awarded reaches the table, serves nothing); each game serves
one match off the earliest outstanding card shown to that side before it;
barred from every side of the current club; rescinded cards drop out and
their games fall through; `asOf` cuts cards and games. seed.ts registers one
player, shows a red, prints the ledger.

Base test pins the record's ten keys exactly, so the record gained no key.

### Numbers

487 solution lines / 11 files (churn 493), 1367 held-out lines / 2 files
(`tests/ban-serving.test.ts`, `tests/matchday-eligibility.test.ts`, named
off the feature), 299 instruction words, 48 f2p / 410 p2p, lines/word 1.63,
bundle 166 KB. Base vacuity 0 of 48 (four vacuous cases were folded: two
404s, two `standing` cases the base already satisfied). Local rehearsal
(`verify_task.sh`): nop 0 (p2p 410/410), oracle 1, alt-shape 1, and 0 on
break-only (45/48), neuter-expect, forge-report, forge-stream, shadow-config
(jest.config + setup + helpers + fake node_modules/supertest),
edit-base-test (p2p 408/410), kill-runner (SIGKILL on the jest parent: every
id published failed). 16 semantic mutants (`mutants.py`) all killed; two
first-round survivors were equivalent mutants caused by the service filtering
`status: 'played'` before the helper ran, fixed by letting `serves()` decide
over every game of the side; the third (clearedOn on a partly served ban)
was a missing assertion, added.

### Verifier

Port of cloudvault delivery-retries: harness in /verify, jest from
/opt/deps, `--config` root-owned, guard.js snapshots expect/Object.is/
JSON.stringify and proves a failing toBe/toEqual/toHaveLength still throws
before and after each case, reporter in the parent signs the stream with a
stdin token, `publish.py -I` publishes every declared id. Restores the 13
shipped suites plus tests/helpers.ts and tests/setup.ts from HEAD. Ids are
`<rel path> > <describe> > <it>`.

### Submission 1, 2026-09-06 16:15 (user granted submit for this draft)

ciChecks passed with three warnings (487 solution lines below the recommended
525; 299 words, aim under 250; three test titles read nearly verbatim as
instruction sentences: awarded game / abandoned game / home side first).
aiCheck passed, similarity passed, oracleNop running. Monitoring every 2 min.

Submission 1 verdict: ciChecks, aiCheck, similarity, oracleNop and
qualityCheck all passed; **Calibration I failed, too_easy, 3 of 5 solved**.
Reading the five trial reports: every trial scored 48/48 f2p, so the feature
was fully solved each time. The two zeros were p2p 409/410, both failing the
same shipped case, `discipline.routes.test.ts` pinning the record's ten keys,
because the trial added `matchesOutstanding` and `matchesServed` to it. The
difficulty was accidental, not designed.

## Round 2 redesign

Three rules that collide, none of which the agent can check in its own
container (there is no runner there):

1. An accumulated ban waits a fortnight. No game before the fourteenth day
   after the card serves that part; the straight part starts with the next
   game. `ACCUMULATION_WAIT_DAYS = 14`, `Serving.accumulatedFrom`.
2. One played game pays a match off **both** parts of a card, so a red that
   also crosses a threshold is worth the longer ban, not the sum, and one
   game discharges a match of each part at once.
3. Eligibility is keyed on a match **falling due** on the day of the game,
   not merely being owed. A player inside the fortnight owes a match the
   ledger already shows and is still free to play.

`dueOn(serving, day)` decides the day question, `canServe(serving, teamId,
fixture)` adds the side. Eligibility reads `dueOn` alone, so a bar can hold
against a game of a side that cannot itself serve the ban.

Numbers after the redesign: solution +570 over 11 files, tests +1386 over 2,
300 instruction words, **55 f2p** / 410 p2p, lines/word 1.90, bundle 176 KB.
Base vacuity 0 of 55. Battery: nop 0 (p2p 410/410), oracle 1, alt-shape 1,
and 0 on break-only (52/55), neuter-expect, forge-report, forge-stream,
shadow-config, edit-base-test (p2p 408/410), kill-runner. 22 mutants, 21
killed; `parts-served-separately` survives and is provably equivalent (the
early `straight - served > 0` branch and the `outstanding > 0` guard make
the two forms unreachable apart).

Also fixed the three ciChecks warnings: solution now 570 lines (over the
recommended 525), and the three test titles that echoed instruction
sentences were rewritten to share no phrase with it.

### Submission 2, 2026-09-06

ciChecks passed with one warning left (300 words, aim under 250; the cap is
300 and the three interacting rules do not fit in 250). aiCheck passed,
similarity passed. Monitoring every 2 min.
