# biomeweaver — event-effects (session a6e44a5a, tree result/ecolab-a6e44a5a)

## Snapshot

`snapshot.borrower-v2-g1787803450496649.zip`, 177 files. TypeScript 5.9.2,
npm workspaces, vitest 3.2, 13 packages plus an `ecosystem-lab` of fixtures.
Zero runtime dependencies; devDependencies are eslint, prettier, tsx,
typescript, typescript-eslint, vitest.

`npm ci` clean. Base suite green here:

| suite | files | tests |
| --- | --- | --- |
| unit (`packages/**/*.test.ts` minus `*.cli.test.ts`) | 29 | 165 |
| biomes (`ecosystem-lab/**/*.biome.test.ts`) | 2 | 5 |
| properties (`ecosystem-lab/properties/**`) | 4 | 8 |
| cli (`**/*.cli.test.ts`) | 1 | 6 |

184 tests over 36 files. p2p floor of 50 is met by the unit suite alone.

## Step 0 — can this snapshot be graded?

BLOCKED, not failed. It needs the repo id, and a repo id only appears beside a
task that already exists on the repo. `gold_bot.py list` answered 429 (Vercel
checkpoint) on every attempt between 11:04 and 11:20; three sessions share one
token on this seat. Once a draft exists: `envs <repoId>`, then
`env-log <repoId> <version>`, then grep the `Step` lines for `npm ci`. vitest
is a devDependency, so an image built without `npm ci` cannot run one test and
the task is ungradeable. The repo's own Dockerfile is `node:24-bookworm` +
`npm ci` + typecheck + test, which is a working recipe the generator may or may
not have copied.

## Claim

**Task name:** `event-effects`   **Category:** `bugfix`
**Draft:** `94rf5vEnnGiCqLZ06Edq` (created by the user 2026-09-07).
Reserved in `result/biomeweaver-SLATE.md` at 11:34.

## Step 0 — can this snapshot be graded?

**STILL OPEN, and not ours to clear.** `experts.afterquery.com` has answered
429 (Vercel Security Checkpoint) to every call since 11:04, roughly every three
minutes since. Session dd9ba3d0 reports the same from unauthenticated curl, so
it is the box's IP rather than the token, and three sessions share the box.
Without a call there is no `envs`, no `env-log`, no repo id, no base commit and
no image name, so `task.toml` and both Dockerfiles still carry `PENDING`
markers and nothing can be pushed.

What is known, from `result/sagemark-48bf/env-log.v1.txt`, the log of the
previous snapshot under this same repo name:

```
Step 1/10 : FROM node:24-bookworm-slim
Step 2/10 : (install git)
Step 3/10 : COPY repo/ /app
Step 6/10 : RUN apt-get install ca-certificates git
Step 8/10 : RUN npm ci
Step 9/10 : RUN npx vitest run --reporter=dot
Step 10/10: RUN git config --global --add safe.directory /app
```

So the generator does run `npm ci` for a Node repo, which is the answer Step 0
needs: `yaml` is a real runtime dependency of `capsule-source` and vitest is a
devDependency, and neither can be vendored under the bundle cap.

One thing to check the moment `env-log` is readable. Step 9 there was a bare
`npx vitest run`. BiomeWeaver has no root vitest config, so a bare run resolves
`@biomeweaver/*` through the workspace symlinks to `dist/`, which no step
builds. Proven here in a clean image built from those same steps: 23 of 36
files fail to collect. If the generator ran that step verbatim the environment
build failed and there is no image at all. If it ran `npm test` instead, which
drives the four `vitest.*.config.ts` files and their aliases, everything is
fine. The verifier here does not depend on the answer: it writes its own runner
configuration with the workspace aliases spelled out against
`/app/packages/*/src/index.ts`, so it never needs `dist/` and never reads a
config out of `/app`.

## The gap

`decodeEvent` (packages/biome-model/src/decode.ts) builds four fields on every
authored effect: `resource`, `modifier`, `quantity`, `factor`. The block at the
top of `advanceTick` reads two of them and drops the other two, and handles the
two it reads wrongly:

1. `modifier` / `factor` effects do nothing at all.
2. One quantity is added to **every** pool of that resource, in every region.
   `habitat-loss` authors a single pool, so the shipped suite never sees it.
3. The published flow carries `pools[0]?.region ?? "unknown"`, a region chosen
   by array position rather than the pool that moved.
4. The published flow carries `effect.quantity`, not what `clampNonNegative`
   actually moved.
5. Nothing validates an effect: an unknown resource or region compiles clean.

## What the feature is

An effect gains `region` and `forTicks`, one tick by default, and runs from its
hook's tick for that window. Hooks fire in tick order, then event id, then file
order. A quantity divides over the pools it reaches in proportion to what each
holds when the effect runs, floor first, leftovers walking the pools one unit
each in region id order; pools empty between them split it evenly. A withdrawal
stops at what a pool holds and nothing covers the shortfall. Every pool that
moved publishes its own flow with its own region and the amount it really
moved. A modifier effect scales the habitat modifier of its key while its
window runs, overlapping windows multiplying in firing order with half-even
rounding at each step, and publishes no flow of its own. Compiling refuses an
effect naming a resource or region nobody defined, one carrying neither pair, a
window under one tick or fractional, and a negative factor. `event list` and
`event show <id>` land on the CLI.

