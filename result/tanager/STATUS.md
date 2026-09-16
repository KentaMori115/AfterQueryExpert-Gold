# tanager — repo record

17th Gold codebase on the dragan seat, second Rust repo (after fwctl).
Snapshot `snapshot.borrower-v2-g1785207711975813.zip` (92 files, 2026-09-05),
unpacked at `result/tanager/repo`. No `.git`, read only. Work git repo at
`result/tanager/work` (branch `main` = snapshot).

## What it is

`tanager` 0.6.0, an embeddable in-memory analytical SQL query engine, **zero
external dependencies**, edition 2021, rust-version 1.92. 10921 Rust lines.
Pipeline, each stage its own module under `src/`: lexer -> Pratt parser -> AST
-> binder (names to positional indices, full type check, aggregate lifting) ->
rule optimizer (fixpoint) -> materializing executor -> `format::render_table`.

| layer | modules |
| --- | --- |
| `types` | `datatype` (lattice + `unify`), `value` (three-valued ops, `group_key`, casts), `schema`, `convert` |
| `storage` | columnar `table`, `column`, `row`, `catalog` |
| `parser` | `lexer`, `token`, `keyword`, `parser` (866 lines) |
| `ast` | `expr`, `statement`, `operators`, `display` |
| `planner` | `binder` (744 lines), `binder_util`, `bound`, `logical`, `scope` |
| `optimizer` | `rule`, `optimizer` (fixpoint driver), `constant_folding`, `predicate_pushdown`, `limit_pushdown`, `conjuncts`, `plan_util` |
| `exec` | `executor`, `eval`, `predicate`, `agg_exec`, `join_exec`, `sort_exec` |

## Base suite, local, green

`cargo test --all-targets --offline` under rustc 1.98: **299 passing, 0 failing**
(302 with the 3 doctests). 119 unit cases in `src/lib.rs`, 180 across 23
`tests/*.rs` files, 0 in the binary and the examples.

Only `tests/*.rs` can be graded on a Rust repo: `src/**` unit tests are
solution-editable, so they can be neither reset from base nor pinned by digest.
180 inherited cases is comfortably over the p2p floor of 50. Doctests must never
be graded, their ids carry a line number.

## Base invariants anything built here has to respect

| | |
| --- | --- |
| `tests/parser_api.rs` | `Statement::Select(s)` must keep carrying a value with `.projection`, and `Binder::bind_select(&s)` must keep its signature. A restructure into a `Query` type breaks 4 base cases. |
| `tests/optimizer_effects.rs` + `src/optimizer/optimizer.rs` | both pin `Optimizer::new().rule_names() == [constant_folding, predicate_pushdown, limit_pushdown]`. Adding a rule to the default pipeline breaks a graded base case; extend an existing rule instead. |
| `src/optimizer/{plan_util,limit_pushdown,predicate_pushdown}.rs` | match `LogicalPlan` exhaustively; a new variant is a compile error in all three until handled. |
| `Optimizer::optimize` | iterates to a fixpoint over plan equality, max 8 passes. A rule that rewraps its own output nests 8 deep instead of looping forever, so non-idempotent rewrites are silent, not fatal. |
| `docs/DESIGN.md` | "Deliberate non-goals: no persistence, transactions, indexes, subqueries, or set operations" — the four gaps below come straight off that line. |

## Four sessions, four gaps, claimed 2026-09-05

| session | work dir | gap |
| --- | --- | --- |
| mindriftwork-ab | `result/tanager-6223` | UPDATE + DELETE DML |
| mindriftwork-62 | `result/tanager-1f45` | subqueries (IN / EXISTS / scalar) |
| mindriftwork-b8 | `result/tanager-7c3a` | RIGHT / FULL / CROSS JOIN + USING |
| **mindriftwork-33 (this one)** | `result/tanager` | **set operations** |

The claim took six crossed messages to settle because two of us kept answering
each other's stale message. Ended by yielding unconditionally to the peer's last
word rather than sending a seventh.

## Task 1: set-operations (feature_request) — claimed, awaiting draft

