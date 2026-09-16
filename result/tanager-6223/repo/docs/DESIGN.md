# tanager design notes

This document describes how a SQL string becomes a result set inside tanager, and
the invariants each stage relies on.

## Pipeline

```
text → tokens → AST → LogicalPlan → optimized LogicalPlan → rows
        lexer   parser   binder        optimizer               executor
```

Each stage has a single, well-defined output type and does not reach back into an
earlier stage:

1. **Lexer** (`parser::lexer`) turns text into `Token`s, tracking byte offsets so
   later errors can point at a position. It recognizes keywords, so the parser
   never re-classifies identifiers.
2. **Parser** (`parser::parser`) is recursive-descent for statements and Pratt for
   expressions. Operator precedence lives in `BinaryOp::binding_power`, so adding
   an operator is a localized change.
3. **Binder** (`planner::binder`) resolves names to positional column indices,
   type-checks every node, and lifts aggregate calls into an `Aggregate` operator.
   Its output — a `LogicalPlan` of `BoundExpr`s — is fully typed and contains no
   names, only indices.
4. **Optimizer** (`optimizer`) applies pure `OptimizerRule`s to a fixpoint. Rules
   rewrite a plan into an equivalent plan; they never change results.
5. **Executor** (`exec`) walks the plan and materializes rows. Evaluation of a
   `BoundExpr` against a `Row` lives in `exec::eval`.

## Key invariants

- **Positional binding.** After the binder, a column reference is an index into
  the operator's input row. A join's output row is *left columns then right
  columns*; the binder assigns right-side indices with that offset, and predicate
  pushdown re-bases them when moving a conjunct into the right input.
- **Three-valued logic.** Comparisons return `Option<bool>` (`None` = `NULL`).
  Predicate contexts keep a row only when the predicate is exactly `TRUE`.
  Aggregates ignore `NULL`; `GROUP BY`/`DISTINCT` treat `NULL` keys as equal.
- **Determinism.** Grouping and `DISTINCT` preserve first-seen input order (an
  ordered map plus an insertion-ordered vector); sorting is stable. Division and
  modulo by zero are errors, never `NaN`/`inf`. This is what lets the reference
  tests assert on exact output.
- **Aggregate output layout.** An `Aggregate` node outputs group columns first,
  then one column per aggregate. Projection and `HAVING` above it reference those
  columns positionally, which is why the binder can express `HAVING SUM(x) > 1`
  even when `SUM(x)` is not projected.
- **ORDER BY resolution.** Keys resolve by position, then against output columns,
  then (for non-aggregate non-distinct queries) against input columns, in which
  case they ride along as hidden projection columns that a final projection
  strips after the sort.

## Adding a feature

- **A scalar function**: add a `ScalarFn` variant, its name mapping, its
  `return_type` (arity + argument typing), and its `eval`. Nothing else changes.
- **An aggregate**: add an `AggregateFn` variant, its `return_type`, and its
  accumulator behavior in `Accumulator`.
- **An operator**: add a `BinaryOp`/`UnaryOp` variant with a `binding_power`, a
  lexer token if it needs new punctuation, a parser mapping, a binder type rule,
  and an evaluator arm.
- **A plan rewrite**: implement `OptimizerRule` and add it to `Optimizer::new`.

## Deliberate non-goals

tanager is a teaching-grade analytical engine, not a storage engine. There is no
persistence, transactions, indexes, subqueries, or set operations. Execution is
fully materializing, which keeps operators simple at the cost of memory on very
large inputs.
