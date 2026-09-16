# Changelog

All notable changes to SlateQL are recorded here. Versions follow semantic
versioning; the engine is pre-1.0, so minor versions may change behaviour.

## Unreleased

* Indexes are wired into the planner. `Session.create_index` and
  `Session.drop_index` manage them, `SHOW INDEXES` reports them, and a scan
  serves point lookups, `IN` lists, `IS NULL` and ranges from one when it can.
* A single `ORDER BY` key on a sorted index is read straight out of the index,
  so the sort disappears and a `LIMIT` above it stops the scan early.
* `rows_scanned` now counts the rows an access path really reads, which is how
  an indexed query shows its work.
* Continuous integration on GitHub Actions: the suite runs on Python 3.10
  through 3.12, ruff lints the tree, and the example scripts and the command
  line interface are smoke-tested on every push.

## 0.6.0

* `Session`, the public entry point: register CSV, JSONL or in-memory tables
  and run statements against them.
* Command line interface with `query`, `explain`, `schema`, `load`, `bench` and
  `functions` subcommands, plus an interactive shell.
* Output formats: table, CSV, TSV, JSON, JSONL and vertical.
* `EXPLAIN VERBOSE` prints the unoptimized logical plan, the rules that fired,
  and the physical operator tree.
* JSONL schema inference promotes ISO-8601 date and timestamp strings.
* Architecture, dialect and configuration documentation, plus runnable
  examples.

## 0.5.0

* Rule-based optimizer: constant folding, expression simplification, redundant
  operator removal, predicate pushdown, limit pushdown, join input ordering and
  column pruning, run to a fixed point.
* Cardinality estimation and a cost model over logical plans.
* Join inputs are ordered by estimated size so the smaller relation builds the
  hash table.

## 0.4.0

* Record batches, the execution context and the pull-based operator interface.
* Scan, filter, project, sort, aggregate, limit, distinct, union and values
  operators.
* Hash join and nested-loop join covering `INNER`, `LEFT`, `RIGHT`, `FULL` and
  `CROSS`.
* Physical planner and the execution pipeline that collects a `QueryResult`.

## 0.3.0

* Scope resolution, expression binding and type checking against the catalog.
* Aggregate extraction and rewriting onto aggregate output columns.
* The statement binder, turning a parsed statement into a validated logical
  plan, plus post-binding plan validation.

## 0.2.0

* Typed plan expressions and logical plan nodes with computed schemas.
* Scalar and aggregate function library behind a pluggable registry.
* Catalog with in-memory, CSV and JSONL data sources, table statistics and
  in-memory indexes.

## 0.1.0

* Lexer, recursive-descent parser, AST and unparser for the dialect.
* Logical type system with an explicit coercion lattice and relation schemas.
* Shared utilities: null-aware ordering, ASCII table rendering, timing.
