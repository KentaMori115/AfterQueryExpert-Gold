# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- `EXPLAIN <select>` returns the optimized logical plan as a result set.
- String concatenation operator `||`.
- Scalar functions: `POWER`, `SQRT`, `SIGN`, `LTRIM`, `RTRIM`, `REVERSE`,
  `REPEAT`, `GREATEST`, `LEAST`.
- `ORDER BY` on input and non-projected columns (via hidden sort columns).
- GitHub Actions CI (fmt, clippy, build, test) and rustfmt configuration.
- Runnable examples under `examples/`.

### Fixed
- `NULLS FIRST` / `NULLS LAST` are now independent of `ASC` / `DESC`.

## [0.6.0]

### Added
- Rule-based optimizer with constant folding and predicate pushdown.
- `DISTINCT`, `HAVING`, and `LEFT JOIN`.
- Aggregate functions `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` (with `DISTINCT`).
- Scalar function library and `CASE` / `CAST` / `BETWEEN` / `IN` / `LIKE`.

## [0.4.0]

### Added
- Binder and typed logical plan.
- Pratt expression parser and SQL statement parser.

## [0.2.0]

### Added
- Columnar storage, catalog, and the type system.
- Initial crate scaffold and error model.
