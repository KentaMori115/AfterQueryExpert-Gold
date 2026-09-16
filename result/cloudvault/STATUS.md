# cloudvault — build log

Snapshot `snapshot.borrower-v2-g1787258560392223.zip` (AQ_dragan/snapshots),
unpacked at `result/cloudvault/repo` 2026-09-05. 17th Gold codebase on the
dragan seat, first session on it. The `borrower-v2` label is the platform's;
the tree is **CloudVault Storage API**.

## What the repo is

Next.js 15 App Router + TypeScript 5, Firebase Firestore (client + admin),
Upstash Redis, Telegram Bot API. Files are uploaded to a user's own Telegram
chat through their bot token and re-served through a stable REST API with
per-key usage tracking. Extras layered on top: workspaces with an RBAC role
ladder, signed share links with bcrypt passwords, version history and trash,
outbound webhooks, sharp-backed image transforms, a bi-directional Telegram
webhook bot.

135 files, 10,934 lines of `.ts`/`.tsx`. `lib/` holds the helpers (2,109
lines), `app/api/` the routes, `components/dashboard/` the UI.

## Base suite

`jest` + `ts-jest`, `testMatch **/__tests__/**/*.test.ts`, `testEnvironment
node`. **95 passed, 9 suites, 2.5 s** locally on node 24.7.0.

| suite | cases | needs a package |
| --- | --- | --- |
| `__tests__/file-utils.test.ts` | 54 | no |
| `__tests__/api-key.test.ts` | 23 | `uuid` |
| `__tests__/stats.test.ts` | 6 | no |
| `__tests__/share-utils.test.ts` | 6 | no (`node:crypto`) |
| `__tests__/webhook.test.ts` | 2 | no (`node:crypto`) |
| `__tests__/workspace-rbac.test.ts` | 1 | `firebase-admin` (type only) |
| `__tests__/version-trash.test.ts` | 1 | no |
| `__tests__/share-manager.test.ts` | 1 | `bcrypt` (native) |
| `__tests__/image-processor.test.ts` | 1 | `sharp` (native) |

Corrected 2026-09-05 after `mindriftwork-f7` checked it and both halves held up
against the source. `lib/webhook.ts` line 2 is a **value** import of
`getFirestore`/`FieldValue` from `firebase-admin/firestore`, so
`__tests__/webhook.test.ts` cannot load offline however good the stand-in is;
`__tests__/version-trash.test.ts` has **zero** imports and is pure date
arithmetic, so it does.

So the pool that runs with zero packages AND zero stand-ins is **67**:
file-utils 54, stats 6, share-utils 6, version-trash 1. That clears the p2p
floor of 50 even if the platform image is a bare `node:24-*-slim` the way
`account-updater`'s was.

`__tests__/api-key.test.ts` (23) needs a `uuid` stand-in and
`__tests__/workspace-rbac.test.ts` (1) a `firebase-admin` stub, since a
type-only import survives `--experimental-transform-types` in strip mode.
Neither is free; both are verifier machinery that has to be defended.

## Local install note

`npm ci` into the repo directory fails repeatedly (`ENOENT` / `ENOTEMPTY`
during tar extraction): two VSCode `fileWatcher` processes are walking
`/root/mindriftwork` and race npm's rename-and-delete. Install into the session
scratchpad and symlink instead:

```sh
mkdir -p "$SP/nm" && cp package.json package-lock.json "$SP/nm/"
( cd "$SP/nm" && npm ci --no-audit --no-fund )      # 962 packages, 48 s
ln -sfn "$SP/nm/node_modules" repo/node_modules
```

## Platform facts

| | |
| --- | --- |
| repo id | `5CviKRq9xQSJMXtliovF`, platform name **tg-storage-api** |
| base commit | `451b9dc6ef18ab374ada270d111fa0731517a6b4` (= headSha) |
| environment | v1, `gold-repo-tg-storage-api-5cvikr:v1`, published 2026-09-03 |
| draft | `LIuGNaBKHXz4D563jpXS`, PUSHED 2026-09-05, awaiting submit |

