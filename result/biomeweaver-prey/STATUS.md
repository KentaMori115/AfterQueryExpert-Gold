# biomeweaver — prey-competition (session dd9ed863, tree result/biomeweaver-prey)

## Snapshot

`snapshot.borrower-v2-g1787803450496649.zip`, 177 files, unpacked 2026-09-07.
BiomeWeaver "Seed World": TypeScript 5.9.2, Node 24.7.0, npm workspaces, vitest
3.2.7, 13 packages plus `ecosystem-lab` fixtures. One runtime dependency
(`yaml`, in `capsule-source`); devDependencies eslint, prettier, tsx,
typescript, typescript-eslint, vitest.

`npm ci`, `npm run typecheck` and `npm test` all clean locally:

| suite | files | tests |
| --- | --- | --- |
| unit | 29 | 165 |
| biomes | 2 | 5 |
| properties | 4 | 8 |
| cli | 1 | 6 |

184 tests, all green. p2p floor 50 is covered many times over.

Two peer sessions share this snapshot: `result/biomeweaver-7e1d`
(habitat-crowding) and `result/ecolab-a6e44a5a`. Claims live in
`result/biomeweaver-SLATE.md`.

`packages/biomeweaver/src/baseline-guard.test.ts` forbids eight phrases in
`packages/**` — the eight gaps the codebase was cut around. Keep those literal
phrases out of any solution file.

`packages/tick-runtime/src/advance.test.ts` asserts the exact `PHASES` array, so
no new phase name may be added.

## Step 0 — can this snapshot be graded?

NOT RUN YET. It needs the repo id, and a repo id only appears beside a task that
already exists on the repo. `gold_bot.py list` answered 429 (Vercel security
checkpoint) on every attempt from 11:04 to 11:30 — three sessions share one
token. The check itself is the account-updater lesson: this repo needs `npm ci`
(vitest + typescript + yaml are not in a bare node image), so if the platform's
TypeScript generator only does `FROM node:24 … COPY repo/ /app`, no verifier can
run here.

The repo's own Dockerfile is `node:24-bookworm` + `npm ci` + typecheck + test,
which is a working recipe, but that is not proof the platform used it.

## Claim

**Task name:** `prey-competition`  **Category:** `enhancement`

`packages/predation-engine/src/consume.ts` walks predator cohorts in sort order
and each takes `min(count × perPredatorPerTick, prey.count)` off a *running*
prey count. Two predator cohorts on one prey cohort means the first empties it
and the rest take nothing, and a predator has no cap on total take across its
several prey. The task rations contested prey: asks measured against phase-start
counts, an authored per-species `maxIntakePerTick` budget, and a round-based
settlement that splits a prey cohort proportionally with `proportionalShares` /
`assignRemainders` and then trims each predator's offers to its budget.

Reserved in `result/biomeweaver-SLATE.md` at 11:24.

---

## Draft

`Iyqs0O4Gt2d1A2SMIabO`, created by the user 2026-09-07.
https://experts.afterquery.com/projects/gold/tasks/Iyqs0O4Gt2d1A2SMIabO

## The gap

`packages/predation-engine/src/consume.ts` walks predator cohorts in sort order.
Each one takes `min(count x perPredatorPerTick, prey.count)` off a *running*
prey count, so with two predator cohorts on one prey cohort the first empties it
and every later one takes nothing, and a predator hunting several prey has no
limit on what it takes in total. `PredationRule` carries only
`perPredatorPerTick`, so intake is linear in prey density with no saturation.

The two shipped biomes never contest a prey cohort: one predator per prey per
region, no authored limits. So every rule this task adds is invisible to the
examples an agent can run, which is where the difficulty lives.

## What the feature is

Predation settles a whole tick at once.

- **Asks** are read off counts as the phase began, `count x perPredatorPerTick`,
  half-even at model scale. A rule may carry `saturation`, and then the ask is
  `count x perPredatorPerTick x prey / (prey + saturation)` rounded half-even
  **once**, over the whole product.
- **Budgets**: a species may carry `maxIntakePerTick`, holding a cohort to
  `count x maxIntakePerTick` prey across every rule it authors. A negative in
  either field is an error; a species that caps intake and hunts nothing draws a
  warning, not an error.
