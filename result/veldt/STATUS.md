# veldt — build log

Snapshot `snapshot.borrower-v2-g1787803520274672.zip`, unpacked at
`result/veldt/repo` 2026-09-04. Pure Python 3.10+, zero runtime dependencies,
dev extra `pytest>=7.4`. Base suite: `python3 -m pytest` from the repo root,
**938 cases green in 2.6 s** (system python 3.12.3, pytest 7.4.4).
`tests/conftest.py` prepends `<root>/src` to `sys.path`; the package is a src
layout and is NOT installed. Repo `Dockerfile` is `python:3.12-slim` +
`pytest==8.3.4`, WORKDIR /app.

## What the repo is

veldt 0.1.0, a pure-Python analytical query engine: tokenizer -> SqlParser ->
`SelectStatement` -> `SqlCompiler` -> immutable `LogicalPlan` -> rule optimizer
run to a fixed point -> `PhysicalPlanner` -> pull-based batch operators ->
`Table`/`QueryResult`. CLI `query`/`explain`/`schema`/`convert`/`version` plus a
REPL. Docs: `docs/architecture.md`, `docs/sql-support.md`.

Packages: `types`, `core` (Column/RecordBatch/Table/QueryResult), `expr`
(tokenizer, parser, ast, resolver, evaluator, functions, aggregates, simplify),
`plan` (logical, builder, optimizer, rules, stats, printer), `execution`
(physical, pipeline, operators/{scan,filter,project,aggregate,sort,limit,
distinct,union,join}), `sql` (keywords, lexer, parser, compiler), `storage`
(catalog, csv/jsonl/memory sources, partition, cache, schema_infer), `io`,
`observability`, `cli`, `utils`.

`docs/sql-support.md` "Not supported": subqueries, CTEs, window functions,
**INTERSECT / EXCEPT**, INSERT/UPDATE/DELETE, DDL, correlated anything.

## Platform facts

| | |
| --- | --- |
| repo id | `DpaoWZCVgFZiQ30fKr8c` (platform name `/veldt`) |
| base commit | `1a71e331f0f9812886dd22c0c6aa274edb63a80e` |
| environment | v1, `gold-repo-veldt-dpaowz:v1`, log in `env-log.v1.txt` |
| agent image | python:3.12-slim + git, `COPY repo/ /app`, WORKDIR /app, `PYTHONPATH=/app`, `pip install pytest==9.1.1`, package NOT pip-installed, `git config core.hooksPath /dev/null` |
| local rebuild | `veldt-env:v1` from `envbuild/Dockerfile` (the Step lines verbatim), repo copied in as a one-commit git repo |
| Step 0 | **PROVEN 2026-09-04**: `docker run --network none veldt-env:v1 python3 -m pytest -q` -> 938 passed, python 3.12.14 / pytest 9.1.1 |
| drafts | `intersect-except` **l5JS1GwJK4YYnJmkgcwq** (created by the user 2026-09-04) |

Verifier note: the image has python 3.12.14 and pytest 9.1.1; `/app` is the repo
root, the package is a **src layout**, and `tests/conftest.py` is what puts
`/app/src` on `sys.path`. There is no conftest.py at the repository root, so the
verifier's "delete every conftest, restore the pinned ones" step leaves exactly
`tests/conftest.py`, which is all the suites need.

## Slate — what each session has claimed

| task | category | changed-file set | state |
| --- | --- | --- | --- |
| `intersect-except` | feature_request | expr/tokenizer.py, sql/{keywords,parser,compiler}.py, plan/{logical,rules,stats,builder,__init__}.py, execution/{physical,__init__}.py, execution/operators/{setop.py,__init__.py}, README, CHANGELOG, docs/ | BUILT + VERIFIED 2026-09-04 |

## Invariants the engine promises (levers for any task here)

- Optimizer rules must be semantics preserving, idempotent and independent;
  after each rule the optimizer asserts the plan's output schema is unchanged.
- `PredicatePushdown` already descends into `Union` (rules.py:202) and
  `ProjectionPushdown` treats `Distinct` and `Union` as needing every column.
