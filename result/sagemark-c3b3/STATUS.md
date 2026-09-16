# sagemark — session c3b38556 (tree result/sagemark-c3b3)

Snapshot: `snapshot.borrower-v2-g1787592253118509.zip` (471 files).
Repo: **sagemark**, Vue 3 + Pinia + Tailwind + TypeScript, vitest 1.6 + happy-dom.
Base suite: `npx vitest run` → **218 files, 1888 tests, all green**, 53s.
`src/core` is plain TS on an injectable `KeyValueStore` (`MemoryStore` for tests),
so core-level specs need no DOM. Runtime deps that core pulls: `zod`, `nanoid`.

No repo id yet: `gold_bot.py list` shows no task on this codebase, and
`gold.repos.list` answers `[]` for assigned repos. The first draft is what
unlocks the repo id, `envs`/`env-log` and Step 0.

## Claimed

`bundle-restore`, category `feature_request`. Slate row in
`result/sagemark-SLATE.md`.

## Open risk (Step 0)

Node repo with real dependencies (vue, pinia, zod, nanoid, vitest, happy-dom).
If the platform generator built the agent image without an `npm ci` step, the
verifier cannot import `zod` and the repo is not gradeable. Check the moment a
draft exists: `gold_bot.py envs <repoId>` then `env-log <repoId> <version>`,
grep the `Step` lines for an install, then rebuild locally and run the base
suite with `--network none`.

## Notes from peer sessions

- session d8c3 (`journey-legs`, tree result/sagemark-d8c3) hit
  `Cannot find package .../pathe/index.js imported from vitest/dist/worker.js`
  on the default threads pool under node 24: one spec reports 0 tests and the
  run exits 1. `npx vitest run --pool=forks` is green for them (142 s). My own
  default-pool run was green (218 files / 1888 tests / 53 s), so it is
  intermittent. Use `--pool=forks` if it shows up.
- Trees on this box: result/sagemark-d8c3 (peer, journey-legs),
  result/sagemark-cdde (unowned), result/sagemark-c3b3 (mine).
- Slate now holds three claims: `bundle-restore` (mine, c3b3, io + services),
  `journey-legs` (d8c3, rules/journey + rules/supply + features/travel),
  `rest-recovery` (cdde, rules/rest + rules/hit-dice + spell-slots +
  conditions + features/party). All three file sets are disjoint. Slot 4 free:
  encumbrance over the unused `carryingCapacity`, a delve clock over light.ts,
  the initiative runner turnIndex FIXME, search/backlink ranking, the markdown
  lookbehind TODO.
- Slot 4 taken 2026-09-06 by session 48bf: `adventuring-day-plan`
  (rules/{day-slate,party-progress,day-budget,day-plan}.ts, four new files,
  no edits to existing files), tree result/sagemark-48bf. All four slots on
  sagemark are now claimed and every file set is disjoint.
- `result/sagemark` (no suffix) was three sessions writing one tree between
  16:33 and 16:42, mine included for one unzip at 16:36. It no longer exists.
  My tree is result/sagemark-c3b3 and nothing else writes it.

## bundle-restore — built 2026-09-06

Draft `mJcNgNBcpUunutkgvyIS`, repo `BaWX5OzTFQ77YYpY2WQf`, env v1, base commit
`00800e20bf11764d07d33a49ffd1f1798ed699ed`. Category `feature_request`.

Step 0 passed: env-log v1 is ten steps ending `RUN npm ci` then
`RUN npx vitest run --reporter=dot` (218 files / 1888 tests green in the image).
Read independently, and again by sessions d8c3 and 48bf.

### The gap

`src/features/io/useExport.ts` writes a v1/v2 bundle and `useImport.ts` parses
and counts one. Nothing writes a bundle back. The restore engine lands in
`src/core/io/` and goes through the services so their own validation applies.

### Shape

- `src/core/io/{bundle,idmap,restore}.ts` new: module vocabulary, old-id to
  new-id map, and `restoreBundle(bundle, store)`.
- `restore(row)` added to all 16 services: same construction as `create()`, but
  the id, the created stamp and the counters travel with the row.
- `src/features/io/useRestore.ts` new plus the Backup page button; the treasury
  purse rides along there because it is a store, not a service.
- Two passes: every surviving row is minted an id before anything is written,
  which is what makes a forward parent reference and the character/faction
  cycle resolve.

Solution 1039 added / 1 removed lines over 21 files. Held-out 996 lines over
2 files. f2p 38, p2p 281 (`src/core/services` + `src/features/io`).

