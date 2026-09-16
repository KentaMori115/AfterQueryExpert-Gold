# netpen — marine salmon grow-out operations (Vue 3 + TypeScript + vitest)

Snapshot: `snapshot.borrower-v2-g1787849620351400.zip` (unpacked 2026-09-04 into `repo/`).
Repo id: **7YJ2UEmYfhls634lTF9B** (platform name `netpen`, language typescript,
headSha = baseSha `adc3a0734ce10ab43f410df405566ab3b665b6c8`). Environment v1,
published 2026-09-02.

## Shape

Vue 3.5 + vite + vitest 2.1 + jsdom, 524 npm packages. 107 source files, 82 test
files. Layering enforced by `tests/architecture.test.ts`:

```
src/domain/   biology and regulation. no framework, no clock, no third-party import
src/data/     api port, local + http implementations, projections, fixtures
src/app/      clock, config, router, queries, connection, stores
src/ui/       presentation primitives and charts
src/views/    screens
```

Base suite locally: `npm ci` 5s, `npx vitest run` **82 files / 1259 tests, all pass**
(31.6s). Domain-only subset `tests/domain tests/lib`: **24 files / 477 tests**, and
those import nothing but `vitest` and `@/domain/*` — the dependency-free surface a
no-node_modules verifier can grade (webdevium machinery applies).

Architecture rules that bite any new domain module:
- must open with a `/** */` block comment;
- must have a mirroring `tests/domain/<same path>.test.ts`;
- may not import anything bare or from app/data/ui, may not read the clock.

## Step 0 — green, and this image installs its dependencies

`env-log 7YJ2UEmYfhls634lTF9B 1` is seven steps: `FROM node:24-bookworm-slim`,
install git, `COPY repo/ /app`, two `WORKDIR`, **`RUN npm ci`** (478 packages,
install scripts skipped), git config. Build context 1.958 MB.

Rebuilt locally from those exact lines and run with `--network none`:
`npx vitest run` gives **82 files / 1259 tests, all pass**. So the real runner
works in the image.

The verifier still does not use it. The graded surface is dependency-free, so
the webdevium machinery (node `--experimental-transform-types`, a resolve hook
for `@/` and `@tests/`, a ~200 line vitest stand-in) drives the suites straight
from source: nothing a submission commits under /app can stand in for the
framework that decides what a case reports. Measured in the image, offline:
**508 of 508** base ids pass (23 domain suites + `tests/lib/random.test.ts` +
`tests/architecture.test.ts` + the held-out p2p file).

## Slate

| task | category | files claimed | state |
| --- | --- | --- | --- |
| harvest-schedule | feature_request | `src/domain/harvest/{forecast,eligibility,capacity,schedule}.ts` | built + verified + **PUSHED 2026-09-04** to draft `LppBbEGXGrYJ0OAbr94G` |

## Gap picked

`src/domain/biomass/standing.ts` already gives `weekOfBreach` and
`harvestRequiredT` and says in its own comment that "the whole harvest plan is
built backwards from this number" — and there is no planner anywhere in the
tree. `harvest/grading.ts` values a pen, `growth/tgc.ts` projects it,
`health/treatment.ts` says when a medicine clears in degree-days,
`time/degreeDays.ts` accumulates the forecast. Nothing joins them up.

## harvest-schedule, round 1

`planHarvest(request)` books whole pens onto weekly boat slots as late as the
licence allows. Difficulty is the interaction: a pen pushed off its latest week
by boat tonnage lands earlier and lighter, which frees the week after for a
lighter pen, and the withdrawal clock that decides whether it may go at all is
counted in degree-days off the same forecast that grows it.

Solution +613 non-test lines over 4 files (`forecast`, `capacity`,
`eligibility`, `schedule`), plus 424 lines of mirroring tests the repo's own
`tests/architecture.test.ts` demands of any new domain module. Held out 607
lines over 2 files: `tests/checks/lift-window.test.ts` (40 f2p) and
`tests/checks/ceiling-arithmetic.test.ts` (17 p2p over existing arithmetic).
Instruction 295 words. Band on non-test churn: 0.93 x 613 = 570.1 <= 607 < 613.

Every expectation was cross-checked against an independent Python
reimplementation written from `instruction.md` alone; all 20 scenarios agreed
to 1e-9 before a single literal went into a test.