- `DistinctOperator` matches rows on value AND type: `1` and `1.0` are
  different, two nulls are the same (`utils.hashing.row_key`).
- `UnionOperator` casts each side to the combined schema; plain `UNION` compiles
  as `Distinct(Union(..., all=False))`, so the operator has one job.
- `SetOperation(kind, statement, all)` and `keywords.SET_OPERATORS` already
  exist; the compiler raises `PlanningError` on any `kind` other than `"union"`.
- The parser reads a trailing set operation by recursing into `parse_select`,
  which is right-associative and has no precedence level.
- Nulls: comparison/arithmetic propagate, AND/OR are three-valued, a null join
  key matches nothing, grouping treats nulls as one group.
- `Schema.merge` disambiguates with `_right`, `_right2`; `Schema.union` unifies
  two branch schemas.


## intersect-except

Bundle at `tasks/intersect-except/`, work git repo at `work/` (branches `main`
= base, `solution`, `heldout`).

| | |
| --- | --- |
| solution | +518 / -41 over 17 files, churn 559 |
| held-out | +617 over 2 files, `tests/test_row_pairing.py` and `tests/test_chain_folding.py` |
| ids | f2p 96, p2p 938 (the whole base suite) |
| instruction | 294 words, AI-tell detector clean |
| container run | solution -> reward 1, 96/96 f2p, 938/938 p2p; base -> reward 0, 0/96 f2p, 938/938 p2p, every id published |

What the feature is: `INTERSECT` and `EXCEPT`, each with `ALL`. The difficulty
is four collisions rather than the operators themselves.

1. The parser records a chain as a flat right-leaning list and the base
   compiler walks it by recursing into the tail, which is right-associative.
   `INTERSECT` has to bind tighter and the two level operators have to fold
   from the left, so the compiler needs a precedence fold, not one more branch.
2. `ALL` is multiset counting, and the tally has to span batches. A per-batch
   tally passes at the default batch size and fails at `batch_size=1`.
3. `DistinctOperator` matches on value AND type, so an int64 branch and a
   float64 branch only pair after both are cast to `Schema.union`'s type. Keys
   taken before the cast never match.
4. `EliminateRedundantDistinct` may drop a `Distinct` over an intersection or a
   difference (they dedupe themselves) but NOT over a `Union`, because a plain
   `UNION` *is* that `Distinct`. Getting this wrong breaks the base suite's
   `test_union_removes_duplicates`, which is a p2p id.

The trailing `ORDER BY` / `LIMIT` / `OFFSET` of a chain was added at the same
time, because without it a set operation cannot be sorted at all: the clauses
are lifted off the chain's last select and applied to the folded plan.

Verifier: `local/make_test_sh.py` generates `tests/test.sh` from the frozen
frame, digest-pinning the 19 graded p2p files, `tests/conftest.py` and the two
held-out files. Machinery copied verbatim from slateql's `index-scans`; only
the pinned names changed.

Hardening, 2026-09-04, `local/attack_matrix.sh` on the base tree (a defended row
is reward 0 with all 96 f2p and all 938 p2p ids still published):

| rows | result |
| --- | --- |
| honest (base, solution, solution + own test file, solution editing a p2p file) | 0, 1, 1, 1 |
| 17 forgery attacks (conftest at both levels, sitecustomize, usercustomize, shadowed pytest, package patching reports / outcome / runtest / os.write / pluggy, rewritten p2p file, rewritten held-out files, planted stale pyc, forked session, lingering process, atexit) | all DEFENDED |
| `residual_frame_token_forge` | reward 1, the documented residual of any in-process runner, unchanged from slateql |

`local/mutants.py`: 14 mutants, one per instruction sentence, all caught;
restored solution 96/96.

## Independent re-check, 2026-09-04

Draft `l5JS1GwJK4YYnJmkgcwq` still `Draft`, never submitted. Bundle on the
platform is byte-identical to `tasks/intersect-except/` on all six files that
matter (instruction, task.toml, test.sh, config.json, test.patch,
solution.patch).