`UNION [ALL]`, `INTERSECT [ALL]`, `EXCEPT [ALL]` over `SELECT` branches, with
`INTERSECT` binding tighter than the other two, left-associative, and a single
trailing `ORDER BY` / `LIMIT` / `OFFSET` governing the whole expression.

Difficulty is not the operators. Per the veldt record, every calibration build
gets precedence, `ALL` counting and null pairing right. It lives in three rules
that collide with something the repo already promises:

1. **`LimitPushdown` learns the new node.** A `Limit` above a `UNION ALL` copies
   into both branches bounded by `limit + offset`, and only for `UNION ALL` — a
   dedup or an `INTERSECT` / `EXCEPT` cannot be bounded per branch. The rule
   feeds a fixpoint driver, so it also has to be idempotent or the plan nests
   eight deep. Observable through the public `Optimizer` + `node_name` /
   `detail` API that `tests/optimizer_effects.rs` already uses.
2. **Values are promoted, not just the schema type.** Rows are keyed by value
   AND type through `Value::group_key`, so an INTEGER branch meeting a FLOAT
   branch only pairs after its values are cast. A build that unifies the
   declared type alone renders `1` beside `1.0` and dedups neither.
3. **Nullability unifies too.** A result column is NOT NULL only when it is NOT
   NULL in every branch. Nobody writes that unasked.

`DataType::unify` already documents itself as serving "the columns of a set
operation", so the type rule has a home in the base tree and needs no new helper.

## set-operations: draft 0xZoGq5InoR62Cmpz9SS, verified 2026-09-05

Repo id `2Z9OHwYvfPnfAYyrEo0D` (platform name `/tanager`), base commit
`928c0b74375a634051b81bae1e4032c9e4c86ac7`, environment **v3**, image
`gold-repo-tanager-2z9ohw:v3`.

### Step 0, proven rather than read

env-log v3 is `rust:1.92-slim-bookworm`, git, python3, cargo-nextest 0.9.143,
then `cargo build --all-targets --locked` and `--release`, so the image ships a
warm target directory. Rebuilt from those Step lines as `tanager-33-env:v3` and
run with `--network none`: **299 of 299 base cases pass**. The repo has zero
dependencies, so there is nothing to vendor and nothing to fetch.

Two facts the rebuild turned up. `cargo` is on PATH only in a non-login shell,
which is why the block searches the usual homes rather than trusting PATH. And
`pkill` is absent (no procps), so the post-run sweep is best-effort, as the
frame already assumes.

### Numbers

| | |
| --- | --- |
| solution | +1037 / -43 over 16 files (floor 459 / 4) |
| held-out | +875 over 14 files (floor 596 / 2) |
| f2p | 48 |
| p2p | 99 over 11 inherited suites (floor 50) |
| instruction | 289 words (cap 300), ratio 3.53 |
| `gold_bot.py check` | every floor ok, no local problems |

The held-out patch carries the 11 inherited suites and `tests/common/mod.rs` as
well as the two new files, each with a line or two added to its own header.
That is deliberate: `grader.py prepare` resets every path the patch names back
to the base commit before applying it, so a submission's edits to a graded
suite are undone rather than caught after the fact. Two battery rows prove it
(`rewrites_an_inherited_suite`, `rewrites_a_held_out_suite`, both 48/99).

### Battery, 29 rows

| rows | result |
| --- | --- |
| oracle | 48 f2p, 99 p2p, reward 1 |
| base, empty | 0 f2p, 99 p2p, reward 0 |
| 17 mutations | every one caught |
| 5 attacks | build script, rustc wrapper, `harness = false`, a target claiming a graded name, a toolchain file: all 0/0 |
| 4 benign | dev-style cargo config, a solver's own test file, and the two suite rewrites: all 48/99 |

Two mutants were badly written the first time and were rewritten rather than
excused. `order_by_takes_a_hidden_column` scored 48 because threading the input
scope through still ends in `extend_project`, which refuses anything but a
projection, so the mutation changed no behaviour the suite could see; it is now
`an_unresolvable_order_key_is_ignored`, which drops an unresolvable key instead
of raising. `a_sort_no_longer_blocks_the_bound` dropped the `Sort` node
entirely and cost a p2p case, which reads as a broken verifier rather than a
caught mutation; it now looks through the sort and puts it back.