`verify_task.sh` rows, all as intended:

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/40 | 508/508 |
| oracle | 1 | 40/40 | 508/508 |
| alt-shape (independent single-file class build) | 1 | 40/40 | 508/508 |
| edit-base-test (`densityStatus` loosened, base suite rewritten) | 0 | 40/40 | 507/508 |
| forge-report (patches `process.stdout.write`, emits fake verdicts) | 0 | 0/40 | 508/508 |
| kill-runner (`process.exit(0)` at import) | 0 | 0/40 | 508/508 |
| plant-held-out (commits its own `tests/checks/*`) | 0 | 2/40 | 508/508 |

**The local matrix lies unless test.sh's BASE_SHA is rewritten.** The local env
image commits its own tree, so the platform sha in `test.sh` does not exist
there and `git checkout $BASE_SHA -- <suite>` is a silent no-op: the first run
of edit-base-test scored 508/508 because the *tampered* base suite ran.
`verify_task.sh` now seds the local sha into its copy of `test.sh`, and the row
reads 507/508.

## Rounds 1-3 (submitted), and the round-4 rebuild in flight

| round | verdict |
| --- | --- |
| 1 | ciChecks/aiCheck/similarity/oracleNop/qualityCheck **passed**, Calibration I **too_easy 5/5** |
| 2 | Calibration never reached: qualityCheck **failed** (skipped "by number" vs penId; equality boundary only tested on a base helper) |
| 3 | qualityCheck **passed**, Calibration I **too_easy 4 of 5** (the one failure missed weeklyBiomassT[0]) |

**Round 1 diagnosis.** Pulled all five trial patches, rebuilt each on the base
tree, ran them and the reference over 300 random scenarios: **zero
disagreements**. No ambiguity lever existed. The task was easy because the new
module stood alone: every trial wrote one self-contained file of arithmetic and
never opened another file in the repo.

**Round 2/3 lever: make it land inside the existing machinery.** The request
now carries stock event logs and treatment events instead of counts and
weights, so every figure comes from `positionAt` folding the log at each week's
end, the withdrawal comes from the treatment table through `isMedicinal` /
`profileFor`, and a pen whose log fails `validate` is skipped out of the plan
and out of the licence total. A near-miss that hand-rolls the fold with a
`<= end` heat window instead of `< end` fails **29 of 37** graded cases. That
took 5/5 to 4/5, not far enough.

**Round 4 lever (in flight): stop stating an algorithm at all.** The
instruction no longer describes a greedy. It states the feasibility filters and
then an optimum: of the plans that hold every week, fewest pens, then the
latest lifts, then the lower pen numbers. `search()` in schedule.ts walks sets
smallest first. Measured against the round-3 greedy kept at
`scratchpad/greedy`: **39 of 240 random scenarios diverge (16%)**, and the base
fixture itself now diverges (greedy books P1 at week 0, the optimum books P2 at
week 1, because P1 does not fit the week-1 boat and a later lift wins).

### Round 4, built and submitted 2026-09-04

`schedule.ts` rewritten around `search()` + `isBetter()` (fewest pens, latest
lifts, lowest numbers), and its module comment rewritten with it — the old one
still explained the greedy. The instruction states the filters and the optimum,
289 words, and no longer names an algorithm.

Held-out f2p is now **53 cases**, up from 41. The two describes written against
the greedy are gone, replaced by:

| describe | what it pins |
| --- | --- |
| one pen where the obvious pick takes two | P3/P4/P8 at licence 1090 -> P3 alone in week 1, where the greedy books P3 w0 + P8 w1; at 1050 the same pen a week earlier |
| a horizon long enough to need two boats | 18 weekly slots -> P2 w1 and P4 w9, where the greedy books P1 w0 + P2 w2 |
| a withdrawal that clears on the day | two identical pens, teflubenzuron 13 days back (100 dd, held) against 14 days back (105 dd exactly, clear) |
| a pen weighed at the contract floor | no heat at all, so the ledger hands back 5000 g to the gram: level with minHarvestWeightG goes, a gram above finds nobody |

The last two came out of the mutation sweep, not out of the design. Three
boundaries were live in the round-4 build and pinned by nothing: `>=` against
minHarvestWeightG, `<` against the week end when counting a withdrawal's heat,
and whether a skipped pen's biomass stays out of the licence total. All three
now fail a case.

**Mutation sweep against the 53.** Every one caught:

| mutation | cases lost |
| --- | --- |
| licence `>=` instead of `>` | 2 |
| withdrawal cleared on `< 0` instead of `<= 0` remaining | 1 |
| weight `>` instead of `>=` | 2 |
| heat window `<= end` instead of `< end` | 1 |
| skipped pens counted in weeklyBiomassT | 3 |
| skipped pens not filtered at all | 3 |
| skipped as pen numbers, not penIds | 3 |
| skipped unsorted | 1 |
| boat slot strict instead of equality | 13 |
| earliest lifts instead of latest | 19 |
| higher pen numbers instead of lower | 7 |
| most pens instead of fewest | 27 |
| lifted pen gone in its own week | 22 |

**Rival builds against the 53.** The round-3 greedy loses **20**; the
hand-rolled ledger fold loses **39**. The alt-shape build — one file, one
class, weeks as instants, plans ranked by a sort key rather than a pairwise
comparison — passes all 53 and all 29 held-out p2p, so the suite pins the
answer and not the arrangement.

**Local matrix, seven cases:**

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/53 | 520/520 |
| oracle | 1 | 53/53 | 520/520 |
| alt-shape | 1 | 53/53 | 520/520 |
| edit-base-test | 0 | 33/53 | 519/520 |
| forge-report | 0 | 0/53 | 520/520 |
| kill-runner | 0 | 0/53 | 520/520 |
| plant-held-out | 0 | 3/53 | 520/520 |

Floors: solution +1084 over 8 files, held-out +857 over 2, instruction 289
words, 3.75 lines per word, 53 f2p, 520 p2p. Pushed and submitted.

## Round 4 verdict, and the round-5 harness rebuild

Round 4 cleared ciChecks, aiCheck, similarity and reference verification, then
**qualityCheck failed** on two findings that are one defect:

> anti_cheating_measures — the custom runner imports submission-controlled
> modules in its own Node process before collection and then calls uncaptured
> mutable methods such as `suites.slice()`. Submitted code can read the hidden
> files under /app/tests and monkeypatch prototypes to replace the collected
> cases with no-op cases bearing the discovered names.

> report_integrity — although absent and duplicate results are safely failed by
> the publisher, verdict generation itself is not isolated from repository code.

Fair. The publisher was sound; the runner was not. Three changes:

1. **Nothing mutable leaves the shim.** `export const suites` is gone. The
   control surface — open, drain, arm, counted — is handed to the **first**
   caller and withdrawn, so a module that finds `/verify/shim.mjs` on disk and
   imports it gets `null`. `run.mjs` claims it in its own module body, before
   any dynamic import exists.
2. **No prototype dispatch anywhere in the harness.** Both files capture what
   they need at load — `Reflect.apply`, `Array.prototype.push/pop/join/slice`,
   `String.prototype.includes`, `RegExp.prototype.test`, `Object.hasOwnProperty`
   — and call through `apply`. `suites.slice()` is gone: `drain()` hands the
   array over and the shim drops it. The runner walks it by index, and refuses
   a case whose body is not a function.
3. **A case that asserts nothing fails.** Every matcher counts itself; the
   runner arms the counter before a case and fails it at zero. That is the
   named attack — a no-op body under a real title — closed at the point it
   would have paid off.

Also: `register.mjs` now hands the resolver its two paths through `register`'s
`data`, so `run.mjs` can delete `HARNESS_APP`, `HARNESS_SHIM` and
`HARNESS_HOOKS` before loading anything from /app.

**New attack, `harness-forge.patch`**: a submission that rewrites
`Array.prototype.slice`, `push` and `concat` to empty every case body it can
reach, and imports `/verify/shim.mjs` to claim the control surface. It scores
**0 — 3 of 53 f2p, 518 of 520 p2p**, and the run log carries one
`the case asserted nothing`. The old `kill-runner` keyed on `HARNESS_APP` being
set, which the env deletion now defeats for the wrong reason, so it exits
unconditionally instead and is back to 0 verdicts.

One held-out case asserted only inside a loop over `weeklyBiomassT`; an empty
result would have made it assert nothing and fail on the guard rather than on
its own terms. It now checks the length first.

**Local matrix, eight cases:**

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/53 | 520/520 |
| oracle | 1 | 53/53 | 520/520 |
| alt-shape | 1 | 53/53 | 520/520 |
| edit-base-test | 0 | 33/53 | 519/520 |
| forge-report | 0 | 0/53 | 520/520 |
| harness-forge | 0 | 3/53 | 518/520 |
| kill-runner | 0 | 0/53 | 520/520 |
| plant-held-out | 0 | 3/53 | 520/520 |