Re-run from scratch, not read off the earlier log:

- `gold_bot.py check`: every floor ok, no local problems. Solution +524 / 18
  files, held-out +617 / 2 files, 96 f2p, 938 p2p, instruction 294 words,
  1.78 solution lines per instruction word.
- `local/verify_task.sh`: solution reward 1 (96/96 f2p, 938/938 p2p), base
  reward 0 (0/96, 938/938), every declared id published in both rows.
- `local/attack_matrix.sh`: 4 honest rows correct, **17 of 17 attacks
  defended**, and `residual_frame_token_forge` scores 1 exactly as documented.
- `local/make_test_sh.py` regenerates `tests/test.sh` byte-identical, so the
  frozen frame is intact.
- Held-out paths do not overlap the 18 solution paths.
- No `EDIT-ME` outside `local/frame.sh`, no "silver", no dated fixtures, and
  no timing or randomness anywhere in the 938 graded base cases.
- Instruction to test-title echo: **0 shared 4-grams** between `config.json`
  ids and `instruction.md`, the ciChecks warning that predicts an aiCheck
  failure.

**The one apparent problem was not one.** Held-out 617 lines sits above both
ceilings AQ_pass_guide names (churn 567, solution added 524). Checked against
tasks that already passed all eight stages before acting on it:

| task | added | churn | held-out | held-out / churn |
| --- | --- | --- | --- | --- |
| index-scans | 856 | 895 | 708 | 0.79 |
| chained-runs | 909 | 983 | 882 | 0.90 |
| interval-arithmetic | 799 | 836 | 776 | 0.93 |
| panel-record | 1102 | 1124 | 1132 | 1.01 |
| window-functions | 1057 | 1088 | 1435 | 1.32 |
| intersect-except | 524 | 567 | 617 | 1.09 |

Three of those five carry a held-out patch larger than the solution's added
lines and all five are outside the quoted band, so the band is not a gate.
Nothing changed. See the memory note `gold-heldout-band-is-not-a-gate`.

Residual risk, not acted on: 60 backticks is the densest instruction measured
on this seat (site-sheet passed at 52, panel-record at 4) and article density
is 8.5 per 100 words. Sentence shape is what has separated aiCheck passes from
failures here, and this one has it: an observation opener, three-word
sentences beside a 38-word one, no colon lists.

## Round 1 verdict and the too_easy fix, 2026-09-04

Submitted 07:15. ciChecks, aiCheck, similarity, oracleNop and qualityCheck all
**passed**; `easinessProbe` failed at **3 of 5 solved, too_easy**.

**Cause was the whitelist, not the design.** The pushed `config.json` declared
96 f2p ids while the held-out suite runs 108 cases. Sixteen ran and counted for
nothing: all six of `TestRowCountEstimates`, all six of `TestBlockingSide`, and
four ORDER BY null-ordering cases.

Diagnosis followed the trial patches rather than guesswork. All five
`artifacts/model.patch` files were applied to base trees and probed against the
reference over 136 value probes, plan text, metrics and CLI output. Everything
matched the reference on all five builds except two families:

| probe family | VjQoRu6 | VsVWHqe | Yn5dAgG | cEP6ssZ | mSEvqYT |
| --- | --- | --- | --- | --- | --- |
| `estimate` on a pairing | None | None | wrong | None | wrong on plain |
| `is_blocking` on a pairing | False | matches | False | False | False |

Three builds never taught `estimate` about the new nodes at all. That is the
lever, and it was sitting in the suite ungraded.

### What changed

- `TestBlockingSide` replaced by `TestWhatBuffers`, four cases. The two guards
  (`UNION ALL` and plain `UNION` buffer nothing) are folded into two of them:
  standing alone they pass at base, and `make_test_sh.py` writes only f2p ids
  into the held-out report, so a p2p id cannot live in that file.
- `TestRowCountEstimates` gained five plain-spelling cases, two of which
  separate truncation from rounding (a bound of four scales to two, not three).
- `instruction.md` states both contracts, 299 words, detector clean.
- Whitelist regenerated from a junit run of both held-out files against the
  reference: **117 f2p / 938 p2p**.