### Two hazards worth remembering

**Docker tags are global on this box** and four sessions share it. The battery
originally built `tanager-verify:local`, and a peer's rows were graded by my
image: their run reported my `bounded_branches.*` ids. The verifier image is
the dangerous one, since `tests/Dockerfile` bakes test.sh, test.patch,
config.json and grader.py into it. Everything here is now `tanager-33-*`.

**The verifier builds into a fresh `CARGO_TARGET_DIR`**, not the image's warm
one, because a submitted tree can leave crafted artefacts under `/app/target`
that cargo would reuse. It costs a few minutes per row and closes the route.

### Similarity

`intersect-except` on veldt is the same author's set-operation task and it is
already in the corpus, where the same-author block sits at 0.865. The
instruction was re-voiced around this repository's own vocabulary (the binder,
`DataType::unify`, `Value::group_key`, `LimitPushdown`, `Statement::Select`)
and the operator semantics compressed, which is as far as wording can go while
the feature stays what it is. Bag-of-words cosine against the veldt text is
0.75; if the platform blocks on this, the answer is a different gap, not more
rewriting.

### Submitted 2026-09-05 19:12 (1 of 3)

`ciChecks` passed, `aiCheck` passed, `similarity` **passed** — the same-author
overlap with veldt's `intersect-except` did not block, so a second set-operation
task on a different repository is acceptable to the originality check as long as
the wording sits in its own repository's vocabulary.

Two non-blocking ciChecks warnings, both known: the solution adds 1037 lines
("well above the typical range") and the instruction is 289 words ("aim under
250"). veldt carried the same word-count warning and passed all eight stages.

Final battery: all 29 rows behaved as declared, including the rewritten
`a_sort_no_longer_blocks_the_bound`, which now looks through the sort to bound
the branches and leaves every other plan alone, costing one f2p case and no p2p.

### Round 1 failed quality review: anti_cheating_measures

> Although the runner pins tests, plants canaries, validates listings, and runs
> binaries unprivileged, it invokes Cargo as root on the submitted tree. It
> rejects only /app/build.rs and selected manifest/config redirects; a committed
> nested path dependency or workspace member with a build script (or proc-macro
> machinery) can execute during compilation and read hidden /tests content.

The finding is correct and the hole was real. Running the binaries unprivileged
covers what happens after a build; nothing covered the build itself, and a build
script is submitted code that the compiler runs. The top-level `build.rs` was
refused by name, so a nested crate reached by `path` walked straight past it.

Fixed by closing the class rather than lengthening the list:

1. **Cargo itself drops privilege.** `compile_set` runs under the same setpriv
   the binaries use. That needs a writable private copy (cargo settles
   `Cargo.lock` beside the manifest, and `--locked` is not an option: a solver
   who adds a dev-dependency would fail the build outright instead of being
   graded), a `CARGO_HOME` under the run directory, and a target directory the
   user owns. With `/tests` root-owned 0600, a build script that slips through
   now reads nothing.
2. **Any `build.rs` anywhere in the tree** is refused, found with `find`, not
   just the one at the top level.
3. **The manifest reader refuses three more things**: a `build =` key, a
   `proc-macro = true` library, a dependency reached by `path`, and a workspace
   pulling in members. All absent at the base commit, and none of them is
   something this task needs. A dev-dependency is still allowed, because
   content-pinning a manifest is what zeroed all eight trials of another task.

Two new battery rows reproduce the reviewer's exact attack: `nested_build_script`
(a `helper/` crate with a build script that reads `/tests/config.json`, reached
by `path`) and `proc_macro_crate`. Both are refused by name and score 0/0.
Fifteen rows re-run against the hardened block, all as declared, oracle still
48/99 reward 1.

**Round 2 submitted 2026-09-05 (2 of 3 used).**
