# signalbox — build log

Snapshot `snapshot.borrower-v2-g1788304386818258.zip` (AQ_dragan/snapshots),
unpacked at `result/signalbox/repo` 2026-09-04. 16th Gold codebase, first
session on it. Python 3.11+, `src/` layout, deps pydantic 2.10.5, typer 0.15.1,
rich 13.9.4, PyYAML 6.0.2; dev extras pytest 8.3.4, mypy, ruff.

Base suite: **2065 passed in 43 s** inside `signalbox-local:v0`
(`envbuild/Dockerfile`, python:3.12-slim + `pip install -e ".[dev]" click==8.1.8`)
run with `--network none`. The click pin matters: typer 0.15.1 with click >= 8.2
breaks `CliRunner(mix_stderr=...)` and collection of `tests/cli/test_cli_errors.py`
aborts the whole run. Whether the platform image pins click is the first thing
to read out of the env log.

## What the repo is

`signalbox` 0.3.0, interlocking design and verification for railway signalling
schemes. 15607 source lines over 118 modules; 15221 test lines. Layers, top
down: `cli` (one module per command, no logic) -> `verify` / `tables` /
`interchange` / `render` / `sim` -> `signalling` -> `topology` -> `layout` ->
`units`. Nothing below `cli` prints, nothing below `layout.loader` reads a file,
every answer is deterministic, and every design figure a rule uses comes from
the scheme's own `standards { }` block.

- `layout`: tokeniser, recursive-descent parser, validator, formatter. Nine
  declarations: `scheme`, `standards`, `node`, `edge`, `section`, `signal`,
  `crossing`, `trap`, `include`.
- `topology`: graph, positions, one shared traverse, sections, chainage,
  gradient profile, reachability.
- `signalling`: routefind, route, overlap, flank, subroute, conflict, locking,
  aspects, approach locking, braking, headway, sighting, tpws, callon, warning,
  berth, crossing, emergency, trap, points, interlocking.
- `verify`: 54 rules in `verify/checks/`, registered by decorator, plus
  `guidance.py` (why/fix prose) and `waivers.py`.
- `sim`: machine, state, lamps, trains, drivers, ars, regulator, scenarios,
  history, replay, timetable.

## Base invariants that bite anything built here

