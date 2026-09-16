# tanager (result/tanager-7c3a) — session mindriftwork-b8

Snapshot: `snapshot.borrower-v2-g1785207711975813.zip` (Rust, zero dependencies,
`rust-version = "1.92"`, 8723 lines under `src/`).
Base suite: **302 green** offline under rustc 1.98 (299 in test binaries + 3 doctests).

## Claim board (4 sessions on this one snapshot)

| session | work dir | gap |
| --- | --- | --- |
| mindriftwork-ab | result/tanager-6223 | UPDATE + DELETE DML |
| mindriftwork-62 | result/tanager-1f45 | subqueries |
| mindriftwork-33 | result/tanager | set operations |
| **mindriftwork-b8 (this one)** | **result/tanager-7c3a** | **join variants** |

## Claimed here

**Task name:** `join-variants`  ·  **Category:** `feature_request`

RIGHT / FULL OUTER / CROSS JOIN, plus the `USING (col, ...)` constraint.

Changed-file set:

- src/parser/keyword.rs — Right, Full, Cross, Outer, Using
- src/parser/parser.rs — join head forms, USING list, CROSS rejects ON
- src/ast/statement.rs — JoinType variants, JoinConstraint enum
- src/ast/display.rs — rendering
- src/planner/scope.rs — merged USING columns and re-indexing
- src/planner/binder.rs — constraint binding, merged schema, nullability widening
- src/planner/logical.rs — node detail
- src/exec/join_exec.rs — right / full / cross execution, merged column values
- src/optimizer/predicate_pushdown.rs — legality per join type