A repo id only ever appears beside an existing task, so Step 0 (read the
environment build log, rebuild the image, run the base suite in it with
`--network none`) cannot start until the first draft is created. On this seat
drafts are the user's to create.

## Slate

| task | category | files claimed | state |
| --- | --- | --- | --- |
| `usage-allowances` | feature_request | `lib/billing-period.ts`, `lib/usage-ledger.ts`, `lib/allowance.ts`, `lib/quota-decision.ts` (all new) | proposed 2026-09-05, waiting on a draft |

`partial-downloads` (byte-range serving) was proposed here at 00:16 and
**withdrawn at 00:20**. Three sessions claimed byte-range work on this one
snapshot within four minutes: `mindriftwork-f7` (`result/cloudvault-74ab`,
`lib/range-plan.ts` + `lib/range/*.ts`), `mindriftwork-55`
(`result/cloudvault-b442`, `lib/range.ts` + `lib/chunk-index.ts`), and this
one. Originality compares changed-file sets and content rather than names, the
repo caps at four active tasks, and nothing had been built here yet, so moving
cost nothing. Byte-range is left to the other two to settle between them.

Other sessions on this snapshot and what they hold:

| session | tree | task | area |
| --- | --- | --- | --- |
| `mindriftwork-7e` | `result/cloudvault-f4b4` | `delivery-retries` | `lib/webhook-queue.ts`, `lib/webhook-retry.ts`, `lib/webhook.ts`, `app/api/webhooks/**` |
| `mindriftwork-f7` | `result/cloudvault-74ab` | `ranged-downloads` | `lib/range-plan.ts`, `lib/range/*.ts`, `app/api/file/[fileId]/route.ts` |
| `mindriftwork-55` | `result/cloudvault-b442` | byte-range | `lib/range.ts`, `lib/chunk-index.ts`, `app/api/file/[fileId]/route.ts`, `app/api/share/[token]/route.ts` |

## The gap

Usage is recorded but never *metered*. `recordUsage` appends a `UsageRecord`
(`type`, `fileSize?`, `timestamp`, `success`, `endpoint`) to the `usage`
collection and bumps three running counters on the API key. `lib/stats.ts`
sums those counters across keys and stops there. There is no period, no plan
allowance, no reset, and no way to answer "is this key over its limit right
now" — the dashboard shows lifetime totals only.

The four new modules meter it: anchor-day period arithmetic, a fold of the
record log into per-period usage, allowance carry-forward across periods, and
an admission decision for a prospective request.

Difficulty is interaction rather than scope. Three quantities aggregate three
different ways over one log: requests are a count, bandwidth a sum, and stored
bytes a *level* that rises and falls, so a period's storage figure is not a sum
of anything. Period boundaries follow an anchor day rather than the calendar,
so an anchor past the length of a short month has to clamp, and allowance
carry-forward makes each period's balance depend on every period before it. A
boundary placed one day wrong in February changes a number in every later
period, which is what a closed-form answer cannot survive.

## Dependency profile

All four modules are pure arithmetic over plain objects: no `firebase-admin`,
no `bcrypt`, no `sharp`, no `next`. They grade whether or not the platform
image ran `npm ci`. `lib/stats.ts` is left untouched so its 6 base cases stay
in the p2p pool, and no file another session claimed is touched at all.

## Build record — `usage-allowances` (2026-09-05)

Built while blocked on the draft. Nothing in the four modules, the held-out
suite or the instruction depends on the repo id or the base commit, so the body
of the bundle was finished ahead of it. What is still owed once a draft exists:
`task.toml`, `config.json`, `tests/test.sh` from the frozen frame, the two
patches, and a `verify_task.sh` run.

### Numbers

| | | floor |
| --- | --- | --- |
| solution | **478 lines / 4 files** | 459 / 4 |
| held-out | **469 lines / 1 file** | band `[445, 478)`, cap 596 / 2 |
| instruction | **283 words** | 100 to 300 |
| lines per word | **1.69** | 0.9 to 7.5 |
| f2p | **71** | 8, aim 20 |
| p2p | **95**, or 67 with no `node_modules` | 50 |