### Verifier

`npx vitest run --reporter=junit` with `"format": "junit"`; ids are
`classname.name`, so `src/core/io/restore-graph.spec.ts.<describe> > <it>`.
Two invocations: the graded pair under a runner config written by `test.sh`
into `/tmp` (plain object, no imports, `root: /app`, no setup files), and the
services plus io selection under the repo's own config.

Local mirror in `/tmp/vsim`: an image built from the env-log's own steps
(`node:24-bookworm-slim`, git, `COPY repo /app`, `npm ci`) plus python3, then
the real `test.sh` and `grader.py`.

| run | reward | note |
| --- | --- | --- |
| oracle (solution.patch) | 1 | 38/38 f2p, 281/281 p2p |
| nop (no patch) | 0 | 0/38 f2p, 281/281 p2p |
| a1: hostile `vitest.config.ts` + `src/test-setup.ts` | 0 | pinned config ignores both |
| a2: fake `restore.ts` patching `Object.is`/`Object.keys` + fake spec files | 0 | see below |

**a2 is the one that mattered.** On the first pass it scored **reward 1**.
Code under `/app` runs in the same process as the runner, and patching
`Object.keys` broke vitest from inside: the run ended with "Unhandled Errors"
and exit 1 while its junit report listed all 38 cases with no failure element.
Two fixes, both kept:

1. `test.sh` rejects a graded report that shows nothing failed after a non-zero
   exit, and republishes every declared id as failed with the reason. An honest
   partial solution still reports its own failures, so diagnostics survive.
2. Each spec captures `Object.is`, `Array.isArray` and `Object.keys` before the
   module under test is imported (the import is dynamic, inside `beforeEach`)
   and rechecks identity inside every assertion.

### Round 1 verdict (submitted 17:26, terminal 17:35)

ciChecks passed, aiCheck passed, originality passed, reference verification
passed. **Quality review failed on one criterion, behavior_in_tests**: the
instruction said list entries drop when the row they name stayed behind, naming
initiative entries among them, and no case enforced that for initiative. The
only entry without a character in the fixture already carried `characterId:
null`, so an implementation that kept an unresolved entry still scored 1.

Every other quality criterion passed, including anti-cheating, which called out
the pinned runner config and the captured comparison primitives by name.

Three ciChecks warnings, all advisory: solution 1039 lines is above typical,
instruction 299 words against an aim of 250, and the base selection covered
22 of 218 existing spec files.

### Round 2 fix

- The engine always kept an unresolved initiative entry with its character
  cleared, which is the better behaviour: an entry is a combatant with a name
  and hit points, and dropping it loses the row. So the instruction changed to
  say that, in one clause, rather than the engine changing.
- The encounter case now carries a third entry whose character is not in the
  bundle, and asserts the order still holds three entries, that entry's
  character reads empty, and the rest of its row survives.
- Base selection widened from 22 spec files to the whole suite: p2p is now
  1888 ids over 218 files.

Local matrix after the fix, same image, same `test.sh`:

| run | f2p | p2p | reward |
| --- | --- | --- | --- |
| oracle | 38/38 | 1888/1888 | 1 |
| nop | 0/38 | 1888/1888 | 0 |
| hostile `restore.ts` patching `Object.is`/`Object.keys` | 0/38 | 1888/1888 | 0, guard fired |
| half-right solution (session count, attunement) | 36/38 | 1888/1888 | 0 |
| solution that drops unresolved initiative entries | 37/38 | 1888/1888 | 0 |

That last row is the round 1 finding, reproduced as a mutation and now caught.

### Flaky id pulled out of the whitelist (2026-09-06 18:30)

Session d8c3 flagged `src/features/reactions/components/ReactionRoller.spec.ts`
"roll 2d6 button updates the reaction" as flaky, one failure in eight full runs
on their tree. Read it: the case clicks reroll and asserts `w.text()` changed,
and the component renders `{{ d1 }} + {{ d2 }} ... = {{ total }}`, so the case
fails whenever the reroll repeats the same ordered pair. That is 1 in 36 per
run, not 1 in 9: 30 stress runs of the reactions, generators and dice specs
here came back 42/42 every time, which is what 1 in 36 looks like at that
sample size.

It still has to go. Six reference runs plus eight calibration trials plus the
run audit is around seventeen executions, so a 1 in 36 case is roughly a 40%
chance of one spurious p2p failure somewhere in the pipeline. Dropped from the
whitelist, p2p 1886 to 1885. The file still runs in the base selection, so a
real regression there is still visible in the log; it is only ungraded.

