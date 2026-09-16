# Changelog

## Unreleased

### Added
- SQL front end: `SELECT` with projections, `WHERE`, `GROUP BY`, `HAVING`,
  `ORDER BY`, `LIMIT`/`OFFSET`, `DISTINCT`, `UNION`/`INTERSECT`/`EXCEPT`, each
  with an optional `ALL`, and five join types.
- Expression language with three-valued logic, `CASE`, `CAST`, `IN`, `BETWEEN`
  and `LIKE`.
- 45 scalar functions and 12 aggregates, both extensible per engine.
- Rule-driven optimizer: constant folding, predicate and projection pushdown,
  filter and limit merging, redundant `DISTINCT` elimination.
- Pull-based execution: scan, filter, project, hash aggregate, sort, limit,
  distinct, union, intersect, except, hash join and nested loop join.
- Data sources for CSV, JSON Lines, in-memory tables and hive-style partitioned
  directories, the last with partition pruning.
- Command line interface: `query`, `explain`, `schema`, `convert`, `version`.
- Metrics, span tracing and an interactive shell.

### Fixed
- `ORDER BY`, `LIMIT` and `OFFSET` written after the last select of a set
  operation applied to that select alone rather than to the whole chain.
- Join-qualified columns resolved to the wrong side when both inputs shared a
  column name, turning equi-joins into self comparisons.
- Predicate and projection pushdown decided join sides from the child schemas
  rather than the merged output names, routing predicates to the wrong input.
- Engine-registered functions and aggregates were invisible to planning and to
  the parser.
- Partition pruning compared parsed partition values against raw literals,
  discarding every partition for typed partition keys.
- Blank CSV lines produced an all-null row.
- Unknown table qualifiers silently resolved to a bare column of the same name.