Pushed and submitted 2026-09-04.

## Round 5 verdict, and the round-6 unit collision

Round 5 passed quality review — the harness rebuild answered both findings —
and then failed Calibration I at **3 of 5 solved**, up from 1 of 5 and 2 of 5
in the earlier rounds but still over the bar.

**The diagnosis is in the trial patches, and it is unambiguous.** Three trials
scored 61 of 61. Pulling `ozDTADC`'s `schedule.ts` shows why: it is a clean,
complete transcription of the instruction, right down to quoting the sentence
about the heat window back in its own doc comment, and it touches exactly two
files. Nothing was derived. The task had become a specification, and a careful
reader can implement a specification.

More cases of the same rules would not have moved that. What moves it is a rule
the agent has to go into the repository to resolve.

**Round 6: the same pen is three different figures.** `guttedYield(k)` already
lives in `src/domain/growth/condition.ts` — 0.86 at a condition factor of 1.2,
half a point of yield for every tenth above it, clamped either side. The task
now turns on it:

| who is asking | which figure |
| --- | --- |
| the licence, and `weeklyBiomassT` | live tonnes |
| the boat, against `weeklyCapacityT` | gutted tonnes |
| the contract, against `minHarvestWeightG` | gutted mean weight |

A booking carries both, `tonnes` live and `guttedT` gutted. Pens now arrive
with a `conditionFactor`, and the fixtures spread it: P1 at 1.20 (yield exactly
0.86), P2 at 1.35, P3 at 1.05, P4 at 1.55, the small pen at 0.90.

That is not one more thing to transcribe. It is the same quantity read three
ways in three different places, and the instruction names the collision without
restating the formula, so the yield has to be found in the repository.

**What it costs a build that gets it wrong:**

| mutation | cases lost of 61 |
| --- | --- |
| a flat 0.86 yield instead of the pen's condition | 9 |
| the boat reading live tonnes | 24 |
| the contract reading live weight | 7 |
| the licence counting gutted | 50 |
| `tonnes` and `guttedT` the wrong way round | 16 |

The whole earlier battery still bites — licence `>=`, withdrawal cleared on
`< 0`, weight `>`, heat window `<= end`, skipped biomass counted, skipped as
numbers, skipped unsorted, earliest lifts, higher pen numbers, most pens,
lifted pen gone in its own week, boat slot strict — seventeen mutations, every
one caught.

Two describes carry the collision directly. **what the boat lands**: a 700 t
slot takes pen one, which stands at 706.09 t live and lands 607.24 t, so a
build measuring the slot in live tonnes refuses it and books the wrong pen; the
slot set to 607.2365382088694 takes it and a hundredth under does not.
**the weight a contract reads**: pen two carries a live mean of 4184.66 g and
grades out at 3567.12, so it goes against a 3500 g floor, and against 3600 g
there is no plan at all — while a live-weight build books it at 3600 and even
at 4100.

The suite is **61 f2p**, up from 53. The alt-shape build — one file, one class,
weeks as instants, plans ranked by a sort key — was rewritten for the same
rules and passes all 61 and all 29 held-out p2p.

**Local matrix, eight cases:**

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/61 | 520/520 |
| oracle | 1 | 61/61 | 520/520 |
| alt-shape | 1 | 61/61 | 520/520 |
| edit-base-test | 0 | 24/61 | 519/520 |
| forge-report | 0 | 0/61 | 520/520 |
| harness-forge | 0 | 3/61 | 518/520 |
| kill-runner | 0 | 0/61 | 520/520 |
| plant-held-out | 0 | 3/61 | 520/520 |

Instruction 297 words of the 300 allowed, 3.78 solution lines per word. Pushed
and submitted 2026-09-04.

## Round 6 verdict, and the round-7 shared week

Round 6 cleared seven of the eight stages. **Calibration I passed at 1 of 5**
and **Calibration II passed at 0 of 8** — the gutted-figure collision did what
it was built to do. The run audit then failed on `failure_legitimacy`, and it
was right.

**The diagnosis, from the Cal I reports.** Three of the four unsuccessful
trials scored exactly **55 of 61**, and the three sets of failing ids were the
same six. Their verifier logs say why:

    expected 3691.520366306464 close to 4330.2292
    expected [{"penId":"PA",...,"meanWeightG":4300}] to ...