Difficulty is in the arithmetic nobody can check against either shipped biome,
neither of which authors a modifier effect, a window, a region or a second pool:

1. the split reuses `proportionalShares` and `assignRemainders`, so a leftover
   unit lands on a particular region and no other;
2. the empty-pool case has to be handled or the remainder walk runs for
   `magnitude` iterations;
3. clamping changes what the flow reports, not just what the pool holds;
4. two overlapping factors round at every step, so 0.333333 twice is 0.111111
   and not 0.111110.

## Numbers

| | |
| --- | --- |
| solution.patch | 628 added, 62 removed, 15 files (521 added non-test over 13) |
| test.patch | 656 added, 3 files |
| held-out over churn | 656 / 690 = 0.95 |
| f2p | 36 |
| p2p | 187 (182 shipped, 5 held-back cases that already pass) |
| instruction | 299 words, 7.7 articles per 100, detector clean, correct trailer |
| solution lines per instruction word | 2.09 |

## Verified locally

- `npm ci`, `npm run typecheck`, `npm run lint`, `npx prettier --check` all
  clean with the feature applied.
- shipped suite green with the feature: 184 of 184, no regression.
- `./verify_task.sh` builds the verifier image from the environment image and
  runs the real `tests/test.sh` and `tests/grader.py` in a container with
  `--network none`: **reward 1, f2p 36/36, p2p 187/187**.
- `./verify_task.sh base`, no solution at all: **reward 0, f2p 0/36, p2p
  187/187**. Every held-back case fails at the base tree for its own reason,
  not because a file would not load: the suites import only `compileCapsule`,
  `simulate` and `runCommand`, all of which exist at the base commit.
- `python3 mutants.py`: 16 mutants, **0 survivors**. Every rule the instruction
  states is caught by at least one case, including the leftover walk order, the
  even split, the clamp, the flow region, the flow quantity, the window edge,
  the firing order, the per-step rounding, the region scope of a modifier, four
  compile refusals and both CLI commands.
- `python3 audit.py`: 18 sentences, 2 of them scene setting, 16 mapped to 41
  graded cases, every graded case mapped back, and no name or literal in the
  held-back suite that is neither in the base checkout nor named by the
  request.
- attack runs: a committed fake runner at `node_modules/.bin/vitest` cannot
  apply, because the file already exists in the image; a submitted module that
  rewrites `fs.writeFileSync` to fabricate the junit report scores **0**. The
  graded selection also runs a canary case that cannot pass, and the block
  republishes every graded id as failed if that canary comes back passing or
  missing.

## Files

Owned: `packages/tick-runtime/src/events.ts` (new),
`packages/resource-engine/src/modifiers.ts` (new).
Edited: `packages/tick-runtime/src/{advance,index}.ts`,
`packages/biome-model/src/{records,decode,compile,index}.ts` (event records
only), `packages/resource-engine/src/{renew,index}.ts`,
`packages/biomeweaver{,-cli}/src/{index,router}.ts`, `docs/disturbances.md`.

Overlap flagged in the slate: habitat-crowding (dd9ba3d0) owns `advance.ts` and
adds one CLI command; all three sessions touch `biome-model` in disjoint
regions.

## ciChecks codename sweep, 2026-09-07

`grep -ric silver` over the eleven bundle files found twelve hits and all of
them are gone now. Ten came from the solution's own specs and one doc comment,
which had copied the crystal-tundra fixture ids `silver-grass-biomass` and
`silver-grass-biomass-growth`; those specs now use `fresh-water`,
`fresh-water-growth` and `mineral-salt-growth`, which are equally real base
ids. Two came from `p2p_node_ids` harvested off the shipped
`species.catalog.test.ts`, so those two ids are dropped: the cases still run in
the shipped selection, they are simply not pinned. The bundle now greps clean,
the held-back suite never carried the word, and the base repository keeps its
own vocabulary, which is not scanned.

## Left to do, all platform side

1. `gold_bot.py call gold.tasks.get` on draft `94rf5vEnnGiCqLZ06Edq` for the
   repo id and base commit.
2. `envs` / `env-log` and the Step lines, then rebuild that image locally and
   run `./verify_task.sh` against it with `BW_ENV_IMAGE` set.
3. `gold_bot.py pull` the draft and replace `frame/test.sh`, `grader.py`,
   `pre_artifacts.sh` and both Dockerfiles with the platform's own copies,
   then regenerate `test.sh` with `mktestsh.py`.
4. Fill the three `PENDING` markers in `task.toml` and the two in the
   Dockerfiles, run `gold_bot.py check`, push, report, say submit.