### Round 3 verdict and the fix (quality review, 2026-09-06 19:21 PDT)

Failed again on **behavior_in_tests**, and the finding was sharper than round
1: rules the instruction states without exception were only sampled on one or
two modules. Created stamp and fresh updated stamp were checked on a character
and the campaign; the foreign-campaign rule, the repeated-id rule and "a row
its model rejects" were checked on characters alone. A restore that honoured
those rules for characters and forgot them for lore or holidays still scored 1.

Fix is a third graded file, `src/core/io/restore-modules.spec.ts`: a table of
all fifteen modules, each with a sound row, a row belonging to another
campaign, a row repeating an id, and a row its own model turns down. Two cases
per module, thirty in all:

- keeps the stamp it arrived with and takes a fresh updated one;
- turns away the stranger, the repeat and the row the model rejects, with
  restored 1 and skipped 3.

The instruction did not change. It already stated these rules universally, and
it had passed aiCheck and every instruction criterion, so re-voicing it would
have risked a stage that was already green.

**Mutation tested, because a check that cannot fail is worth nothing.** For
each of the fifteen modules in turn, the engine was patched to stamp
`createdAt` as now for that module only, and separately to skip the
foreign-campaign and schema checks for that module only. Every mutation was
caught, and only that module's cases failed.

Two fixtures needed fixing before that was true. The tag slug rule masked both
the repeated-id mutation and the foreign-campaign mutation, because the repeat
and the stranger carried the same name as the sound row and were being refused
for the slug rather than for the rule under test. Tags now supply a distinct
`twin` and `stranger` row, so only the rule under test can turn them away.

Local matrix, same image, same test.sh, f2p now 68 and p2p 1885:

| run | f2p | p2p | reward |
| --- | --- | --- | --- |
| oracle | 68/68 | 1885/1885 | 1 |
| nop | 0/68 | 1885/1885 | 0 |
| hostile `restore.ts` patching `Object.is`/`Object.keys` | 0/68 | 1885/1885 | 0, guard fired |
| half-right solution (session count, attunement) | 66/68 | 1885/1885 | 0 |
| solution dropping unresolved initiative entries | 67/68 | 1885/1885 | 0 |

p2p excludes the two coin ids carrying the blocked term and the flaky
ReactionRoller id. Bundle 316824 bytes, floors all green, not pushed: the user
pushes and submits this round.

### Calibration I: 3 of 5 solved, too easy (2026-09-06 20:57 PDT)

The round the user pushed cleared automated checks, aiCheck, originality,
reference verification and quality review, then failed Calibration I at 3 of 5.
The band wants 2 or fewer.

Diagnosis without the trial patches, since the API was still refusing this box:
every rule in the instruction was independently implementable. A capable model
could walk the list top to bottom, and the one piece of design in it, resolving
references before writing, was handed over by the instruction itself ("Settle
every id before writing"). Nothing in the task made two rules argue with each
other.

Fix is two rules that collide, both riding on invariants the repo already owns,
plus the removal of that hint.

**Attunement is capped at three per character.** It collides with the rule
already there, that an item whose owner stayed behind comes back unowned and
unattuned: the ownerless item must not spend one of the three places. Working
out who holds what needs the owner map finished first, so it cannot be done
row by row on the way past, and the tie-break (earliest created stamp, then the
order the bundle lists) is a second thing to get wrong.

**A parent that would close a loop is dropped.** `wouldCreateCycle` is in
`models/location.ts` at the base commit and the natural call gets it wrong: the
walk has to include the row being settled, or the chain stops at the link that
has not been written yet and the loop reads as open. My own first pass had that
exact bug and the cases caught it.

The instruction now states the behaviour and no longer the technique:
"References follow, rewritten to the new id of the row they name, whichever way
they point", with the parent and the faction/leader pair as the illustration.
299 words, detector clean.

Seven new cases, 68 to 75. Mutation tested, all caught: cap of four, tie broken
by list order alone, cycle guard removed, cap counted per campaign instead of
per owner, and an allowance built on the bundle's own owner ids without
resolving them first.

Local matrix: oracle 75/75 f2p and 1885/1885 p2p reward 1, nop 0/75 reward 0,
the tampering patch 0/75 with the guard firing. Solution 1083 added lines over
21 files, held-out 1472 over 3 files, bundle 326 KB, floors green.