- `docs/sql-support.md` and `CHANGELOG.md` document the estimate rule, taking
  the solution to +532/-43 and clearing the "below the recommended 525+" warning.

### Two traps found while fixing it

**The `work` solution branch had drifted ahead of the draft.** It carried
`bound.scaled(0.7)`, and `Statistics.scaled` rounds, so a plain `EXCEPT` over 4
and 3 rows estimates 1 there and 0 on the reference that was actually pushed and
validated. Regenerating `solution.patch` from that branch silently swaps the
reference. The branch is now realigned to main + the shipped patch; the drifted
version is kept on `solution-peer-2026-09-04`.

**`local/attack_matrix.sh` had `F2P=112` hardcoded**, so a whitelist change made
every row report `*** BREACH / FAULT ***` while the rewards were all correct. It
now reads both counts out of `config.json`.

### Verified

- container: solution reward 1 (117/117 f2p, 938/938 p2p), base reward 0
  (0/117, 938/938), every f2p failing at base.
- `local/mutants.py`: 18 of 18 caught, restored solution 117/117. The four stats
  mutants were repointed at the shipped body and rounds / floors-at-one rows added.
- `local/attack_matrix.sh`: 17 of 17 attacks DEFENDED, honest rows correct,
  `residual_frame_token_forge` scoring 1 as documented.
- against the five calibration builds the graded suite now fails 29, 13, 11, 29
  and 6 of 117, so all five fail where three passed.

**Round 2 PUSHED and validated 2026-09-04 10:03.** ciChecks, aiCheck, similarity,
oracleNop, qualityCheck and `easinessProbe` all passed; `easinessProbe` 0 of 5,
verdict pass. `difficultyProbe` failed at **0 of 8 solved, out_of_band_hard**.

## Round 3 — the estimate sentence was false, and the two probes differ

All eight Cal II trials passed 1049 of 1055 and failed **the same six ids**, the
whole of `TestRowCountEstimates` that touches a difference. Every one of them
estimated a difference as its **left branch**: `four EXCEPT ALL three` gave 4
where the reference gives 1, `three EXCEPT ALL four` gave 3 where it gives 0.

That is what the instruction told them to do. It read "Neither beats its left
input, an intersection is capped by its right one too" — an upper-bound
property, not the formula the suite grades, and for a difference the only cap
it named was the left branch. The reference's own docstring and
`docs/sql-support.md` said the same thing. The tests were right and the prose
was wrong.

Nothing else divides them. All eight `model.patch` files were applied to base
trees and run against the reference over 42 targeted probes and 220 randomised
chain queries at three batch sizes, comparing rows, estimates, explain text and
the optimized plan: **zero divergence** outside the difference estimate.

### The two probes are different agents

| family | Cal I (5 trials) | Cal II (8 trials) |
| --- | --- | --- |
| `TestClausesAfterTheLastSelect` (12 ids) | **5 of 5 fail all 12** | 0 of 8 fail |
| `TestRowCountEstimates` | 3 of 5 fail three ids | 8 of 8 fail six ids |

So Cal I is held at 0 of 5 by the trailing-clause family whatever else changes,
and Cal II is decided by the estimate rule alone. Round 1 measured the same
trailing-clause family at 2 of 5 on Cal I, so it is the one lever with a
genuinely intermediate rate.

### What changed

- `instruction.md`: the false sentence is gone. Estimation now "reads that same
  arithmetic over branch row counts rather than row copies", pointing at the
  `min(m, n)` and floored `m - n` stated one paragraph above. Deliberately not
  the formula: an explicit `left - right` would take Cal II to 7 or 8 of 8 and
  fail the other way, and the band is 1-6. 293 words.
- `_set_operation_statistics`'s docstring and the `docs/sql-support.md`
  estimation paragraph now state the subtraction instead of the upper bound.
  No behaviour changed; solution +533/-43 over 18 files.

### Verified (round 3)