They had reported `meanWeightG` **gutted**. Nothing in the instruction said
which of `tonnes`, `guttedT` and `meanWeightG` was live — the sentence that
would have said it was the one I trimmed to stay under the word cap. Those
trials were not failing the task, they were failing an unstated contract, and
the audit exists to catch exactly that.

The sixth shared id was my own fault too: a slot set to
`607.2365382088694`, the reference's gutted figure to the last bit. A build
that computes the same quantity as `guttedWeightG * count / 1e6` instead of
`(biomassKg / 1000) * yield` lands one ulp away and the pen no longer fits.
An equality boundary has to be exact in **any** implementation, which was the
lesson from round 3 and which I had reintroduced.

**Both are fixed, and neither fix could stand alone.** Stating the units would
have handed those three trials the six ids they lost — 4 of 5 solved, and back
to too_easy. So round 7 states them and takes a simplification away.

**The boat's week is shared.** A well boat comes once a week and takes as many
pens as land inside its figure, so `weeklyCapacityT[w]` is now a budget for the
week rather than a gate on one pen. `capacity.ts` was rebuilt around it —
`WeekSlot.penIds` instead of one `penId`, `remainingT`, `fits` counting what is
already booked — and capacity moved from a per-pen filter to a whole-set check
in `search`, because a pair that each fit alone may not fit together.

That broke the tie-break, and the break was the same class of defect the audit
had just flagged. With a shared week, two plans can lift the same pens in the
same weeks and differ only over which pen got the later one; the old comparison
sorted weeks and pen numbers into two separate lists and rated them equal. The
ordering is now total: lifts are read as pairs, latest week first and the lower
pen number ahead within a week, and the instruction says so.

**The exact boundaries moved onto exact arithmetic.** The shared-week fixture
has no temperature record at all, so every figure is an integer: two pens at
300 t and 250 t landing 258 t and 215 t, a slot of exactly 473 taking both, a
hundredth under splitting them, and week zero at 214 taking neither. Same for
the boat equality, now 430 against 429.99 on the flat fixture.

**Twenty-one mutations, every one caught:**

| mutation | cases lost of 68 |
| --- | --- |
| one pen a week | 4 |
| capacity checked per pen, not per week | the suite will not load |
| pen numbers rated apart from their weeks | 3 |
| the higher pen number keeps the later week | 17 |
| a flat 0.86 yield | 9 |
| the boat reading live tonnes | 25 |
| the contract reading live weight | 7 |
| the licence counting gutted | 53 |
| `tonnes` and `guttedT` swapped | 19 |
| `meanWeightG` reported gutted | 8 |
| licence `>=`, withdrawal `< 0`, weight `>`, heat `<= end` | 8, 1, 10, 1 |
| skipped as numbers, unsorted, counted in biomass | 4, 1, 4 |
| earliest lifts, most pens, lifted pen gone in its week | 24, 37, 36 |
| boat slot strict | 3 |

The suite is **68 f2p**, and the alt-shape build — rewritten again, now with a
shared-week capacity check and the paired ranking key — passes all 68 and all
29 held-out p2p.

**Local matrix, eight cases:**

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/68 | 520/520 |
| oracle | 1 | 68/68 | 520/520 |
| alt-shape | 1 | 68/68 | 520/520 |
| edit-base-test | 0 | 25/68 | 519/520 |
| forge-report | 0 | 0/68 | 520/520 |
| harness-forge | 0 | 3/68 | 518/520 |
| kill-runner | 0 | 0/68 | 520/520 |
| plant-held-out | 0 | 3/68 | 520/520 |

Instruction 298 words, 4.00 solution lines per word. Pushed and submitted
2026-09-04.

## Round 7 verdict, and the round-8 widening

Round 7: quality passed, **Calibration I passed at 0 of 5**, and Calibration II
failed **too_easy at 7 of 8**.

**A correction to the round-6 entry above.** The "0 of 8" I recorded for
round 6's Calibration II was a mid-run snapshot. Its `probe/result.json` shows
the finished figure: **7 of 8 solved, seven of them at 61 of 61**. Round 6
failed at the run audit before Calibration II's verdict was read, which is why
it showed as passed. So the stronger band has solved this task 7 times in 8 in
both rounds; nothing regressed between them.

That also settles what the two probes are measuring here. Calibration I's five
trials score 19, 19, 28, 29 and 35 of 86 — genuinely failing, and scattered,
with no shared id to suggest an unstated rule. Calibration II's seven winners
score full marks. The task sits between the bands, and the gap to close is one
trial.

