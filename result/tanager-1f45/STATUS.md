# tanager, session mindriftwork-62 (work dir result/tanager-1f45)

## Claim

- task name proposed: **set-operations**
- category: **feature_request**
- gap: set operations — `UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT`, parenthesised
  branches, and a trailing `ORDER BY` / `LIMIT` / `OFFSET` binding to the whole
  set expression
- settled 2026-09-05 with all three peer sessions after claims crossed three
  times; tie-break used was "whoever has code on disk keeps the gap".

| session | work dir | gap |
| --- | --- | --- |
| mindriftwork-ab | result/tanager-6223 | UPDATE + DELETE DML |
| mindriftwork-62 (this one) | result/tanager-1f45 | set operations |
| mindriftwork-33 | result/tanager | subqueries |
| mindriftwork-b8 | result/tanager-7c3a | RIGHT / FULL / CROSS JOIN plus USING |

My file set: `src/ast/statement.rs`, `src/parser/keyword.rs`, the query-expression
layer of `src/parser/parser.rs`, `src/planner/binder.rs`, `src/planner/logical.rs`
(a `SetOp` variant), `src/types/schema.rs` (branch unification), a new
`src/exec/setop_exec.rs`, `src/exec/executor.rs`, and the `LogicalPlan` arms a new
variant forces in `src/optimizer/{plan_util,limit_pushdown,predicate_pushdown}.rs`.
No `BoundExpr` variant, nothing in `src/ast/expr.rs`, `src/exec/eval.rs` or
`src/planner/{bound,scope}.rs` beyond output-scope reuse.

## Repo facts

- 8723 lines of `src/` over 51 files, zero dependencies, `cargo test` green.
- 299 cases in test binaries plus 3 doctests. Doctest ids carry a line number,
  so they can never be graded.
- Only `tests/*.rs` is gradeable: `src/**` unit tests are solution-editable, so
  they can be neither reset from base nor pinned by digest. Roughly 180 cases
  over 23 files against a p2p floor of 50.
- `Optimizer::new().rule_names()` is pinned twice, in `tests/optimizer_effects.rs`
  and in `src/optimizer/optimizer.rs`. My change adds no rule, so neither moves.
- Pipeline is lexer -> parser -> binder -> optimizer -> executor, one module
  each, documented in `docs/DESIGN.md`, which names subqueries under
  "Deliberate non-goals".

## Where the difficulty sits

Every rule below collides with something `docs/DESIGN.md` already promises, which
is what keeps a frontier model from validating its own fit against the base suite.

1. **Positional binding.** After the binder a column reference is an index into
   the input row, and a set expression has no single input. A trailing
   `ORDER BY` resolves against output columns only, through `Scope::from_output`,
   never against a branch's input columns, so the "hidden sort column" path the
   binder uses for a plain SELECT is unavailable here.
2. **Determinism.** First-seen order is promised. `UNION`, `INTERSECT` and
   `EXCEPT` dedup through `Value::group_key`, the canonicalisation `DISTINCT`
   already uses for NULL, -0.0 and NaN, rather than through `PartialEq`, or two
   features disagree on one database.
3. **Type unification.** `DataType::unify` documents itself as serving "the arms
   of a `CASE` or the columns of a set operation". An INTEGER branch against a
   FLOAT branch widens, and the widening has to reach the **values**, not only
   the schema field, or a row renders as `1` where the column is FLOAT.
4. **Branch arity and naming.** Output column names come from the first branch;
   a width mismatch is a bind-time error, not a run-time one.
5. **Precedence.** `INTERSECT` binds tighter than `UNION` and `EXCEPT`, which are
   left-associative, so `a UNION b INTERSECT c` is `a UNION (b INTERSECT c)`.
6. **Exhaustive matches.** A new `LogicalPlan` variant is a compile error in
   `plan_util.rs`, `limit_pushdown.rs` and `predicate_pushdown.rs` until handled,
   and handling it wrongly makes the optimizer silently skip whole branches, so
   constant folding inside a branch stops happening and `EXPLAIN` prints a tree
   with no children.

## Status

- Step 0 (environment proof) BLOCKED: an assigned repo with no task has no
  reachable repo id, so `envs` / `env-log` cannot run. The first draft is what
  unlocks it.
- Waiting on the user for the draft.
