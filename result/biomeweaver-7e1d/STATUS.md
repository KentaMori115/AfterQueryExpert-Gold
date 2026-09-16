# biomeweaver — habitat-crowding (session dd9ba3d0, tree result/biomeweaver-7e1d)

## Snapshot

`snapshot.borrower-v2-g1787803450496649.zip`, 177 files. TypeScript 5.9.2,
Node 24.7.0, npm workspaces, vitest 3.2.7, 13 packages plus an `ecosystem-lab`
of fixtures. One runtime dependency, `yaml@^2.8.1`, imported by
`capsule-source`; everything else is a devDependency.

`npm ci` clean, `npm run typecheck` clean, `npm run lint` clean, `npm test`
green: 184 tests over 36 files (unit 165/29, biomes 5/2, properties 8/4,
cli 6/1).

## Claim

**Task name:** `habitat-crowding`   **Category:** `feature_request`
**Draft:** `dpv1ATLm4ET96N8eHGJf`. Reserved in `result/biomeweaver-SLATE.md` 11:15.

## Step 0 — can this snapshot be graded?

**NOT ANSWERED.** `experts.afterquery.com` has returned 429 (Vercel Security
Checkpoint) to every request since 11:04, unauthenticated curl included, so it
is IP level rather than token level; three sessions share this box. Without it
there is no `envs` / `env-log`, so nothing yet proves the platform image
installs `node_modules`.

It matters more here than usual: `yaml` is a real runtime dependency and the
package is 1.4 MB on disk, over the 900 KB bundle cap, so it cannot be
vendored if the image lacks it. The repo's own Dockerfile is `node:24-bookworm`
plus `npm ci`, `npm run typecheck`, `npm test`, which is a working recipe for
the generator to have copied, but that is not proof.

## The gap

`HabitatRecord.capacity` is parsed at `decode.ts:120-145`, carried on the
compiled model, and read by nothing. crystal-tundra authors four capacity
numbers that change no result. The repo reserves the idea itself:
`packages/biomeweaver/src/baseline-guard.test.ts` fails if any of eight phrases
appears under `packages/`, one of them the textbook name for this feature, so
the words stay out of the tree.

## What the feature is

Seats for one species in one region add up over every habitat attached to the
region, scaled per season by a `<species>-capacity` modifier. Occupancy is the
headcount across stages weighted by a new `space` entry per stage on the
species. Held at step 10 of `docs/tick-phases.md`, after stages advance, so
young born this tick and cohorts just promoted count. Past the seats the
surplus comes off in proportion to the room each cohort fills, leftovers by
cohort key order; condition of what keeps its seat is divided by pressure.
Removals write `habitat-crowding` population flows, drops write
`condition-change` flows, the region raises an alert, and
`biomeweaver pressure` reports seats and pressure.

Difficulty is in the interaction, not the surface. Four decisions cannot be
checked against either shipped biome, which never crowds:

1. seats **add** across the habitats of a region, where the only precedent in
   the tree, `habitatModifier`, is last-wins;
2. the surplus is shared on **room filled**, not headcount, so a stage weighted
   at half a seat gives up twice the individuals per seat recovered, and the
   leftover unit goes by `cohortKey` order;
3. crowding sits **after** reproduction and stage advance, so a juvenile
   promoted this tick is counted at an adult's space;
4. condition is **divided by pressure**, which later feeds
   `requiresConditionAtLeast` and the deficit-mortality branch, so a build that
   only culls diverges some ticks later rather than at once.

## Numbers

| | |
| --- | --- |
| solution.patch | 679 added, 7 removed, 20 files (churn 686) |
| test.patch | 663 added, 2 files |
| band | held-out in [638, 686) and under 679: 663 sits inside |
| f2p | 27 |
| p2p | 184 |
| instruction | 289 words, 9.3 articles/100, no em dashes, correct trailer |
| solution lines per instruction word | 2.35 |

## Verified locally

- `npm test` green with the feature: 184/184.
- 27 held-out cases fail at the base tree and pass with the feature, under
  vitest and again under the verifier harness.
- All 184 base cases pass under the verifier harness, which drives the
  TypeScript straight from source with no `dist/` and no vitest.
- Crowding arithmetic checked against an independent Python model of the
  fixed-point policy, not against the reference: 90 adults and 40 juveniles at
  half a seat in a region seated at 100 leave 81.818181 and 36.363638 filling
  100 exactly, condition 0.909091.

## Harness

Copied from `result/sheave-bd4f/tasks/rope-bounce`, which passed all eight
stages, with three changes:

1. `hooks.mjs` gains the workspace alias table from `vitest.shared.ts`, so
   `@biomeweaver/*` resolves to `packages/*/src/index.ts` rather than to
   `dist/`. Nothing has to build the repository, and no build script of the
   submission's runs.
2. `shim.mjs` gains `it.each`. Fourteen base cases use it; without it they
   would never be collected.
3. `test.sh` pins `yaml` by copying it out of `/app/node_modules` after the
   tracked-node_modules sweep and anchoring resolution there.

## Left to do, all platform side

Pull the draft, take the frozen frame, `task.toml`, `grader.py` and both
Dockerfiles, generate `test.sh` with `make_test_sh.py`, collect ids into
`config.json`, run the container verification, the mutation battery and the
attack matrix, then push.
