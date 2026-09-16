# sagemark — Sagemark, a local-first campaign manager (Vue 3 + TypeScript + vitest)

Snapshot: `snapshot.borrower-v2-g1787592253118509.zip`, unpacked 2026-09-06 into
`repo/`. Seat: dragan (`auth-dragan.json`). Tree name is session unique: three
sessions were writing into the unsuffixed `result/sagemark` between 16:33 and
16:42, so this one was rebuilt from the zip.

Repo id: **BaWX5OzTFQ77YYpY2WQf**, base commit
`00800e20bf11764d07d33a49ffd1f1798ed699ed`, environment v1 published
2026-08-26, image `gold-repo-sagemark-bawx5o:v1`. Draft
`yWFWqQAR9fklxVd8soyF`.

## Shape

Vue 3.4 + Pinia + Tailwind + vitest 1.6 with happy-dom. 471 files, 416 npm
packages, 14,644 lines of TypeScript outside the specs. Specs sit beside the
source, 218 of them.

```
src/core/       types, models, services, persistence, rules, generators, dice
src/features/   one folder per area, store + components + pages
src/ui/         primitives and the app shell
```

Base suite locally: `npm ci` 3 s, `npx vitest run` **218 files / 1888 tests, all
pass** (150 s, node 24.7, no `--pool=forks` needed on this tree).

## Step 0 — green, and this image runs the suite at build time

`env-log BaWX5OzTFQ77YYpY2WQf 1` is ten steps, build context 2.934 MB:
`FROM node:24-bookworm-slim`, git, `COPY repo/ /app`, `WORKDIR`, `ENV`,
ca-certificates and git, `WORKDIR`, **`RUN npm ci`**, **`RUN npx vitest run
--reporter=dot`**, git config. So node_modules is baked in and vitest itself
works inside the verifier. Nothing like the account-updater trap here.

The verifier uses the offline harness anyway: nothing a submission commits under
`/app` can then stand in for the framework that decides what a case reports,
which is what netpen's round-4 quality failure was about.

`src/core/models/` imports zod in all 23 files, `src/core/time/timestamps.ts`
imports date-fns and `src/core/ids/generate.ts` imports nanoid, so a
no-`node_modules` image cannot reach models, services or persistence. What it
can reach is everything this task needs: `core/rules`, `core/lib`, `core/dice`
and `core/generators` import nothing but `vitest` and each other.

Measured with the netpen harness (node `--experimental-transform-types`, a
resolve hook for `@/`, `@core/`, `@features/`, `@ui/`, and the vitest stand-in),
against a copy of `src/` with **no `node_modules` present at all**:

| | files | ids |
| --- | --- | --- |
| `npx vitest run` on the same 20 spec files | 20 | 248 |
| the offline harness | 20 | 248, 247 pass |

The two id sets are **identical** once the separator is normalised. The single
failure is `weather.spec.ts > rollWeather > changes when the seed changes`,
which rolls two weathers, `void`s both and asserts nothing; the harness fails a
case that asserted nothing, so that id is simply not declared.

Shim work this repo needed on top of netpen's: `toMatch`, `toBeInstanceOf`, and
`it.each` / `describe.each` with vitest's own `%s` title filling.

Dropped from the graded pool and why: `keyboard.spec.ts` (`vi` and
`KeyboardEvent`), `ids/brand.spec.ts` (`expectTypeOf`), `persistence/*.spec.ts`
(`beforeEach`, and `LocalStorageStore` wants a DOM). 247 p2p ids is five times
the floor of 50 without them.

## Slate

Four sessions, four slots, all disjoint, recorded in `../sagemark-SLATE.md`:
bundle-restore (c3b3), journey-legs (d8c3), rest-recovery (cdde) and this one.

| task | category | files claimed | state |
| --- | --- | --- | --- |
| adventuring-day-plan | feature_request | `src/core/rules/{day-slate,party-progress,day-budget,day-plan}.ts` + mirroring specs, all new | round 1 failed Calibration II 8/8; **round 2 built and verified 2026-09-07**, waiting on the user to push and submit |

## The gap

`encounter-difficulty.ts` rates one encounter against a party frozen at one
level, and `DifficultyCalculator.vue` is its only caller. `leveling.ts` awards
XP, splits it and reads a level off a total; `splitXp` has no caller anywhere in
the tree. Nothing joins the two: there is no day, no allowance spent across a
run of fights, and no order in which the fights are taken.

Order is where the difficulty lives. An award made mid day can lift the party a
level, which lifts `partyThresholds`, which changes what the fights after it are
rated — so a fight that is deadly first thing is merely hard after two easy
ones. The same monsters are also read three ways by three different consumers,
and all three readings are already in the repo:

| who is asking | which figure |
| --- | --- |
| the award, split over the party by `splitXp` | `rawXp` |
| the difficulty rating against the thresholds | `effectiveXp`, raw times the group multiplier, rounded |
| the day's allowance | the same `effectiveXp`, spent out of a shared pool |

`groupMultiplier` bumps a party of two or fewer up a tier and knocks a party of
six or more down one, `assessEncounter` drops any monster worth nothing before
it counts them, `clampLevel` floors the party's average level, and `splitXp`
floors the per-character share and hands the remainder back. Every one of those
is a corner a build that reimplements the arithmetic gets wrong.