**Round 8 widens the graded corners rather than adding a rule.** No instruction
change: the same 298 words. Twenty-six new cases on fixtures with no
temperature record, so every figure is an integer and no equality is at the
mercy of an implementation's floating point:

| describe | what it pins |
| --- | --- |
| weeks the boat cannot come | a zero-capacity week pulling both lifts forward and emptying the site for a week; a horizon where only one week has a boat; a boat too small for any pair; a one-week horizon, where 1 t over is as much a breach as 50 |
| three pens on one boat | three pens landing 258, 215 and 172 t into one slot; 645 exactly holds them, a hundredth under drops the highest number to the week before |
| which two of three go | three pens alike but for their grid numbers with a fourth arriving in week two: the two lowest numbers go, 688 t holds them both, and at 687.99 pen three keeps the later week |
| a site with nothing to plan | no pens at all; nobody grading big enough to lift |

**What the widening bought**, measured on the same mutations:

| mutation | round 7, of 68 | round 8, of 86 |
| --- | --- | --- |
| the boat's week not shared | 4 | 9 |
| one pen a week | 4 | 14 |
| pen numbers rated apart from their weeks | 3 | 11 |
| the higher number keeps the later week | 17 | 28 |
| the boat reading live tonnes | 25 | 29 |
| boat slot strict | 3 | 7 |
| earliest lifts | 24 | 33 |
| most pens | 37 | 46 |

**Local matrix, eight cases:**

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/86 | 520/520 |
| oracle | 1 | 86/86 | 520/520 |
| alt-shape | 1 | 86/86 | 520/520 |
| edit-base-test | 0 | 29/86 | 519/520 |
| forge-report | 0 | 0/86 | 520/520 |
| harness-forge | 0 | 3/86 | 518/520 |
| kill-runner | 0 | 0/86 | 520/520 |
| plant-held-out | 0 | 4/86 | 520/520 |

86 f2p / 520 p2p, instruction 298 words, 4.00 solution lines per word. Pushed
and submitted 2026-09-04.

## Round 8: all eight stages passed

    ciChecks           Automated checks         passed
    aiCheck            AI check                 passed
    similarity         Originality              passed
    oracleNop          Reference verification   passed
    qualityCheck       Quality review           passed / pass
    easinessProbe      Calibration I            passed / pass   0 of 5 solved
    difficultyProbe    Calibration II           passed
    failureValidation  Run audit                passed / pass
    == terminal: Needs Review ==

Draft `LppBbEGXGrYJ0OAbr94G` is through the pipeline and in the human review
queue. **Do not push to it again.**

Two advisory ciChecks warnings stand and are not blocking: the solution patch is
1191 lines (four files of new domain code and four of mirroring tests, no
vendored or generated content), and the instruction is 298 words against an
advisory aim of 250 — every word of it states a rule the graded suite checks,
and the two rounds that trimmed rules for brevity are the two that failed on
`failure_legitimacy` and `too_easy`.

### What the eight rounds cost, and what each one taught

| round | verdict | what it meant |
| --- | --- | --- |
| 1 | Cal I too_easy 5/5 | a new module standing alone: every trial wrote self-contained arithmetic and never opened another file |
| 2 | qualityCheck failed | skipped named by number in prose and by penId in the tests; an equality boundary tested only on a base helper |
| 3 | Cal I too_easy 4/5 | the ledger and treatment machinery helped, but the instruction still stated a greedy |
| 4 | qualityCheck failed | the verifier, not the task: exported `suites`, `suites.slice()` after repository code had loaded |
| 5 | Cal I too_easy 3/5 | three trials transcribed the instruction, one quoting a sentence of it back in its own doc comment |
| 6 | run audit failed | `meanWeightG` never stated live or gutted; three trials lost the same six ids to it |
| 7 | Cal II too_easy 7/8 | stating the units removed the accidental difficulty; the shared week alone did not replace it |
| 8 | **passed** | the same rules, twenty-six more graded corners |

The through-line: **difficulty that comes from something the instruction failed
to say is not difficulty, it is a defect, and the run audit finds it.** What
survived was difficulty of a different kind — an optimum rather than an
algorithm, one quantity read in three units through a repository function, a
week the boat shares, and a ranking that has to be total. Then enough graded
corners that a strong build has to get every one of them right.

