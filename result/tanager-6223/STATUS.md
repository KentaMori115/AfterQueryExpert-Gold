# tanager (snapshot.borrower-v2-g1785207711975813) — session mindriftwork-ab

Rust, ~8.7k lines of `src`, zero external dependencies. An embeddable in-memory
analytical SQL engine: lexer, Pratt parser, binder, rule optimizer, materializing
executor, columnar storage. Base suite green offline: 302 cases (180 integration in
`tests/*.rs`, the rest unit tests under `src/**`), rustc 1.98.

Four sessions unpacked this snapshot at the same minute. Claims settled by message:

| session | work dir | gap |
| --- | --- | --- |
| mindriftwork-ab (this one) | `result/tanager-6223` | `UPDATE` + `DELETE` |
| mindriftwork-62 | `result/tanager-1f45` | set operations |
| mindriftwork-33 | `result/tanager` | subqueries |
| mindriftwork-b8 | `result/tanager-7c3a` | RIGHT / FULL / CROSS JOIN + USING |

Three of the four had claimed set operations within one minute of each other; two moved
after being told.

## Task 1: row-mutation (category `feature_request`)

Draft `VudIGx7iVZIpWmxzyVBJ`, repo `2Z9OHwYvfPnfAYyrEo0D`, base commit
`928c0b74375a634051b81bae1e4032c9e4c86ac7`, environment image v3.

`docs/DESIGN.md` lists no persistence, transactions, indexes, subqueries or set
operations. It does not mention row mutation, and the README grammar is
`statement := select | insert | create_table | drop_table`: the engine can put rows in
and can never change or remove one. That is the gap.

Files touched (disjoint from every peer on `src/storage/**` and the `src/api.rs` mutation
path): `src/parser/keyword.rs`, `src/parser/parser.rs`, `src/ast/statement.rs`,
NEW `src/planner/dml.rs`, `src/planner/mod.rs`, `src/storage/column.rs`,
`src/storage/table.rs`, `src/api.rs`, `src/bin/tanager.rs`, plus README, CHANGELOG and
`docs/DESIGN.md`.

### What the contract makes hard

Difficulty is in the collisions with what the engine already promises, not in surface:

- assignments read the pre-statement row, so `SET a = b, b = a` swaps rather than copies;
- `Outcome::Updated` counts rows whose stored values *differ*, so a matched row that
  comes out identical is not counted. An `INTEGER` 8 assigned to a `FLOAT` column holding
  8.0 has to compare equal *after* widening, and a `NULL` over a `NULL` is not a change;
- every candidate row is validated before any column moves, so a row that fails late
  leaves the whole table untouched;
- only rows whose `WHERE` is exactly `TRUE` are touched, so unknown leaves a row alone in
  every form, including under `NOT`;
- survivors of a `DELETE` keep their stored order, which means compacting every column
  vector rather than rebuilding the table.

### Numbers

| | measured | floor |
| --- | --- | --- |
| solution | 672 added / 18 removed, churn 690, 12 files | 459 lines / 4 files |
| held-out | 661 lines, 7 files | 596 lines / 2 files |
| f2p | 53 cases (`tests/set_assignments.rs` 31, `tests/row_deletion.rs` 22) | 8 |
| p2p | 68 cases over 5 inherited targets | 50 |
| instruction | 285 words, detector clean | 100 to 300 |

`gold_bot.py check`: every floor green, no local problems, bundle 114 KB of 900 KB.

The five inherited p2p files carry a small appended case each and ride in `test.patch`
on purpose: `grader.py prepare` resets every path the patch names back to the base commit
before applying it, so a submission's edits to the existing suite are undone rather than
graded.

Both held-out files fail to compile at the base commit (`Outcome::Updated` and
`Outcome::Deleted` do not exist there), so all 53 ids fail at base and pass with the
reference. Full suite with the reference applied: 377 passed, 0 failed.

### Step 0, the environment

`env-log 2Z9OHwYvfPnfAYyrEo0D 3` builds `rust:1.92-slim-bookworm`, installs git and
python3, copies the repo to `/app`, installs `cargo-nextest 0.9.143`, then runs
`cargo build --all-targets --locked` and `cargo build --release --locked`. Everything the
verifier needs is there, and the crate has zero external dependencies, so `--offline`
costs nothing. `environment.v3.Dockerfile` is the local mirror those steps were rebuilt
from; it omits the nextest install, which the block never calls.

### The verifier

