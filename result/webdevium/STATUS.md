# webdevium — Webdevium Dashboard

Snapshot: `snapshot.borrower-v2-g1788018209932789.zip` (unpacked 2026-09-04 into `repo/`).
Repo id: **sMh8PbgmXAbIvwsDVFHl** (platform name `egor`, language typescript,
headSha = baseSha `710f4235a38468a48b96cff885b1104ee4f9f05a`). Environment v1,
published 2026-09-02.

## Shape

Next.js 15 App Router + TypeScript, Tailwind, Supabase and Stripe clients, vitest 4
with jsdom and testing-library. 161 files, 571 npm packages.

Two graded surfaces:

- `components/interactive/*.test.tsx` — 9 React component suites, 20 tests, need
  jsdom + @testing-library.
- `lib/ops/**` — a dependency-free TypeScript engine tree: billing (money,
  proration, ledger), invoices (fx, builder), jobs (heap, backoff, queue),
  rate-limit (bucket, window, limiter), rbac (types, match, graph, engine),
  routing (digest), schedule (rrule), timeseries (buckets), workflow (machine,
  presets), events (stream, project), merge (clock, document), graph (dag),
  query (lexer, parser), concurrency (etag), capacity (planner). 2622 lines,
  53 tests, no runtime dependency beyond vitest.

Base suite locally: `npm ci` 11s, `npx vitest run` **28 files / 73 tests, all pass**.

## Step 0 — the image has no dependency install, and it does not matter

`env-log sMh8PbgmXAbIvwsDVFHl 1` is seven steps: `FROM node:24-bookworm-slim`,
install git, `COPY repo/ /app`, `WORKDIR`, `ENV NPM_CONFIG_LOGLEVEL`, `WORKDIR`,
git config. Build context 2.039 MB. **No `npm ci`, no `node_modules`**, exactly
the account-updater shape, and `allow_internet = false` on both containers.

It is still gradeable, because the graded surface does not need a package tree:

- `node --experimental-transform-types` runs the repo's TypeScript straight from
  source, parameter properties and all (strip-only mode chokes on
  `workflow/machine.ts`, `events/stream.ts` and `concurrency/etag.ts`; transform
  mode does not).
- a `module.register` resolve hook covers the `@/` alias, extensionless
  specifiers and `.js` specifiers that mean `.ts`.
- the repo's suites import exactly `describe`, `it`, `expect` and eight
  matchers, so a ~200 line stand-in for `vitest` answers the whole surface.

Measured in the real image, offline: **50 of 50 `lib/**` tests pass**, same names
and same count as `npx vitest run` gives locally. The 23 `components/` tests need
jsdom and are out of reach; they are not needed, since 50 clears the p2p floor on
their own.

## Slate

| task | category | files claimed | state |
| --- | --- | --- | --- |
| cycle-settlement | feature_request | `lib/ops/billing/{allowance,credits,money,settlement,tax,usage}.ts`, `lib/ops/invoices/statement.ts` | round 3 PUSHED 2026-09-04 to draft `xZmtd8mhrNwTVqnBS41F` after a qualityCheck fail |
| job-fences | feature_request | `lib/ops/jobs/{fences,queue}.ts`, `docs/JOB-FENCES.md`, `README.md`, `SETUP.md` | built + verified 2026-09-04, waiting on a draft |

## cycle-settlement, round 1

Held out: `checks/close-books.spec.ts` (44 f2p), `checks/ledger-invariants.spec.ts`
(11 p2p over existing billing behaviour). Graded ids: 44 f2p, 63 p2p.
Solution +646 over 7 files, tests +630 over 2, instruction 299 words.
Band: 0.93 x 646 = 600.8 <= 630 < 646.

Verifier: `make_test_sh.py` writes the harness into `tests/test.sh` as heredocs
(nothing but test.sh, test.patch, grader.py and config.json reaches the image).
It restores the 18 shipped suites from the base commit, drops shim/hooks/runner/
publisher into a root-owned `/verify`, runs node as `nobody` through `setpriv`,
and pipes `V <token> <status> <file>\t<name>` into a python3 publisher that
holds the whitelist and fails any id the stream did not carry exactly once.