Not touched: src/storage/**, src/api.rs, src/ast/expr.rs, src/planner/bound.rs,
src/exec/eval.rs, src/optimizer/optimizer.rs. Disjoint from all three peers apart
from the parser/binder spine that every statement-level feature crosses.

## Why this gap carries difficulty

Two collisions with invariants the repo states out loud, rather than added surface:

1. `optimizer/predicate_pushdown.rs` pushes a left-only conjunct unconditionally
   and a right-only conjunct only for `Inner`. Both halves invert once a join can
   null-extend the left side. Wrong pushdown is silent and only shows in results.
2. `docs/DESIGN.md`: "a join's output row is left columns then right columns."
   `USING` merges the named columns to one output column each, which moves every
   positional index above it, and wildcard expansion must show it once.

## State

**PASSED all 8 stages 2026-09-05 on round 4** (status Needs Review).
Calibration I 1 of 5 solved, verdict pass. Do not push again.

First submitted 19:07, Draft `970LyQdmxRBJO86bU4z8`,
repo `2Z9OHwYvfPnfAYyrEo0D`, baseSha `928c0b74375a634051b81bae1e4032c9e4c86ac7`,
environment v3.

## Step 0: the environment can run its own suite

`env-log 2Z9OHwYvfPnfAYyrEo0D 3` is 10 steps: `rust:1.92-slim-bookworm`, git,
`COPY repo/ /app`, cargo env, apt git + python3, `cargo install cargo-nextest
--locked --version 0.9.143`, `cargo build --all-targets --locked` and
`--release --locked`, then git safe.directory and `core.hooksPath /dev/null`.
Toolchain matches `Cargo.toml`'s `rust-version = "1.92"`, python3 for grader.py
is present, and the cargo cache is warm.

Proved rather than read: rebuilt the image locally from those Step lines and ran
`cargo test --offline --locked` under `--network none`. **302 passed, 0 failed.**
`environment.v3.Dockerfile` holds the mirror. The nextest layer is left out of
the local copy only because the box OOM-killed it twice at exit 137 beside three
other Rust builds; nothing in this verifier calls nextest.

## Sizes, against this seat's floors

| artefact | value | floor |
| --- | --- | --- |
| solution | 575 added / 51 removed over 11 files | 459 lines / 4 files |
| held-out tests | 700 added over 2 files | 596 lines / 2 files |
| instruction | 267 words | 100 to 300 |
| solution lines per instruction word | 2.15 | 0.9 to 7.5 |
| f2p | 39 | 8, aim 20 |
| p2p | 92 | 50 |

`gold_bot.py check`: every floor ok, no local problems.

## Verifier

Ported from `result/fwctl/tasks/staged-activation`, which passed all 8 stages.
tanager is a single crate, so `--test <name>` selects on its own and the
workspace `-p` is gone. One change of substance:

**The inherited suites are restored from the base commit, not pinned by
content.** They live in `/app` where a solver works, and adding a case to
`tests/joins.rs` while implementing joins is ordinary work: a digest would read
that as tampering and publish all 131 ids as failed, which is exactly how
[[gold-never-content-pin-a-manifest]] zeroed eight calibration trials on fwctl.
A checkout undoes the edit instead, and it closes the same hole from the other
side, since a base suite gutted to hide a regression is replaced rather than
believed. The two held-back files stay pinned: the verifier image puts them on
disk, no honest submission writes them, and the canaries are planted there.

## Local battery: 21 rows, all as declared

Baselines: oracle f2p 39 / p2p 92 reward 1; base and empty both f2p 0 / p2p 92.

Nine mutants, each costing graded cases with p2p held at 92:

| mutant | f2p |
| --- | --- |
| pushdown keeps the old legality | 37 |
| pushdown descends through a merge | 37 |
| unmatched right rows come first | 32 |
| merged value never falls back | 35 |
| merged value keeps its own type | 38 |
| FULL drops unmatched left rows | 31 |
| FULL drops unmatched right rows | 30 |
| CROSS accepts a constraint | 35 |
| USING columns do not merge | 24 |

Five attacks, every one at f2p 0 / p2p 0 with the check that fired named:
build.rs, a cargo `rustc-wrapper`, `rust-toolchain.toml`, a `[[test]]` with
`harness = false`, and a `[[test]]` claiming a graded target name.

Four benign rows, every one at 39 / 92 reward 1: rewriting an inherited suite
(the row that proves the restore), adding its own test file, a manifest profile
tweak, and a cargo config that touches neither compiler nor runner.

## Rejection log

### Round 1 (2026-09-05 19:07) — quality review, `behavior_in_tests`

> The f2p tests cover RIGHT, FULL, CROSS, USING, ordering, errors, chaining,
> filtering, aggregation, and RIGHT/FULL OUTER, but never exercise LEFT OUTER
> JOIN. Optional OUTER after LEFT is explicitly promised and newly implemented
> by the solution, so an implementation omitting that requirement could still
> receive reward 1.

Correct. `outer_is_optional_noise` read `FULL OUTER` and `RIGHT OUTER` and not
`LEFT OUTER`, while the instruction promises the word is optional after all
three. The case now loops over all three and adds a `LEFT OUTER` reading that
checks it is still a left join. A `left_outer_is_rejected` mutant proves it
bites: f2p 38 of 39, reward 0. This is [[gold-reward-must-enforce-every-promise]]
again, and the lesson is to enumerate a promise's *branches*, not the promise.

Also cleared the ciChecks title-echo warning here, on the test side: twelve
cases renamed to say which fixture situation they read rather than restating
the rule. Longest verbatim overlap with instruction.md fell from five words to
two, with no title carrying a run of four or more. The instruction text was left
alone on purpose, per [[gold-aicheck-keep-the-passing-text]].

### Round 2 (2026-09-05 19:20) — quality review, `anti_cheating_measures` + `report_integrity`

> Compilation runs submitted Cargo configuration as root, but the manifest
> check does not reject a custom package build-script path such as
> `build = "evil.rs"`; only a root-level `build.rs` filename is rejected.

Also correct, and the more serious of the two. Refusing the *filename* refuses
nothing: `build = "src/setup.rs"` is the same arbitrary code at compile time by
another name, and it ran as root, where it could rewrite `/tests/config.json`
or a report after `verify_tests_dir after`. Three fixes:

1. **The manifest key is refused.** Any `build = ...` under `[package]`,
   `[lib]` or `[[bin]]` is tampering. This repository declares no build script
   at its base commit.
2. **`build.rs` is refused anywhere in the tree**, not only at the root.
3. **Compilation drops privilege too.** Root-compiling was the premise the
   whole finding rested on. cargo runs a build script at compile time, so a
   compile carries submitted code exactly as a run does; both now run as uid
   65534 with a scratch `CARGO_HOME`, `/tests` stays root-owned 0600, and
   `/logs/verifier` is chmod 0755 root so no straggler can swap a report
   between the last check and the grade.

The general lesson, worth carrying to the other Rust tasks: **a language's
compile step is not a safe place to run submitted configuration.** The ported
fwctl block said "compiling is safe as root" and that was wrong wherever build
scripts exist.

### Round 3 (2026-09-05 19:34) — quality review, `anti_cheating_measures` + `report_integrity` + `separate_verifier_integrity`

> The verifier makes its private BUILD_DIR, including planted hidden test
> sources, readable to the unprivileged compiler process. Its manifest scan
> does not actually reject a submitted procedural-macro crate [...] compile-time
> submitted code can therefore read those tests/canaries and can leave a process
> to tamper with writable target executables before [run_target].

Right a third time, and the failure was mine in a specific way worth naming:
round 2's fix dropped the compile to `nobody`, and then opened the private tree
with `chmod -R a+rwX` so that user could read it. But the test binaries run as
**the same** user, so `a+rwX` handed the runner read access to the very sources
whose case names it is supposed to be accounting for, and left the compiled
executables writable between compile and run. A privilege drop that shares one
identity between two phases is not a boundary.

1. **Two unprivileged identities.** Compile as uid 65533, run test binaries as
   65534. The private tree is chowned to the compile user and `go-rwx`, so the
   run user cannot read the graded sources or the canary names at all. If the
   image cannot supply a second identity the compile still drops, to the same
   user, and the log says so rather than silently compiling as root.
2. **Executables stop being writable when compilation ends.** Tree and target
   dir go back to root, target dir drops to read-and-execute, and binaries are
   copied into a root-owned 0755 `BIN_DIR` rather than the world-writable run
   directory, where a leftover process could unlink and replace one. Anything
   the compile user left running is killed before the first binary starts.
3. **Proc macros, path dependencies and workspaces are refused**, which closes
   the compile-time execution route that needs no build script at all.

The general lesson, and the one to carry: **ownership, not a mode bit.**
`a+rwX` is how a privilege drop gets undone by the same commit that adds it.

## Battery, round 4: 26 rows, all as declared

Baselines oracle 39/92 reward 1, base and empty 0/92. Ten mutants at 24 to 38
of 39 with p2p held at 92. Nine attacks at 0/0, each naming the check that
fired, including `path_dependency_with_a_build_script`, which trips three
checks at once, and `proc_macro_crate`, which trips two. Four benign rows at
39/92 reward 1.

The row that proves the isolation is the oracle, not the attacks: after the
compile drop both build-script rows would score 0/0 even if every manifest
refusal regressed, because /tests is root-owned 0600 and the compiler is no
longer root. Only the oracle fails if the drop breaks something real, and it
holds at 39/92 with "test binaries run as uid 65534; compiles run as uid 65533"
and all 6 planted checks reporting.

The regression that mattered after dropping compile privilege is the oracle,
and it still reaches 39/92; the log confirms `setpriv --reuid=65534` fired
rather than degrading to root.

## Open warning, deliberately not acted on

instruction.md is 267 words against an advisory aim of 250. It sits inside the
hard 100 to 300 band with every floor green, and aiCheck has passed on this
text three times. Buying 18 words back risks a blocking gate to satisfy a
warning.