## adventuring-day-plan, round 1

Solution +1057 over 8 files (four new modules under `src/core/rules/` and their
mirroring specs). Held out 1196 lines over two files:
`tests/checks/day-that-holds.spec.ts` (84 f2p) and
`tests/checks/table-arithmetic.spec.ts` (44 p2p over the shipped tables).
Graded p2p is 291: those 44 plus 247 restored from the twenty dependency-free
core spec files. Instruction 280 words, 3.77 solution lines per word.

Design, fixtures, the twenty-mutation battery and the attack matrix are in
`tasks/adventuring-day-plan/DESIGN.md`. Every expectation was cross-checked
against an independent Python reading of the rules over 800 random scenarios
before a literal went into a test.

Local matrix, eight cases, all as intended:

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/84 | 291/291 |
| oracle | 1 | 84/84 | 291/291 |
| alt-shape | 1 | 84/84 | 291/291 |
| edit-base-test | 0 | 0/84 | 286/291 |
| forge-report | 0 | 0/84 | 291/291 |
| harness-forge | 0 | 10/84 | 291/291 |
| kill-runner | 0 | 0/84 | 291/291 |
| plant-held-out | 0 | 10/84 | 291/291 |

Submitted 1 of 3. One advisory ciChecks warning stands: the solution patch is
1057 lines, above the typical range, which is four new modules and their
mirroring specs and no vendored or generated content.

## Round 1 verdict: Calibration II, too_easy at 8 of 8

Seven stages passed. ciChecks, aiCheck, similarity, reference verification,
quality review and Calibration I all cleared; Calibration II solved it eight
times out of eight, in nine to seventeen minutes a trial.

The platform API was rate limited (`429`, Vercel Security Checkpoint) from
21:53 on, so the trial patches could not be pulled. The verdict does not need
them: eight of eight at full marks is not an unstated rule, it is a task that
had become a specification. Every repository-resident subtlety the design
leaned on — `clampLevel` flooring the mean, `assessEncounter` dropping monsters
worth nothing, `groupMultiplier` shifting on party size — is one a build gets
right for free by calling the function the instruction names.

## Round 2, built 2026-09-07

The abstract wear ladder is gone. In its place: **whoever
`hasDisadvantageOnAttacks` picks out sits the day out**, and a fight rated
medium or harder tires everybody who was in it by a step through
`bumpExhaustion`, which puts a character out at the third. The party is
therefore not the roster, it thins as the day goes on, and its head count and
mean level feed `partyThresholds`, `groupMultiplier`, `splitXp` and the
tiring in four different directions at once. The predicate is also not the one
intuition reaches for: `poisoned` and `prone` sit a character out, `unconscious`
and `stunned` do not, because those belong to `isIncapacitated`.

Solution +1172 over 8 files, held out 1480 over two files
(`tests/checks/day-that-holds.spec.ts`, 110 f2p, and
`tests/checks/table-arithmetic.spec.ts`, 56 p2p over the shipped tables and
`conditions.ts`). Graded p2p is 303. Instruction 297 words, 3.95 solution lines
per word. Full repository suite 222 files / 1953 tests green;
`vue-tsc --noEmit` unchanged at the base tree's own 26 errors.

Twenty-nine mutations, every one caught, weakest losing two of 110. Details,
fixtures and the reasoning are in `tasks/adventuring-day-plan/DESIGN.md`.

Local matrix, eight cases, all as intended:

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/110 | 303/303 |
| oracle | 1 | 110/110 | 303/303 |
| alt-shape | 1 | 110/110 | 303/303 |
| edit-base-test | 0 | 0/110 | 298/303 |
| forge-report | 0 | 0/110 | 303/303 |
| harness-forge | 0 | 12/110 | 303/303 |
| kill-runner | 0 | 0/110 | 303/303 |
| plant-held-out | 0 | 12/110 | 303/303 |

## Round 3, 2026-09-07

Round 2 was pushed and submitted and failed Calibration II the other way:
0 of 8 solved, below the band, every trial completing normally. The cause was
in the instruction, not the design. "Whoever `hasDisadvantageOnAttacks` picks
out sits the day out" describes a party settled at dawn, and the reference asks
the question again before every fight, because a medium fight tires everybody
in it and the third step of exhaustion is itself a disadvantage on attacks. A
build that did what the sentence said lost fifteen of the 110 cases on that
alone.

Diagnosed without the trial reports, which were unreachable behind the
platform's Vercel checkpoint all evening. A second implementation written from
the instruction alone, with a knob per readable-two-ways sentence, was swept
against the graded suite one knob at a time; the table is in DESIGN.md. Eleven
of the fourteen divergences are stated outright and were left alone. Three were
not, and those three sentences were rewritten.

**Only `instruction.md` changed.** `solution.patch`, `test.patch`,
`config.json` and `test.sh` are byte-identical to what round 2 pushed, so the
matrix above still stands. Full suite re-run green at 222 files / 1953 tests,
`gold_bot check` reports no local problems, instruction 297 words.

Not pushed and not submitted: the user takes both from here. One of three
submissions remains.
