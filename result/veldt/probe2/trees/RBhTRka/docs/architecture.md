# How a query runs

This document follows one statement from text to rows. It is the map to read
before changing anything: each stage owns one job, and bugs are usually a stage
doing another stage's work.

```
SQL text
   |  veldt.sql.tokenizer      characters -> tokens
   |  veldt.sql.parser         tokens -> SelectStatement
   |  veldt.sql.compiler       SelectStatement -> LogicalPlan
   |  veldt.plan.optimizer     LogicalPlan -> LogicalPlan
   |  veldt.execution.physical LogicalPlan -> Operator tree
   |  veldt.execution.pipeline pull batches until exhausted
   v
Table
```

## 1. Tokenizing

`veldt.expr.tokenizer` serves both expressions and statements. It knows about
SQL string literals (`'it''s'`), quoted identifiers (`"odd name"`), line and
block comments, and the multi-character operators (`<=`, `<>`, `||`) that must
not lex as two tokens. Every token carries its offset, line and column so a
`ParseError` can point at the problem.

## 2. Parsing

Two parsers share one cursor class. `ExpressionParser` implements the
expression grammar by precedence climbing; `SqlParser` extends it with the
clauses of a `SELECT`. The result, a `SelectStatement`, is a faithful record of
what was written — no name has been resolved and no table has been opened.

## 3. Compiling

`SqlCompiler` turns the statement into a `LogicalPlan`, bottom up:

    FROM/JOIN -> WHERE -> GROUP BY -> HAVING -> SELECT -> DISTINCT -> ORDER BY -> LIMIT

Four things here are more subtle than they look.

**Alias resolution.** A join renames duplicate right-side columns, so `u.id`
may have to become `id_right`. The compiler tracks, per table alias, where each
of that table's columns ended up, and rewrites references through that map. It
also pins the written name back onto the output, so `SELECT u.id` still returns
a column called `id`.

**Aggregate extraction.** `SUM(x) + 1` cannot be handed to the aggregation
operator. The compiler pulls every aggregate call out of the projection,
`HAVING` and `ORDER BY`, computes each one exactly once in an `Aggregate` node,
and rewrites the surrounding expressions to reference its output columns.

**Sort placement.** `ORDER BY` may name an input column or an output alias. If
every key resolves against the projection's input the sort goes below the
projection, which is both correct and cheaper; otherwise it goes above, and the
keys are rebound to the output names.

**Set operator precedence.** A chain of `UNION`, `INTERSECT` and `EXCEPT` is
parsed right-nested, but it does not mean that: `INTERSECT` binds tighter than
the other two, which sit at one level and read left to right. The compiler
flattens the chain into operands and operators and rebuilds it by precedence.
The trailing `ORDER BY`, `LIMIT` and `OFFSET` are lifted off the last select and
applied to the whole chain, whose output names come from its leftmost branch.
A plain `UNION` becomes a concatenation under a `Distinct`; `INTERSECT` and
`EXCEPT` cannot be spelled that way — subtracting counts is not deduplicating —
so those nodes carry the `ALL` flag themselves.

## 4. Optimizing

`Optimizer` applies its rules in order, repeatedly, until the plan stops
changing or the iteration budget runs out. Every rule must be semantics
preserving, idempotent and independent of the others. After each rule the
optimizer checks that the plan's output schema has not changed; a rule that
changes it has a bug, and saying so immediately beats debugging wrong rows.

| Rule | What it does |
| --- | --- |
| `ConstantFolding` | Evaluates constant sub-expressions, applies boolean identities |
| `RemoveTrivialFilter` | Drops `WHERE true`, collapses `WHERE false` |
| `CombineFilters` | Merges adjacent filters, drops repeated terms |
| `PredicatePushdown` | Moves each conjunct as close to a scan as it can go |
| `CombineProjections` | Collapses a projection over a projection when cheap |
| `CombineLimits` | Merges nested limits into the tighter bound |
| `EliminateRedundantDistinct` | Drops a `DISTINCT` over already-unique input |
| `ProjectionPushdown` | Narrows each scan to the columns actually read |

Pushdown is where join renaming bites again: a filter above a join speaks in
the join's *output* names, so sides are decided on the merged schema and a
right-bound term is translated back into that input's own names.

## 5. Physical planning

`PhysicalPlanner` is a near one-to-one mapping, with two real decisions:

* A join with at least one equality between the two sides becomes a
  `HashJoinOperator`; anything else becomes a `NestedLoopJoinOperator`. The
  non-equality part of a condition survives as a residual predicate.
* A scan hands the source only the filters that source said it could apply.
  `PartitionedSource` accepts equality and `IN` over partition keys, which is
  what makes partition pruning work.

## 6. Execution

Operators form a pull-based tree: iterating the root pulls from its children.
Streaming operators (scan, filter, project, limit, union, distinct) emit each
batch as they finish it; blocking operators (sort, aggregate, join, intersect,
except) buffer their input first. `Operator.is_blocking` reports which is
which, because that is where memory goes. `INTERSECT` and `EXCEPT` must have
the right branch in hand before they can answer for a single left row, so both
drain it into a multiset of row keys and then stream the left side past it,
which is also what keeps their output in left-hand order.

Batch size is a property of the `ExecutionContext`, not of any operator, so the
same tree can be run at different batch sizes. Metrics and spans are recorded
by the base class, so every operator is measured the same way.

## Null semantics

Nulls follow SQL, not Python:

* Arithmetic and comparison propagate: `NULL + 1` and `NULL > 1` are `NULL`.
* `AND`/`OR` are three-valued: `false AND NULL` is `false`, `true AND NULL` is
  `NULL`.
* A `WHERE` predicate selects a row only on a definite `true`.
* Aggregates skip nulls; `COUNT(*)` counts rows, `COUNT(x)` counts non-nulls.
* A null join key matches nothing, including another null.
* Grouping treats nulls as one group, and `1`, `1.0` and `true` as three
  different keys.

## Where the bodies are buried

* Division by zero yields `NULL` rather than raising, so one bad row cannot
  abort a scan.
* CSV cells that do not parse as their column's type become `NULL` for the same
  reason.
* `Schema.merge` disambiguates with `_right`, then `_right2`, and so on.
* Plan nodes resolve their schemas lazily and carry no registries, so an engine
  with custom functions publishes its registries as ambient state while it
  plans. That is the one piece of global state in the engine.