- **Settlement in rounds**: a prey cohort offers what it still holds to the
  claims still wanting it, whole where the asks fit and otherwise split in
  proportion through `proportionalShares` and `assignRemainders`; each capped
  predator then trims what it collected to its remaining budget, in proportion,
  through the same helpers. Prey freed by a trim is back on the table next
  round. A round that moves nothing ends it, which is bounded because every
  round closes a prey cohort, a budget, or every claim.
- **Reporting**: one removal per claim that took something, plus one pressure
  row per hunted prey cohort carrying what it was asked for and what it lost,
  both in ascending key order. A claim that took nothing goes unreported.
- **Hunger**: a predator left short of its ask ends the phase with its condition
  blended toward the share it got, three parts old to one new, through the
  existing `applyCondition`.

Five exact-value cruxes an agent cannot check against either shipped biome:
simultaneous asks rather than a running count; the proportional split and its
remainder key order; the proportional budget trim rather than a first-come cap;
the rounds that hand back what a trim released; and one rounding over the whole
saturated product rather than two.

## Numbers

| | |
| --- | --- |
| solution.patch | 630 added, 60 removed, 14 files (churn 690) |
| test.patch | 740 added, 2 files |
| test/churn | 1.07 |
| f2p | 36 |
| p2p | 184 |
| instruction | 297 words, 7.7 articles/100, detector clean, correct trailer |
| solution lines per instruction word | 2.12 |

Floors on this seat: solution 459/4, held-out 596/2, instruction 100-300 words,
f2p 8, p2p 50, 0.9-7.5 solution lines per instruction word. All met.