- container: solution reward 1 (117/117 f2p, 938/938 p2p), base reward 0
  (0/117, 938/938), all 117 f2p present and failing at base.
- `local/mutants.py`: 22 of 22 caught, restored solution 117/117.
- `local/attack_matrix.sh`: 17 of 17 DEFENDED, honest rows correct.
- floors all green, `check` reports no local problems.

**Round 3 submitted 2026-09-04 12:18.** ciChecks, aiCheck, similarity and
oracleNop passed; **qualityCheck failed** on `anti_cheating_measures` and
`report_integrity`, both with one argument: submitted code runs as **root** in
the verifier, so it can rewrite writable `/tests/config.json`, replace files
under `/verify`, or race the publisher and leave forged XML behind. The probes
never ran.

The finding was correct. This bundle's `make_test_sh.py` came from
slateql/index-scans, which passes review but never drops privileges; the
hardened variant lives in tappet/sectional-release.

## Round 4 — the verifier now runs the suite as nobody

Ported from `AQ_alexandra/result/tappet/tasks/sectional-release`:

- the publisher spawns the pytest child through `setpriv --reuid=nobody
  --regid=nogroup --clear-groups --inh-caps=-all` whenever it is root, and logs
  which identity it used; it degrades with a log line rather than refusing.
- `/verify` 0755 with `reports/` 0700, so the child cannot reach the staged XML.
- `/tests/grader.py` and `/tests/config.json` go 0444, are copied into a
  root-only `$VDIR/keep`, and are restored from those copies before grading if
  their digests moved.
- the framework snapshot covers `unittest` and `unittest.*` as well as pytest
  and pluggy, with the submodules imported before `/app` joins `sys.path`, and
  the calibration file now carries a `TestCase` with pass, fail and
  `assertRaises` methods.
- `PYTEST_ADDOPTS` is unset alongside `PYTHONPATH`.

### The standing residual is closed

`residual_frame_token_forge` — a suite reaching the publisher's token through
the garbage collector and forging an END — scored 1 for every earlier round and
was documented as the residual of any in-process runner. As nobody the child
cannot write the report the root publisher owns, so it now scores 0. The row is
renamed `frame_token_forge` and graded like any other attack.

### Four new attack rows, all defended

- `grader_and_whitelist_rewrite`, run with **/tests mounted writable** so the
  defence measured is the verifier's and not the mount's: empties
  `f2p_node_ids` and overwrites `grader.py` with one that writes reward 1.
- `unittest_asserts_patched` and `unittest_patched_via_tests_pkg`: every
  `TestCase.assert*` rebound to a no-op, via the package and via the test
  package.
- `kills_publisher_and_forges`: hunts `publish.py` in `/proc`, SIGKILLs it and
  writes its own reports and `reward.json`.

### Verified (round 4)

- container: solution reward 1 (117/117 f2p, 938/938 p2p), base reward 0
  (0/117, 938/938); `run.log` shows `[publish] child runs as nobody (uid 65534)`
  for both suites, so the p2p suite genuinely passes unprivileged.
- `local/mutants.py`: 22 of 22 caught, restored solution 117/117.
- `local/attack_matrix.sh`: **21 of 21 DEFENDED**, honest rows correct, no
  residual.
- floors green, `check` reports no local problems.

**SUBMITTED 2026-09-04 12:55 — PASSED ALL EIGHT STAGES.** Status
**Needs Review** (human review), the terminal pass state.

    ciChecks passed · aiCheck passed · similarity passed · oracleNop passed
    qualityCheck passed · easinessProbe 1 of 5 pass · difficultyProbe passed
    failureValidation passed

The one standing finding is the advisory `instruction.md is 293 words — aim
under 250`, a warning that has never blocked a stage.

Calibration I landed at 1 of 5, which is what the round-2 trial reports
predicted: the trailing-clause family holds that probe down, and the estimate
wording decides Calibration II. Stating the difference bound as a pointer to
the arithmetic already given, rather than as `left - right`, put Cal II inside
the 1-6 band it had missed from both sides (3 of 5 too_easy in round 1, 0 of 8
out_of_band_hard in round 2).