`verify_task.sh` rows, all as intended:

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/44 | 63/63 |
| oracle | 1 | 44/44 | 63/63 |
| alt-shape (independent single-file build) | 1 | 44/44 | 63/63 |
| edit-base-test (broken proration + rewritten suite) | 0 | 29/44 | 60/63 |
| forge-report (patches fs/stdout/Object.is, emits fake verdicts) | 0 | 0/44 | 63/63 |
| kill-runner (`process.exit(0)` at import) | 0 | 0/44 | 0/63 |
| plant-held-out (agent writes the held-out path) | 0 | 0/44 | 63/63 |


## job-fences, round 1 (not yet pushed — no draft)

Dependency fences for the background job queue. `enqueue` takes `dependsOn`;
a fenced job is never claimable however it ranks and still counts against
`size`; only completing brings a fence down; a dead letter takes everything
behind it with `blocked by <root id>`; `fencePlan()` reports `ready`,
`waiting` (with `blockedBy` and a `wave` count) and `dead`.

The difficulty is interaction rather than surface. Three collisions with what
the queue already does:

- **the rank formula.** `rank = availableAt * 1000 + priority`, so a job
  released at 03:11 sits behind an ordinary job that has been available since
  03:00 however urgent it is. An implementation that keeps the original
  `availableAt`, or that re-ranks on priority, fails four cases.
- **only `complete` releases.** A retry, an expired lease and a heartbeat all
  look like "the job in front moved" from outside and none of them count.
- **`complete` deletes the record.** Dependents have to be answered from a
  memory of how settled jobs finished, not from `byId`.

Held out: `checks/fence-order.spec.ts` (37 f2p), `checks/queue-invariants.spec.ts`
(21 p2p over heap, backoff, queue and clock behaviour that does not change).
Graded ids: 37 f2p, 71 p2p (50 shipped + 21).

Sizes: solution +766/-4 over 5 files, tests +757 over 2, instruction 298 words.
Band: 0.93 x 770 = 716.1 <= 757 < 766. Every floor `gold_bot.py check` reports
is ok.

Work tree: `repo-fences/` (a worktree of `repo/` at the base commit, so the
cycle-settlement tree is untouched). `verify_task.sh` points at it and uses its
own scratch dir.

`verify_task.sh` rows, all as intended:

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/37 | 71/71 |
| oracle | 1 | 37/37 | 71/71 |
| alt-shape (one-file build, Kahn layering, no `fences.ts`) | 1 | 37/37 | 71/71 |
| edit-base-test (release keeps the old `availableAt` + rewritten queue suite) | 0 | 35/37 | 71/71 |
| forge-report (no build; patches fs/stdout/Object.is and emits fake verdicts) | 0 | 0/37 | 71/71 |
| kill-runner (`process.exit(0)` at import) | 0 | 0/37 | 0/71 |
| plant-held-out (agent writes `checks/fence-order.spec.ts` itself) | 0 | 0/37 | 71/71 |

The first forge-report build carried the real implementation, so it scored 1
and proved nothing. Rebuilt without it: the honest score is 0/37 and the
forged stream does not lift it.

## Round 1 verdict, 2026-09-04

Submitted 06:07. ciChecks **passed**, aiCheck **failed**: "The instruction file
appears to be AI-generated." One advisory alongside it, instruction.md at 299
words against an aim of 250.

Cause was voice, not content. The instruction carried about 50 backticks, one
rule per sentence and four paragraphs of the same shape. `panel-record` on
portfire cleared all eight stages at 299 words with four backticks and bare
identifiers, so the length advisory was not the failure.

Round 2, same contract and same graded behaviour:

- instruction rewritten to 291 words, 0 backticks, 3.4 articles per 100 words,
  sentence lengths spread 1 to 23, an indented example object carrying the
  segment field names, identifiers written bare.
- all 57 case titles renamed from rule restatements to scenarios, since the old
  ones echoed instruction sentences almost verbatim. Shared 4-grams between
  `config.json` ids and `instruction.md`: **0**.
- config.json, test.patch and test.sh regenerated, full matrix re-run with the
  same seven rows and the same verdicts.

Pushed 2026-09-04.

## Round 2 verdict, 2026-09-04

ciChecks, aiCheck, originality and reference verification all **passed** — the
rewritten instruction cleared the AI check. **qualityCheck failed** on three
criteria, two of them the same defect seen twice:

- `behavior_in_task_description` — the suite requires no tax entry when credits
  take the bill to zero, and the instruction described tax only as a final
  entry.
- `instruction_self_containedness` — same hole, read from the other side: an
  observable edge behaviour the brief never supplied.
- `behavior_in_tests` — nothing pinned half-even rounding **for tax**. The one
  fractional case, 3437.5, rounds to 3438 under half-even and under
  `Math.round` alike, so a build using `Math.round` passed every case.

Round 3:

- instruction gains "taxCents is taxBps on what is still owed, halves to even
  again, riding last as a tax entry. Nothing owing means nothing to tax, and a
  zero writes no entry." Trimmed elsewhere to stay inside the 300 word cap:
  **296 words**, still 0 backticks.
- one held-out case added, `what tax is charged on > a half cent of tax lands
  on 3436 from above and from below`. A 10 cent balance leaves 34365 owed
  (tax 3436.5, half-even goes **down** to the even neighbour) and a 20 cent
  balance leaves 34355 (tax 3435.5, half-even goes **up** to the same 3436).
  Confirmed as the discriminator by mutating `tax.ts`: with `Math.round` only
  this case fails (1 of 45); with `Math.floor`, this case and the 3438 case
  fail (2 of 45).
- config.json, test.patch and test.sh regenerated. **45 f2p / 63 p2p**,
  tests +651 over 2 files.

`verify_task.sh`, all seven rows unchanged in shape:

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/45 | 63/63 |
| oracle | 1 | 45/45 | 63/63 |
| alt-shape | 1 | 45/45 | 63/63 |
| edit-base-test | 0 | 29/45 | 60/63 |
| forge-report | 0 | 0/45 | 63/63 |
| kill-runner | 0 | 0/45 | 0/63 |
| plant-held-out | 0 | 0/45 | 63/63 |

`gold_bot.py check`: no local problems found. Pushed 2026-09-04; the draft
still shows round 2's terminal verdict until the next submit runs.

## Round 3 verdict, 2026-09-04

Submitted 12:18. **Quality review passed** — the zero-tax sentence and the
half-even tax case closed all three findings. **Calibration I passed at 0 of 5.**
**Calibration II failed, `out_of_band_hard`, 0 of 8** (band is 1-6).

Diagnosed from the per-trial reports, not the stock finding. The spread:

| trials | f2p | what failed |
| --- | --- | --- |
| 1 (`6jj92it`) | 43/45 | `expected 0.66 to be 0.67`, `expected 15.66 to be 15.67` |
| 6 (identical bytes) | 23/45 | every case reading a segment field; statement-level cases all passed |
| 1 (`dszJQqV`) | 0/45 | its own `ERR_MODULE_NOT_FOUND` on `/app/lib/invoices/fx.js`, a path it invented |

p2p was 63/63 in all eight, so nothing was breaking the repo. Two spec holes:

1. **The carry chain.** `spendPeriod` keeps exact floats and `reportSegment`
   rounds only what the page shows, so an idle upgrade cycle carries
   4.33333 + 11.33333 = 15.66667 and prints 15.67. A solver carrying the
   rounded 4.33 prints 15.66. The rule was written in a doc comment in
   `allowance.ts` ("rounding belongs to the statement, not to the running
   total") and nowhere in instruction.md.
2. **A sentence that was false about the repo.** "Periods come off prorateCycle,
   planId and subscriptionCents untouched" — `prorateCycle` emits segments of
   `{plan, start, end, ratio, cents}` and has neither field. Six builds did what
   it said and passed the raw segments through, which is why all six failed
   exactly the segment-field cases and no others.

Round 4 changes instruction.md only; solution, tests, config and test.sh are
byte-identical to round 3.

- "Back come segments, one per stretch prorateCycle marks, each reading: {...}.
  planId names that stretch's plan, subscriptionCents its prorated figure."
- "Hours read to hundredths, cents whole, halves to even, roundHalfEven's way.
  Rounding is display only: carry keeps its full value, 4.3333 earned showing
  4.33 and handing 4.3333 on."
- Trimmed elsewhere to hold 297 words, 0 backticks, 3.7 articles per 100 words,
  sentence lengths 2 to 21 — the same band as the version that cleared aiCheck.

Submitted 2026-09-04 (1 of 3 submissions used on this account budget).