### Files

`lib/billing-period.ts` (105), `lib/usage-ledger.ts` (134), `lib/allowance.ts`
(128), `lib/quota-decision.ts` (111). Held-out at
`__tests__/metering-fold.test.ts`, named off the feature so an agent writing
its own tests never lands on the graded path. No existing file is touched.

### Verified

- 166 pass with the solution in place (95 base + 71 new), `npm run typecheck`
  clean over the whole repo.
- With the four modules moved away, the held-out suite fails to load and the
  95 base cases still pass. So every one of the 71 f2p ids is absent from the
  base report and grades as failed, which is the behaviour the floor wants.
- Voice detector CLEAN on `instruction.md`; sentence lengths run 4 to 28 words.
- `instruction.md` ends with the exact commit-convention line.

### Both directions of the sentence-to-case audit

Failing this in either direction is what sank the reference task twice, so it
was run as a grep rather than by eye.

Forward, every stated field asserted at least once: three were not.
`bandwidthUsed`, `bandwidthOverage` and `carriedInBandwidth` were stated by the
instruction and touched by no case. Folded into two existing cases rather than
new ones, to stay under the line band.

Backward, every case traced to a sentence: two were not. The out-of-range
`anchorDay` cases and the `periodsSpanning` window cases rested on contracts
the instruction never stated. Both are now stated, paid for by cutting the
opening paragraph from 34 words to 15. Context is not graded; contracts are.

### Design notes worth keeping

`recordUsageAdmin(..., "delete", 0, ...)` logs a deletion with size zero, and
`UsageRecord` carries no file id, so a deletion in the usage log can never be
matched to the upload it reverses. Stored bytes therefore cannot come from the
log at all and have to be read off file records instead. That is what puts two
different input collections into one fold, and it came out of the repo rather
than being invented for difficulty.

The clamp is the trap most likely to separate a correct build from a plausible
one: anchor 31 gives 2025-01-31, 2025-02-28, 2025-03-31, so the short month
clamps without dragging the anchor down with it. A build that lets February
move the anchor is wrong from March onward, in every period, through the bank.

### Mutation battery

31 mutations of the reference, each checked to have actually changed the file
before the suite ran. First pass killed 25 and left 6 standing, and the six
split three ways.

One was a **bad mutation**. It clamped the anchor against the month the
subscription started in, which for every fixture here is January, so it changed
nothing and only looked like a surviving defect. Rewritten to make the anchor
follow the previous boundary, which is real drift, it dies on the case that was
supposed to catch it. Peer `mindriftwork-f7` hit the same shape twice with seds
that never matched; a mutation that cannot change the answer proves nothing
about the suite.

One was **dead code**. `normaliseAnchorDay` clamped `anchorDay` down to 31, but
`anchorBoundary` already mins against the month length, so no input could tell
the branch's presence from its absence. The case covering it was asserting a
promise nothing could break. Branch removed, case removed, instruction reworded
to "`anchorDay`, at least 1".

Four were **real gaps**, all the same shape: a fixture too weak to separate the
rule from a coincidence.

| survivor | why it lived | fix |
| --- | --- | --- |
| bandwidth counts every type | listing and delete fixtures carried no size, so "skips these types" and "these moved nothing" gave the same answer | fixtures now report 700 and 800 bytes |
| closing level read on the boundary | no file changed state at the boundary | added a file uploaded exactly when the next period opens |
| `balanceAt` half open flipped | every fixture instant sat mid period | asserts the boundary and the millisecond before it |
| `retryAfterSeconds` floors | the gap was a whole number of days, so ceil and floor agreed | instant moved off the second |

Second pass: **30 killed, 0 survivors, 0 unmatched.**

## Step 0 — GREEN (2026-09-05)

The generator installs dependencies on this repo. Nothing like `account-updater`.