| | |
| --- | --- |
| `tests/test_rules_doc.py` | `docs/rules.md` must equal `signalbox rules --markdown` byte for byte. A new rule without regenerating the doc fails 6 base cases. |
| `tests/test_golden.py` | control CSV, points, locking, interchange JSON and report for `tests/data/kingsmoor.sbx` are recorded. A new control-table column breaks all of them. Regenerate with `SIGNALBOX_UPDATE_GOLDEN=1`. |
| `tests/test_docs.py` | every ```` ```sbx ```` block in `docs/` is parsed and, if it has an `edge`, built. Blocks are parametrised per file in order, so a block inserted mid-file renumbers the ids after it. |
| `tests/test_readme.py` | every `signalbox ...` line in the README must be a real command with real options. |
| `tests/verify/test_standards_are_used.py` | a rule may not carry its own design figure. |
| ruff + mypy strict | `make check` runs both; complexity cap 10, line length 96. |

## The gap: automatic signals (claimed 2026-09-04, session 11219bf1)

`Signal.automatic` is parsed from `signal ... automatic yes`
(`topology/scheme.py:131`), validated (`signal.py:92`, an automatic signal must
be `type main`), and exported to the interchange file
(`interchange/schema.py:84`, `model.py:150`), and **nothing anywhere reads it**.
No calculation reads it: `subsidiary` feeds call-on, `warning` feeds warning
routes, and `sighting`, `headway`, `approach`, `throw`, `motor`, `lock`,
`detection`, `strike_in` and `mileage` all have readers. It is not the only
orphan in the tree — `section ... counted` (`SectionKind.AXLE_COUNTER`) is
parsed, printed and exposed as `Section.is_counted` and read by nothing either,
but that one is live in kingsmoor.sbx and both examples, so it is not inert.
`docs/language.md` does not mention `automatic` either.

No example plan and no test fixture sets it, so the whole feature is inert on
every existing fixture: base tests stay green while it is being built.

Category proposed: `feature_request`. Name proposed: `automatic-signals`.

Work tree is `work-automatic/` (git, branch `main` = base 6b3a82f local sha).
`work/` was mine and I deleted a peer session's tree when I created it on
2026-09-04; nobody should use that name on this repo again.

## Slate

| task | session | files |
| --- | --- | --- |
| `automatic-signals` (draft wnTV16rDYGULl8DpgaP1) | 11219bf1 | ADD `signalling/automatic.py`, `verify/checks/automatic.py`; EDIT `verify/rules.py`, `verify/guidance.py`, `verify/checks/__init__.py`, `sim/machine.py`, `sim/state.py`, `sim/scenario.py`, `sim/world.py`, `docs/language.md`, `docs/scenarios.md`, `docs/rules.md`. Tests `tests/signalling/test_automatic_working.py`, `tests/sim/test_automatic_signals.py`. |
| `speed-restrictions` (draft tVQslFziI4u1azMZBPgl) | not this session | unknown |

## Slate: counted-sections (claimed 2026-09-04, session 7bcf0f68)

Draft `7qYTzMwhbjTvnEMFuKUY`, category `feature_request`, repo TG0l5TCpuoAvgYZzAsSB,
base 97db2aa, env v2. Third task on this repo, alongside `automatic-signals`
(11219bf1) and `speed-restrictions` (4d492f09).

Work tree `tasks/counted-sections/work` — session-unique, NOT the shared `work/`.
Local image `signalbox-cs:v2` built from `cs-env/Dockerfile`, which is the real
env-log v2 Step lines, not `pip install -e`: two plain pip installs with
click==8.1.8, PYTHONPATH=/app/src, package never installed. 2065 base tests green.

The gap: `SectionKind.AXLE_COUNTER` is a second orphaned flag. Set at
`layout/parser.py:233`, printed at `layout/format.py:79`, exposed as
`Section.is_counted` at `topology/section.py:30`, read by no calculation anywhere.
Only `tests/unit/test_section.py` and `tests/unit/test_parser.py` touch it, both
parse-level. It needs no parser change, which is what keeps it clear of
`speed-restrictions`.

Feature: counting heads and reset zones. A counted section is bounded by heads;
heads are shared only through a two-ended node, never at points, a crossing or a
slip, where each leg carries its own; counted sections joined by a shared head
form one reset zone; a route releases zone-mates together.

Changed-file set (none of it belongs to either peer):

  NEW  src/signalbox/topology/counting.py
  NEW  src/signalbox/cli/commands/heads.py
       src/signalbox/topology/section.py
       src/signalbox/signalling/locking.py
       src/signalbox/tables/locking_table.py
       src/signalbox/tables/index.py
       src/signalbox/interchange/model.py
       src/signalbox/interchange/schema.py
       src/signalbox/cli/main.py
       src/signalbox/verify/checks/detection.py   (one new rule, 54 -> 55)
       src/signalbox/verify/guidance.py           (shared, append only)
       docs/rules.md                              (shared, regenerated)
       README.md, CHANGELOG.md, tests/golden/*

Not touched: any `layout/` file, `topology/scheme.py`, `signalling/braking.py`,
`verify/checks/__init__.py`, `verify/checks/spacing.py`, any `sim/` file,
`verify/rules.py`, `docs/language.md`, `docs/scenarios.md`.

Hard constraint found and shared with both peers: `tests/test_packaging.py:125`
holds a literal number-word dict that stops at 55, and `len(registered())` is 54
at base, so **any one task may add at most one registry rule**. The three patches
never compose, so all three of us can go 54 -> 55 independently.


## speed-restrictions — PASSED all 8 stages 2026-09-04, round 5

Draft `tVQslFziI4u1azMZBPgl`, category `feature_request`, work tree
`result/signalbox/sr-work` (branches `main`, `solution`, `heldout`), bundle
`result/signalbox/tasks/speed-restrictions`.

### What the task asks for

A `restriction NAME on EDGE at OFFSET for LENGTH speed MPH` declaration, the
extent it covers worked out by walking the graph, `permissible_speed`,
`fastest_on` and `slowest_on` on a scheme, an approach braking calculation that
walks back over the track in rear taking the worst gradient met so far, a
`restriction-room` rule, spacing and headway reading the new speeds, a driver
held to them, and a `restrictions` command.

### Numbers

| | |
| --- | --- |
| solution | +726 / -8 over 19 files (churn 734) |
| held-out | +795 over 2 files, 68 cases |
| instruction | 298 words, 2.44 solution lines per word |
| p2p | 297 ids over 19 base files |
| local verify | solution reward 1 (68/68 f2p, 297/297 p2p), base reward 0 (0/68 f2p, 297/297 p2p, every id published) |
| attack matrix | every attack row DEFENDED, three honest rows reward 1. Honest rows report 299 p2p ids rather than 297: the solution's own documentation example adds two parametrised cases to tests/test_docs.py, which is a p2p file. |

### Things this repo pins that cost a round if missed

- `tests/test_packaging.py::test_the_number_of_rules_in_the_changelog_is_right`
  holds a literal word map that stops at **55**. Base has 54 rules, so a task
  may add at most ONE, and `CHANGELOG.md` has to move from "Fifty four rules"
  to "Fifty five rules" in the same patch.
- `tests/test_rules_doc.py` compares `docs/rules.md` byte for byte against
  `signalbox rules --markdown`, so a new rule means regenerating that file.
- `tests/verify/test_guidance.py` wants a guidance entry for every rule.
- `tests/test_docs.py` parses every ```sbx``` block in `docs/`, and validates
  the ones that mention an edge, so a documentation snippet has to be a whole
  buildable scheme. Adding a block at the END of a file keeps the existing
  parametrised ids stable.
- `tests/test_golden.py` records five outputs for `tests/data/kingsmoor.sbx`
  only. An additive feature that leaves those five alone needs no regeneration,
  which is why this task stays out of `interchange/`.
- `tests/property/test_round_trip.py` formats every plan under `examples/` and
  `tests/data/`, so a new declaration needs `layout/format.py` or the property
  tests fail.
- A fixture that names a signal after an edge fails `_check_unique_names`.

### Verifier

`local/make_test_sh.py` is veldt's, with the file lists changed and two edits:
the child appends `/app/src` before `/app` to `sys.path` (src layout, package
never installed, and `test.sh` unsets PYTHONPATH), and the child runs pytest
with `--continue-on-collection-errors` so one unimportable file does not hide
the other selection.

## automatic-signals — **PASSED all 8 stages 2026-09-04**, status Needs Review

Draft `wnTV16rDYGULl8DpgaP1`, repo `TG0l5TCpuoAvgYZzAsSB`, base
`97db2aa021b9f653a73521fafd9ff94d76dbef70`, environment **v2**
(`gold-repo-signalbox-tg0l5t:v2`). Category `feature_request`.

| | |
| --- | --- |
| Step 0 | PROVEN: `signalbox-env:v2` rebuilt from the v2 Step lines, `docker run --network none ... python -m pytest` -> 2065 passed in 41 s |
| floors | solution +520 over 21 files, tests +704 over 2 files, instruction 282 words, f2p 70, p2p 273, lines/word 1.84 |
| local verifier | solution row reward 1 (70/70 f2p, 273/273 p2p); base row reward 0 (0/70 f2p, 273/273 p2p, every id published) |
| attack matrix | 4 honest rows score 1, 20 attacks all DEFENDED, token forge included |
| mutants | 21 mutants, one per sentence of the instruction, all caught |
| suite after the solution | 2137 passed, mypy clean, ruff unchanged (3 pre-existing A005) |

Work tree `work-automatic/`, branches `main` (base) and `heldout` (solution +
the two graded files). Tooling in `tasks/automatic-signals/local/`, ported from
veldt: `make_test_sh.py`, `verify_task.sh`, `attack_matrix.sh` + `attacks/`,
`mutants.py`.

### What the task asks for

`Signal.automatic` was parsed, validated and exported and read by nothing. The
change gives it meaning: which declared automatic signals can really be left to
the trains (one route, no points on it or in its overlap), one new error rule
`auto-working` for the rest, routes that stand set with no signaller, and the
replacement control that takes one back with approach locking honoured.

### Things measured here that will bite the next task on this repo

- **The rule registry is capped at 55.** `tests/test_packaging.py::test_the_number_of_rules_in_the_changelog_is_right`
  holds a literal dict of number words stopping at 55, and base is 54. One new
  rule per task, no more, and `CHANGELOG.md` has to say "Fifty five".
- **Adding automatic working broke three existing rules.** `setting-refused`,
  `setting-pairs` and `setting-clears` drive a `Machine` and read its refusal of
  an automatic route as broken interlocking. They had to learn about it, and a
  graded case pins that a plain line with an automatic signal reports nothing.
- **A single-section route never releases itself.** `clear()` only releases
  sectionally, and `Release.COMPLETE` is what a one-section route gets, so an
  automatic signal reading over one section stood at danger for the rest of the
  run until `_work_automatic_routes` learnt to free a route whose track is empty
  again.
- **Two ids exist only after the solution.** `test_scenario_dispatch` is
  parametrised over `COMMANDS`, so the two new verbs add
  `...[replace]` and `...[automatic]`. Both were dropped from the p2p list; they
  fail at base for the honest reason that they do not exist there.
- **`tests/test_docs.py` and `tests/test_scenario_docs.py` are not in p2p.**
  Their ids are parametrised per doc block in file order, so a block inserted
  mid-file renumbers everything after it.
- `tests/data/` and `tests/golden/` are restored from base and digest-pinned
  alongside the graded sources, so a submission cannot rewrite the plans or the
  recorded answers its graded cases are measured against.


### counted-sections: built 2026-09-04

Draft `7qYTzMwhbjTvnEMFuKUY` (created by the user), base 97db2aa, env v2.

Bundle at `tasks/counted-sections/`, work tree `tasks/counted-sections/work`
(branches: `main` at base, `solution`, `heldout`). Local image `signalbox-cs:v2`
built from `cs-env/Dockerfile`, the real env-log v2 Step lines.

Floors from `gold_bot.py check`, all green:

| | |
| --- | --- |
| solution | +732 / -38 over 20 files (floor 459 / 4) |
| held-out tests | +725 over 2 files (floor 596 / 2) |
| test band | 725 in [716, 732) |
| instruction | 298 words (100 to 300) |
| f2p / p2p | 69 / 2065 (floors 8 / 50) |
| lines per word | 2.37 (0.9 to 7.5) |

The feature: a counted section is bounded by counting heads, one on each of its
own legs a train can leave by onto track it does not cover, none at a buffer
stop, one at a scheme boundary, and named for the node except where the plan
names legs. Counted sections a train runs directly between form a reset zone.
The zone reaches the interchange file as `zone` and `heads` on section records,
the locking table as a `zones` column, and route release as `complete` where a
route's track lies wholly inside one zone. One new rule, `detection-zone`.

Two things that cost time and are worth knowing on this repo:

- **The verifier machinery needed one change.** Ported from
  `maingott/tasks/narration-takes/local/make_test_sh.py`. That image had the
  package installed through a `.pth`; this one has it only on `PYTHONPATH`,
  which the block unsets. The child now appends `/app/src` as well as `/app`
  after the framework is imported. Without it every id in both rows failed and
  the reports looked like a broken task rather than a path problem.
- **17 of the first 69 fail-to-pass ids passed at base.** They were regression
  guards, true before the change as well as after. Each now carries a positive
  assertion in the same function, per the paleostride lesson that a negative
  guard is vacuous as an f2p.

### Pipeline record, three submissions

| round | verdict | what moved |
| --- | --- | --- |
| 1 | Validation Failed at quality review, `behavior_in_tests` | The CLI test asserted the signal name only, so an implementation printing no reason still scored 1. The instruction promised the command says why. |
| 2 | Validation Failed at Calibration II, `out_of_band_hard`, 0 of 8 | Every trial scored p2p 273/273 and f2p 64 to 71 of 73. Not difficulty: three contracts my cases enforced and my instruction never stated. |
| 3 | **passed all 8**, Calibration I 0 of 5, status Needs Review | Instruction only. No code, no assertion dropped. |

Round 1 fix: the instruction now promises the command **names** the routes a signal
had a choice of, or the points wanting moved, and four cases assert exactly those
names, taken from the scheme plan rather than from any phrase the reference prints.
Assertions strip whitespace first, since a rich table folds a long cell across lines.

Round 2 diagnosis, from all eight trial reports rather than from the number:

| failing id | trials |
| --- | --- |
| five `signalbox automatic` cases | 6 to 7 of 8 |
| `test_giving_back_a_signal_nobody_took_away_is_refused` | 5 |
| `test_the_signal_comes_back_behind_the_train` | 4 |
| `test_a_train_running_out_of_the_section_gives_the_route_back` | 4 |
| `test_replacing_twice_is_refused` | 4 |

The CLI cluster was one line of raw output away from obvious: a trial printed a
perfect table, `S1(MA), S1(MB)` and all, and **exited 1 because it had found
faults**, which is what `signalbox check` does. The exit status was never stated.
Replaying the eight reports against the fixed id set predicted 4 of 8 fully green,
and the remaining four all failing on the same single behaviour: an automatic route
taking its track back once a train has left a route holding one section. That
sentence was deliberately left untouched; it is the difficulty, and half the field
misses it.

Round 3 added, in the instruction only: the command reads rather than judges so its
status stays zero, and replacement is refused for a signal trains do not work, for
one already replaced, and for one nobody took away.

Two ciChecks warnings rode through all three rounds and never blocked anything:
solution 520 lines against a recommended 525, instruction 282 words against an aim
of 250.


### Pipeline record: five submissions, 2026-09-04

| round | verdict | what it was, and the fix |
| --- | --- | --- |
| 1 | quality_check **fail** (4 criteria) | One case asserted the exact end coordinate `start + length` is restricted. A half-open reading of a length is as legitimate and the instruction settled neither, which read as under-specification, over-pinning and a missing contract all at once. Fixed by sampling a metre inside the far end. Two more cases added for attributes through the formatter and through `include`, and the stale "set-operation tests" header from the repo the verifier came from was rewritten. |
| 2 | quality_check **fail** (behavior_in_tests) | Both include cases put the restriction in the INCLUDING file, so nothing forced `SchemeDecl.merge` to carry restrictions. Rewritten so the slack is declared in the included file; deleting the merge line now fails three cases and failed none before. |
| 3 | difficulty_probe **out_of_band_hard**, 0 of 8 | Not difficulty: every trial passed 362 to 365 of 366 graded cases and all eight failed the SAME one. `approach_for` returning `None` for "no room" is as good a reading of "nothing where no room is left" as an approach whose `board` is None, and the reference took the other. Fixed with two readers in the suite (a missing approach means no board and a braking run of zero), asserting nothing less. Proved by replaying four trial patches: three went to all-green, the fourth kept failing only the gradient case. |
| 4 | difficulty_probe **too_easy**, 8 of 8 | The eight solving patches were pulled and eleven candidate assertions run against them. Ten passed on every build; the one that failed everywhere pinned an ordering nobody was told about and was discarded. No lever in extra surface, so the calculation itself changed. |
| 5 | **PASSED all 8** | Approach braking is now integrated backwards over the profile rather than worked against the worst gradient: at the far end of each stretch the train was doing whatever that stretch's own gradient leaves it, braking begins inside the stretch where that reaches line speed, reaction at line speed in front. Same two gradients in opposite order give 890.5m and 833.1m, against 817.8m level and 915.7m for the old worst-gradient rule, so two cases separate them. All eight round-4 builds fail the new suite. The `restrictions` command sentence and its four cases came out to pay for the words. |

Calibration I: 0 of 5 solved, pass. Calibration II: pass. Run audit: pass.
Standing warning through every round, never blocking: `instruction-above-recommended`,
298 words against a recommended 250.

### The lesson worth keeping

Two probe verdicts in a row were about the SHAPE of an answer, not its
difficulty. `out_of_band_hard` at 0 of 8 with every trial one case short is an
unstated or over-pinned contract, and `too_easy` at 8 of 8 is a task whose
hardest step is a closed form. Replacing a closed form with a quantity that has
to be integrated over the layout, where the same ingredients in a different
order give a different answer, is what moved the number.

### counted-sections round 7 — failure_validation, reward_hacking 2 of 8

difficultyProbe passed, so the round-6 changelog clause did not disturb the band.
failure_validation failed again: reward_hacking 2 fail, the other three criteria
clean.

The difficulty run's artefacts are not readable (`trials: []` on the pipeline
node, and `runs.files` 404s for that runId in both rounds). The easiness probe
of the same round is readable and runs the same agent under the same pressure,
so the five `probe/<trial>/artifacts/model.patch` files there are the evidence.

Four of five trials touch only their own new tests, plus the goldens the
instruction already says move. Two edit an existing graded assertion in
`tests/tables/test_locking_table.py`, and nothing else in the run does:

    -    row = LockingRow("K1(M)", ("TB-AB",), (), "sectional", ("TB-AB",), (), ())
    +    row = LockingRow("K1(M)", ("TB-AB",), (), "sectional", (), ("TB-AB",), (), ())

One reorders the positional arguments, the other bumps the arity. Both are
reacting to the same thing: they put the new `zones` field beside the other
holding-related fields, which breaks `test_rows_print_what_they_hold` (seven
positional arguments), and then repair the test rather than the design.

That pressure was mine. The reference already puts `zones` last with a default
of `()` precisely so that base test keeps working — the instruction never said
so, leaving the solver to discover the constraint by breaking a graded test.
Fixed by stating the contract:

    Locking table grows a zones column, last and defaulted, so rows built the
    old way still build.

No code change; the reference already behaved this way. 292 words, floors green,
both rows re-verified (solution reward 1 at 69/69 and 2065/2065, base reward 0 at
0/69). Mutants not re-run: solution and held-out tests are byte-identical to the
round-7 bundle that caught 11 of 11.