Ported from `result/fwctl/tasks/staged-activation`, which passed all eight stages on
2026-09-04. `make_test_sh.py` writes `tests/test.sh` from the draft's own frozen frame and
asserts every byte outside the markers is unmoved. The block builds from a private copy of
`/app`, plants random pass/fail cases in the held-back files before compiling, pins the
seven graded sources by digest taken after that, compiles each target on its own (never
`--tests`), moves the sources out of reach, runs each binary directly as an unprivileged
user, and holds every run to its own `--list` output, libtest's trailer and its logfile
before believing a verdict. The declared id set comes from `/tests/config.json`, so a
target that will not compile publishes its ids as failed rather than as nothing.

### The battery

23 rows, each a whole submission run in a real container against the shipped `test.sh`.

| row | f2p | p2p | reward |
| --- | --- | --- | --- |
| oracle | 53 | 68 | 1 |
| base, empty | 0 | 68 | 0 |
| 12 mutations of the reference | 39 to 52 | 68 | 0 |
| 4 attacks (build.rs, cargo runner, `harness = false`, a target claiming a graded name) | 0 | 0 | 0 |
| 4 benign submissions (manifest profile, gutted inherited suite, harmless cargo config, own tests added) | 53 | 68 | 1 |

Every attack was refused by name in the log rather than by accident. Every benign row
graded normally, including the one that rewrites an inherited suite: `test.patch` names
that file, so `prepare` restores it from the base commit.

One row scored 53 of 53 and took three runs to explain. Dropping the bind-time assignment
check in `planner/dml.rs` costs nothing, because storage coerces on the way in and raises
the same `Type` error. Dropping the storage arm costs nothing either, because the
bind-time check stands in front of it. Neither guard alone can show a loss: they are
redundant with each other by design, fail fast at bind time and correct at write time.
Removing **both** is the honest mutation, and `nothing_checks_an_assigned_type` scores
**50 of 53**, so the rule is graded. The two single-guard rows now run as benign rows with
their measured 53 of 53, and `writes_rows_without_checking_them`, which bypasses the
coercion entirely, costs 8.

Final tally: 13 mutations all cost graded cases (39 to 52 of 53), 4 attacks refused by
name, 6 benign submissions graded normally.

### Two hazards this box added

- **Docker tags are global.** Four sessions built `tanager-verify:local` from four
  different bundles. 16 of 20 rows in the first battery graded a peer's ids, reading
  "P2P 99/99, F2P 0/48" with `bounded_branches.*` failures. Tags are now
  `tanager-6223-env:v3` and `tanager-6223-verify:local`.
- **`/tmp` is swept.** The second battery lost its work tree mid-run to somebody else's
  cleanup. The work tree now lives under `result/tanager-6223/battery`.

### Rounds

1. 19:01, aiCheck failed. Instruction was rule-per-sentence with about 30 backticks.
2. 19:03, aiCheck failed again on a flowing-prose rewrite, 294 words, zero backticks.
3. 19:05, **aiCheck passed** at 252 words in the clipped register the seat's other passing
   instructions use. `instruction.aicheck-passed.md` holds that exact text; a later stage
   gets only the clause it names changed.

### State: PASSED all eight stages, 2026-09-05 23:45 UTC

Draft `VudIGx7iVZIpWmxzyVBJ` is terminal at **Needs Review**, the human queue that
follows a clean automated run.

| stage | verdict |
| --- | --- |
| ciChecks | passed (one warning: 252 words, aim under 250) |
| aiCheck | passed |
| similarity | passed |
| oracleNop | passed |
| qualityCheck | passed |
| easinessProbe (Cal I) | passed, 0 of 5 solved |
| difficultyProbe (Cal II) | passed |
| failureValidation | passed |

Nothing more is pushed to this draft.

- reference solution, held-out tests and instruction: built and verified
- bundle: generated, `gold_bot.py check` clean, pushed to the draft
- bidirectional audit (`audit_instruction.py`): 53 cases, 15 stated rules, 0 findings

### One misread worth recording

While Cal II was still marked `running`, its partial `probe/result.json` was read as
"all eight trials solved it", which against the 1-6 band reads as `too_easy`. That was
wrong: the aggregate block in a probe `result.json` is not the per-trial agent tally,
and the platform's own verdict was `passed`. The rule that follows is
[[gold-calibration-read-the-verdict-not-the-artefact]]: a probe artefact read before the
stage settles is not a verdict, and an in-flight run must not drive a redesign.

An ORDER BY/LIMIT extension for `UPDATE`/`DELETE` was part-built on that misread and has
been reverted; `work/` is clean and matches the validated reference.