## Verified locally

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check` and
  `npm test` all clean with the feature: 201 unit, 5 biome, 8 property, 6 CLI.
- The two shipped biomes run byte-identical before and after the change (flow
  digests and final cohort counts over 40 ticks of all three scenarios), so no
  base expectation moved and no example validates the new rules.
- 36 held-out cases fail at the base tree, pass with the reference.
- `./verify_task.sh` (real `test.sh` + real `grader.py` in a container):
  reward 1, f2p 36/36, p2p 184/184.
- `./verify_task.sh base`: reward 0, f2p 0/36, p2p 184/184.
- `python3 mutants.py`: 12 wrong readings of the request, 12 caught.
- `./attack_matrix.sh`: graded cases replaced with vacuous ones, a committed
  vitest config and setup file, a package that exits the process on import, and
  the package deleted outright all land at reward 0 with 36 f2p failed. A fifth
  row builds the feature in a completely different shape (one file, other
  names, none of my helper modules) and scores reward 1 with 36/36, so the
  cases grade the behaviour rather than my structure.
- `python3 audit.py`: the four instruction-to-test checks. Clean except that
  `proportionalShares` and `assignRemainders` are named in the instruction and
  reached only through the values they produce, never called by a case. That is
  deliberate: calling them in a case would grade my implementation instead of
  the numbers, and the mutation battery covers the split and the remainder
  order.

## Verifier (rebuilt 12:20 to need no vitest)

The first cut drove both selections with vitest under configurations written by
`test.sh`. A container built with `npm ci --omit=dev` then showed what that
costs: no vitest in the image, no case runs, and a correct submission scores 0.
Since Step 0 is unanswered, the runner now needs nothing but node.

- `harness/shim.mjs` carries the slice of the vitest API these suites use:
  `describe`, `it`, `it.each` with `%s` formatting that matches on bigints, and
  the twelve matchers the 220 cases call, `not` included.
- `harness/hooks.mjs` resolves `vitest` to the shim, the workspace names to
  `packages/*/src/index.ts`, and the `.js` specifiers TypeScript writes to the
  `.ts` beside them. Node 24 transforms the types itself.
- `harness/run.mjs` reads a per-run token off an already open standard input,
  shuts the descriptor, and reports each case on stdout as
  `V <token> pass|fail <file>\t<case>`, closing with `END <token> <count>`.
- `harness/publish.py` never imports repository code, holds the whitelist
  itself, and writes a report for every declared id whatever the child did: a
  verdict without the token, a duplicate, one after the closing line, or a
  missing closing line publishes the whole selection as failed.

Ids out of the harness are identical to the ids vitest emits, checked against
both reports: 184 base, 36 graded, no difference.

Around it: the shipped suites and the runner's own configuration files come
back from the base commit before anything runs, so an edited assertion cannot
stand in for a passing build; tracked files under `node_modules` are removed,
since the directory is gitignored but a submission can force-add one; the
harness is root-owned 0444 in a 0555 directory; the graded child runs as
`nobody` through `setpriv` where the block has root, and `/app` is handed to the
same user because the CLI cases write run snapshots into the capsule they
simulate. Every step degrades rather than refuses: no root, no `setpriv`, no
`/verify` and no `git` each fall back, and a node that will not take the
transform flags walks down a ladder to what it does take.

## Verifier — first cut, kept for the record

`mktestsh.py` splices the block into the frozen frame and asserts every byte
outside the markers is unchanged. Both selections run under configurations
`test.sh` writes into `/tmp`, never one read from `/app`, so a committed
`vitest.config.ts`, workspace file or setup file cannot decide what runs or what
it reports. `node_modules/` and `dist/` are gitignored, so a submission cannot
ship a shadowed runner either. A python3 publisher that imports nothing from
`/app` then checks each report exists, parses, carries cases, and does not claim
everything passed while the run exited non-zero; on any of those it rewrites the
report with every declared id failed and says why.

## Environment exposure, measured

| image | result |
| --- | --- |
| `npm ci` (dependencies and devDependencies) | reward 1 |
| `npm ci --omit=dev` (no vitest, no typescript) | reward 1 |
| no install at all (no `node_modules`) | reward 0, 96 of 184 p2p pass |

Only `yaml`, a real runtime dependency of `capsule-source`, is out of reach: at
1.4 MB it cannot be vendored under the 900 KB bundle cap. So the task survives
any image that installed dependencies at all, and no image without them can
grade any task on this repository, whoever writes it.

## Attack matrix

| row | outcome |
| --- | --- |
| graded cases replaced with cases that assert nothing | reward 0, 36 f2p failed |
| a committed `vitest.config.ts`, workspace file and setup file | reward 0, 36 f2p failed |
| the package exits the process as soon as it is imported | reward 0, everything failed |
| the package forges verdict lines and steals the token off the writer | reward 0, everything failed |
| the predation package deleted outright | reward 0, 40 p2p failed |
| a regression in shipped behaviour with the shipped case edited to match | reward 0, the real regression still shows |
| the feature built in a different shape, one file, other names | **reward 1, 36/36** |

## Still blocked, all platform side

`experts.afterquery.com` has answered 429 (Vercel Security Checkpoint) to every
request from this box since 11:04, unauthenticated curl included and with a
browser User-Agent, so it is IP level rather than token level. Three sessions
share the box. Until it clears:

1. Step 0 is unanswered: no `envs` / `env-log`, so nothing proves the platform
   image runs `npm ci`. `yaml` is a real runtime dependency and vitest is a
   devDependency; an image without either cannot run one case here.
2. `pull` cannot fetch the draft, so `task.toml`, the real `test.sh` frame,
   `environment/Dockerfile`, `tests/Dockerfile`, `pre_artifacts.sh`,
   `solution/solve.sh` and the true `base_commit` are all still missing from the
   bundle. `frame/test.sh` is currently the seat copy `original_test.sh`;
   `config.json` carries a placeholder `base_commit`.
3. Nothing can be pushed.

## Ready to push

`push/` holds the five files this task owns outright: `instruction.md`,
`solution/solution.patch`, `tests/test.patch`, `tests/config.json`,
`tests/test.sh`. A sixth, `task.toml`, joins them once the draft is pulled:
`display_title` and `display_description` are ours to write and live nowhere
else, and `set_display.py` rewrites exactly those two lines of the pulled file
and refuses if a third moves. The remaining five bundle files are
platform-generated and stay absent, so a push leaves them untouched. `PUSH.md` says why, and
`prepare_push.sh` pulls the draft, writes the real base commit into
`config.json`, re-splices `test.sh` into the draft's own frame, re-verifies in a
container, restages and pushes.

`gold_bot.py check push --offline` passes every floor: solution 630 added over
14 files, tests 740 over 2, instruction 297 words, f2p 36, p2p 184, 2.12
solution lines per instruction word, bundle 110797 bytes of 900000.
