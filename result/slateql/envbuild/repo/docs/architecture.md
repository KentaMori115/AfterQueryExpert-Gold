# Architecture

This document follows one query from text to rows and explains what each
package is responsible for. The running example is:

```sql
SELECT c.city, COUNT(*) AS n
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE c.city = 'Oslo'
GROUP BY c.city
ORDER BY n DESC
LIMIT 5
```

## 1. `slateql.sql` -- text to AST

The lexer (`sql/lexer.py`) is a hand-written character scanner. It records a
line and column for every token so that a parse error can print a caret under
the offending word. It handles `--` line comments, nested `/* */` block
comments, doubled-quote escaping inside both string literals and quoted
identifiers, and folds unquoted identifiers to lower case.

The parser (`sql/parser.py`) is recursive descent for statements and Pratt-style
for expressions. Two decisions are worth calling out:

* `BETWEEN ... AND ...` parses its bounds at a precedence above `AND` so that
  `x BETWEEN 1 AND 2 AND y = 3` binds the way a reader expects.
* A trailing `ORDER BY` / `LIMIT` after a `UNION` binds to the whole set
  operation, not to its right arm. Parenthesising an arm restores per-arm
  binding.

The AST (`sql/ast_nodes.py`) is deliberately untyped: identifiers are still
strings and nothing has been resolved. `sql/unparser.py` turns an AST back into
SQL, fully parenthesised so that the round trip is stable.

## 2. `slateql.analyze` -- AST to logical plan

The binder builds the plan in SQL's clause evaluation order:

```
FROM -> WHERE -> GROUP BY -> HAVING -> SELECT -> DISTINCT -> ORDER BY -> LIMIT
```

Each stage resolves its expressions against the schema produced by the stages
below it, using a `Scope` (`analyze/scope.py`). Expression binding
(`analyze/typecheck.py`) resolves columns, looks up functions, infers types
through the coercion lattice, and desugars `BETWEEN` into comparisons and
simple `CASE` into searched `CASE`.

Aggregation is the interesting part. `analyze/aggregates.py` collects the
distinct aggregate calls found anywhere in the select list, `HAVING`, or
`ORDER BY`, registers each group key, and then rewrites those clauses so they
read from the `Aggregate` node's output columns. The rewrite is bottom-up, which
is what makes `GROUP BY a` legal in the expression `a + 1` while leaving a bare
reference to an ungrouped `b` as an error.

`ORDER BY` is the only clause that can see two scopes: the projection's aliases
and the pre-projection columns. A sort key that is not in the select list is
projected as a hidden column, sorted on, and pruned again by a second
projection. That is why `SELECT name FROM customers ORDER BY id` works and
`SELECT DISTINCT name FROM customers ORDER BY id` is rejected.

`analyze/validate.py` walks the finished plan asserting invariants: filters are
boolean, aggregate calls appear only under `Aggregate`, every column reference
resolves against its node's input, and both arms of a set operation agree on
width.

## 3. `slateql.optimize` -- logical plan rewriting

Rules are pure functions from plan to plan and must be idempotent. The pipeline
(`optimize/pipeline.py`) runs the whole sequence repeatedly until the plan stops
changing, with an iteration cap as a safety net, and re-validates after every
rule that actually fired.

| Rule | What it does |
| --- | --- |
| `constant-folding` | Evaluates constant, non-volatile subexpressions once. |
| `simplify-expressions` | Boolean identities, double negation, `NOT` over comparisons, single-item `IN`. |
| `remove-redundant-operators` | Drops identity projections and no-op limits, propagates empty relations. |
| `predicate-pushdown` | Moves each conjunct as far down as semantics allow. |
| `limit-pushdown` | Pushes a limit below a projection and merges nested limits. |
| `join-input-ordering` | Puts the smaller relation on the hash join's build side. |
| `projection-pruning` | Restricts each scan to the columns something above it reads. |

Pushdown is per-conjunct, so `WHERE c.city = 'Oslo' AND o.quantity > 1` splits
across both sides of a join and leaves nothing above it. Outer joins constrain
the movement: a predicate on the null-padded side cannot move below the join,
because a row that fails it must still be padded rather than dropped.

Cardinality and cost estimation live in `optimize/stats.py` and
`optimize/cost.py`. The estimates are crude -- fixed selectivity factors, not
histograms -- but consistent, which is all a rule comparing two alternatives
needs.

## 4. `slateql.execution` -- physical planning and execution

The physical planner (`execution/planner.py`) is a mechanical mapping with
exactly one decision: whether a join becomes a hash join or a nested-loop join.
`extract_equi_keys` splits the condition into column-to-column equalities plus a
residual predicate; if there is at least one equality the hash join wins.

Operators (`execution/operators/`) form a pull-based tree. `execute` returns a
generator of `RecordBatch` objects, so nothing runs until the consumer starts
iterating and `LIMIT` can stop a scan early. Operators never emit an empty
batch.

Expressions are compiled once per operator into closures
(`execution/evaluator.py`). Column references become ordinals, function
definitions are resolved, and the resulting closure captures everything it
needs. This is where SQL's three-valued logic is written out explicitly rather
than leaning on Python truthiness.

The hash join always builds its table from the right input and tracks which
build rows matched, which lets one implementation serve `INNER`, `LEFT`,
`RIGHT`, and `FULL` while keeping the output column order identical to the
nested-loop operator.

## 5. `slateql.storage` -- the catalog and data sources

A `DataSource` describes a schema and produces rows, and must be re-scannable:
scanning twice yields the same rows in the same order. `MemorySource`,
`CsvSource`, and `JsonlSource` ship in the box.

Text formats carry no types, so the loaders sample rows and pick the narrowest
type on the ladder `BOOLEAN, INTEGER, DOUBLE, DATE, TIMESTAMP, STRING`. JSON is
handled slightly differently: numbers and booleans are already typed, so only
strings that begin with an ISO calendar date are considered temporal.

Statistics (`storage/stats.py`) are computed by an explicit `analyze()` call
rather than automatically, so registering a large file never triggers a scan.

## Determinism

The verifier runs queries repeatedly, so nothing may vary between runs:

* No clock reads outside the `now()` / `current_date()` functions, which are
  marked volatile and excluded from constant folding.
* No network access and no filesystem writes.
* Groups are emitted in first-appearance order; sorts are stable.
* `NULL` ordering is explicit at every sort site, defaulted from the session
  config rather than left to Python's comparison rules.