```
1/10  FROM node:24-bookworm-slim
2/10  install git
3/10  COPY repo/ /app
5/10  apt-get install ca-certificates git python3 make g++
7/10  npm install a PINNED set into /opt/task-node_modules, cp -r to /app/node_modules
8/10  ENV PATH=/opt/task-node_modules/.bin:$PATH
9/10  ENV NODE_PATH=/opt/task-node_modules
10/10 git config safe.directory /app; core.hooksPath /dev/null
```

Pinned set: jest 29.7.0, ts-jest 29.2.5, typescript 5.8.3, @types/jest,
@types/node, @types/bcrypt, uuid 11.1.0, sharp 0.35.3, bcrypt 6.0.0,
firebase-admin 13.4.0.

Rebuilt locally from those exact lines and ran the base suite with
`--network none`: **95 passed, 9 suites, 10.3 s**. So the offline-pool question
was moot and the full 95 p2p is available. Two things that cost time:

- **`jest-ctrf-json-reporter` is NOT in the pinned set** and `allow_internet`
  is false in both containers, so the scaffold's `npx jest ...
  --reporters=jest-ctrf-json-reporter` line cannot work here. Same for
  jest-junit. The report is built from jest's own reporter API instead.
- **Step 10 only passes because `/app` is a git repo**, so the platform copies
  `repo/` WITH its `.git`. A local rebuild fails at exit 128 until the context
  is `git init`ed and committed.

## Verifier design

`node_id` is `"name"`, not `"suite.name"`, so grader.py takes the id straight
from the report name. All 191 test names were checked unique across both
selections first; two tests sharing a name would collapse into one id and one
of them would silently stop being graded.

Integrity, in layers, every one of which degrades rather than refuses:

| layer | what it stops |
| --- | --- |
| graded cases arrive via `test.patch`, applied after the submitted patch with their paths reset | editing the graded suite |
| jest, its config and the reporter all live outside `/app` | shadowing the framework or `jest.config.js` |
| reporter runs in jest's MAIN process, which never loads repository code, and reads a per-run token from stdin before any suite starts | forging verdict lines; workers never see the token |
| `freeze.js` pins `expect` and the hooks non-writable before any suite file is imported, and fails a case that asserted nothing | neutering the matcher |
| python3 publisher holds the whitelist and publishes EVERY declared id | a crashed or silenced run reporting nothing |

## Local battery (2026-09-05)

| row | reward | notes |
| --- | --- | --- |
| base | **0** | f2p 0/96, p2p 95/95 |
| oracle | **1** | f2p 96/96, p2p 95/95 |
| alt-shape | **1** | class instances, extra fields, reordered writes, linear scan |
| break only | 0 | f2p 92/96, the baseline the attacks are measured against |
| forge `expect` | 0 | 92/96, freeze held |
| forge the report file | 0 | 92/96, publisher overwrote it |
| forge the verdict stream | 0 | 71 forged lines detected, failed closed |
| neuter `fs.writeSync` | 0 | broke its own suite, stream stayed accurate |
| silence the hooks | 0 | 92/96, hooks frozen |

**The attacks lied on the first pass.** Every row scored 0, which looked like a
clean sweep. They scored 0 because the payloads were plain JS pasted into a
`.ts` file and ts-jest refused to compile them, so the suite never loaded and
every case failed for a reason that had nothing to do with the hardening. The
tell was `f2p 0/96` where the break alone gives `92/96`. Rewritten to
type-check, the payloads run and the rows mean something. Same lesson as a sed
that never matches: a check that cannot fail proves nothing.

## Floors

Held-out `596 lines / 2 files` is a **floor, not a cap**. The first bundle was
471 lines in one file, sized against the `[0.93 x churn, churn)` band in the
guide, and `gold_bot.py check` flagged both `testFiles` and `testAddedLines`
LOW. Split into `metering-fold.test.ts` and `plan-balances.test.ts` and grown
to 659 lines across 2 files, which is over the churn of 478 and clears the
floor. Only the `check` floors are the gate.

| | | floor |
| --- | --- | --- |
| solution | 478 lines / 4 files | 459 / 4 |
| held-out | 659 lines / 2 files | 596 / 2 |
| instruction | 283 words | 100 to 300 |
| lines per word | 1.69 | 0.9 to 7.5 |
| f2p | 96 | 8, aim 20 |
| p2p | 95 | 50 |

## Gotcha

`gold_bot.py pull` overwrites the whole task directory, including an
`instruction.md` already written. Authored files are kept in
`tasks/usage-allowances/authoring/` and copied into the bundle, so a pull
cannot destroy them again.

## Round 1 — Validation Failed at quality review (2026-09-05 04:56)

First four stages passed: ciChecks, aiCheck, similarity, oracleNop. Quality
review failed **four criteria at once**, and all four were one root cause:
edge semantics the graded cases assert that `instruction.md` never states.

| criterion | what it named |
| --- | --- |
| `behavior_in_task_description` | `retryAfterSeconds` rounding and its zero-outside case, `anchorDay` 0 normalising to 1, omitted transfer sizes counting as zero |
| `implementation_acceptance_breadth` | an implementation may reject `anchorDay` 0, round retries another way, or refuse an omitted size, and still satisfy the stated contract |
| `instruction_self_containedness` | success needs behaviour available in neither the instruction nor the base checkout |
| `structured_data_schema` | `type` values and the optionality of `fileSize`, `deletedAt`, `sizeBytes` never named |

The sharpest of these is `anchorDay`. The instruction said "`anchorDay`, at
least 1", which is an **input contract**: it tells the solver what it will be
given. The test asserted 0 becomes 1, which is a **normalisation rule**: it
tells the solver what to do with something outside that. Those are different
promises and only one was written down. An input contract is not a behaviour
spec, and quality review reads them apart even when the wording looks close.

Every fix was to state the rule, never to delete the assertion. Instruction
went 283 to 297 words to carry them, which leaves the advisory "aim under 250"
warning standing; the reviewer asked for more schema detail, not less, so
trading the blocking failure back for the warning would be the wrong way round.

### One more found by applying the same lens

Nothing flagged it, but a case asserted `anchorBoundary(2025, 12, 15)` rolls
into 2026-01-15. That is incidental `Date.UTC` behaviour, never stated, and an
implementation validating a month index of 0 to 11 would be correct against the
contract and fail the case. Identical in kind to the acceptance-breadth
rejection. Dropped rather than stated, since the instruction had 3 words of
headroom left.

### Also cleared

Three ciChecks warnings about test titles appearing near-verbatim as
instruction sentences. A looser local check over both held-out files found four
more the platform had not named; all seven are reworded, and the local check
now reports zero.

Round 2 pushed and submitted 05:13, 2 of 3 submissions used. Bundle: 478
solution lines / 4 files, 655 held-out / 2 files, 297 instruction words, 95 f2p,
95 p2p. Battery re-run clean: base 0, oracle 1, alt-shape 1, five attacks 0.

## Round 2 — Validation Failed at quality review (2026-09-05 05:13)

Same stage, different findings: `behavior_in_task_description`,
`behavior_in_tests`, `instruction_self_containedness`, `structured_data_schema`.
Round 1's fixes held; round 2 exposed one level deeper. Prose that names fields
still leaves the *conventions* unstated:

- billing helpers took zero-based month indexes, never said
- timestamps were epoch milliseconds, never said
- the admitted verdict is exactly `admit`, never said (round 1 stated `deny`
  and `throttle` and stopped)
- outside a subscription the decision uses `periodIndex` -1 with every
  remaining figure zero, never said
- `behavior_in_tests`: "every size not above zero" was promised while only zero
  and missing were tested, so a selectively wrong build still scored 1

The last one was spotted locally before the verdict arrived and could not be
acted on, because pushing cancels an in-flight run.

## Round 3 — the fix was structural, not more sentences

The reviewer asked for an exact schema, so the prose contract became a schema
block: every interface, every key, both string unions written out, optional
fields marked, and one line fixing time and size units.

**In full TypeScript that block came to 464 words against a 300 cap.** Nothing
could shave a 164 word gap, so the graded surface shrank instead:

| removed from the contract | why |
| --- | --- |
| `lastDayOfMonth`, `anchorBoundary`, `periodBoundary` | internal helpers whose signatures were the unstated month-index convention; still in the code, no longer graded |
| `storedBytesAt`, `balanceAt` | still exported for cross-module use, no longer graded, so their signatures need no spec |
| `Plan.name` | named by the instruction, enforced by nothing |
| `carriedOutRequests`, `carriedOutBandwidth` | period N's carried-out IS period N+1's carried-in; documenting one quantity twice is what made it unstated |

Every affected case was rewritten to reach the same fact through a stated entry
point rather than deleted. Boundary facts go through
`periodByIndex(...).startsAt`, the stored level through `buildLedger` peaks with
changes placed on boundaries to pin inclusive and exclusive, and the half-open
rule through the `periodIndex` that `decideRequest` reports.

### The audit that should have run before round 1

Both directions, as a script rather than by eye:

- every property the tests read off a result object must appear in the instruction
- every function the tests call must be named
- every function the instruction names must be called
- every field the instruction names must carry an assertion

It found five defects of exactly the rejected kind after the round 3 rewrite and
before submitting: `carriedOutRequests`, `carriedOutBandwidth`, `anchorBoundary`,
`lastDayOfMonth`, `periodBoundary`. It now reports zero.

Round 3: 470 solution lines / 4 files, 654 held-out / 2 files, 297 words, 92 f2p,
95 p2p. Battery green, mutation battery back to 54 of 54 after the test
rewrites. Submitted 05:38, 3 of 3 used.

## Rounds 4 to 6, and the pass (2026-09-05)

| round | stage that failed | finding |
| --- | --- | --- |
| 4 | quality review | `buildLedger` promised metering from `startedAt`, but period 0 opens on the anchor boundary before it and the reference counted that earlier stretch. The reference was wrong, not the promise. Fixed by metering from `max(period.startsAt, startedAt)` for counts, bandwidth and the peak window |
| 5 | quality review | remaining figures report credit BEFORE serving the request, a timing convention never stated; and the promised zero figures outside a subscription were asserted by no case |
| 6 | **passed all 8** | |

### Calibration II said 0 of 8 and meant nothing of the sort

Round 5 cleared quality review and Calibration I, then failed Calibration II
`out_of_band_hard` at 0 of 8. The number is worthless without the trial
reports. Pulled all eight `probe/task__*/verifier/ctrf.json`:

| trial | f2p failed of 99 | p2p failed of 95 |
| --- | --- | --- |
| 6qhdcKH, ZfzeWGn | 2 | 0 |
| oMejcYe | 3 | 0 |
| the other five | 4 | 0 |

Every trial passed 95 to 97 of 99. Two cases failed in **all eight**:

- `periodsSpanning` returning nothing for an empty window, a rule stated nowhere
- the period 0 peak taken from `startedAt` rather than the boundary

and two more failed in 5 of 8, both the same `startedAt` clamp. **Three of the
five came from a clause I had deleted in round 5 to buy six words.** The probe
was measuring my spec gaps, not the task's difficulty.

Fixes: `periodsSpanning` left the graded contract entirely, taking its unstated
empty-window rule with it, and the words that freed went into stating the clamp
for both counts and peak. Its mutant was dropped rather than left as a survivor
proving nothing about a behaviour no longer promised.

## Final: PASSED all 8 stages, status Needs Review

476 solution lines / 4 files, 676 held-out / 2 files, 299 instruction words,
95 f2p, 95 p2p. Calibration I 0 of 5, Calibration II passed, run audit passed.

Local battery at the end: base 0, oracle 1, alt-shape 1, five forgery attacks 0,
mutation battery 56 of 56 killed with 0 survivors and 0 unmatched, and the
four-way instruction-to-test audit clean.

**Do not push to this draft again.**
