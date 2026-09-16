# What SQL is supported

A single statement shape — `SELECT` — with the clauses below. Anything absent
from this page is absent from the engine; it will be reported as a parse error
or an `UnsupportedFeatureError` rather than silently ignored.

## Statement

```
SELECT [DISTINCT] projection (, projection)*
FROM table [[AS] alias]
[ join_clause ... ]
[ WHERE predicate ]
[ GROUP BY expression (, expression)* ]
[ HAVING predicate ]
[ ORDER BY sort_key (, sort_key)* ]
[ LIMIT count ] [ OFFSET count ]
[ { UNION | INTERSECT | EXCEPT } [ALL] select ]
```

A projection is `*`, `alias.*`, or an expression with an optional `AS name`
(the `AS` may be omitted). `FROM` is required.

## Set operations

```
select UNION     [ALL] select
select INTERSECT [ALL] select
select EXCEPT    [ALL] select
```

Each operator wants the same number of columns on both sides; a mismatch is a
planning error. The result takes its column names from the left-hand side and
unifies the column types pairwise, so an `int64` column combined with a
`float64` one comes back as `float64`.

Rows are paired by value *and* by type, after both branches have been converted
to those unified types — so `1` and `1.0` are one row. Two nulls pair with each
other, which a comparison between them would not.

| Written | Keeps |
| --- | --- |
| `UNION` | every row either side produced, once each |
| `UNION ALL` | every row either side produced, as often as produced |
| `INTERSECT` | every row both sides produced, once each |
| `INTERSECT ALL` | a row supplied `m` times on the left and `n` times on the right, `min(m, n)` times |
| `EXCEPT` | every left row the right side never produced, once each |
| `EXCEPT ALL` | a row supplied `m` times on the left and `n` times on the right, `m - n` times, floored at zero |

`INTERSECT` and `EXCEPT` emit rows in left-hand order; under `ALL` each
right-hand copy cancels the earliest left copy still standing.

In a chain, `INTERSECT` binds tightest, while `UNION` and `EXCEPT` share one
level and read left to right: `a EXCEPT b INTERSECT c` is
`a EXCEPT (b INTERSECT c)`, and `a EXCEPT b EXCEPT c` is `(a EXCEPT b) EXCEPT c`.
An `ORDER BY`, `LIMIT` or `OFFSET` written after the last select of a chain
applies to the whole chain and is keyed on the combined output names.

`INTERSECT` and `EXCEPT` must see their right input in full before they can
answer, so both report as blocking operators; `UNION` only concatenates and
keeps streaming.

## Joins

```
[INNER] JOIN t ON predicate
LEFT [OUTER] JOIN t ON predicate
RIGHT [OUTER] JOIN t ON predicate
FULL [OUTER] JOIN t ON predicate
CROSS JOIN t
```

`JOIN ... USING (...)` is recognised and rejected rather than misinterpreted.

## Expressions

| Category | Supported |
| --- | --- |
| Literals | integers, floats, strings, `TRUE`, `FALSE`, `NULL` |
| Arithmetic | `+ - * / %` (division always yields a float; a zero divisor yields `NULL`) |
| Comparison | `= <> != < <= > >=` |
| Logic | `AND OR NOT` with three-valued semantics |
| Null tests | `IS NULL`, `IS NOT NULL` |
| Membership | `IN (...)`, `NOT IN (...)` |
| Ranges | `BETWEEN a AND b`, `NOT BETWEEN` (inclusive) |
| Patterns | `LIKE`, `NOT LIKE` with `%`, `_` and backslash escapes |
| Text | `\|\|` concatenation |
| Conditionals | `CASE WHEN ... THEN ... ELSE ... END`, and the `CASE expr WHEN` form |
| Conversion | `CAST(x AS type)` |

## Types

`int64`, `float64`, `bool`, `string`, `timestamp`, and the `null` type of an
expression that can only ever be null. Common aliases are accepted:
`integer`, `bigint`, `double`, `real`, `boolean`, `text`, `varchar`,
`datetime`, `date`.

## Aggregates

`count`, `sum`, `avg` (also spelled `mean`), `min`, `max`, `stddev`,
`variance`, `first`, `last`, `string_agg`, `bool_and`, `bool_or`.

`COUNT(*)` counts rows; `COUNT(x)` counts non-null values. `DISTINCT` is
accepted inside any aggregate.

## Scalar functions

Text
: `upper`, `lower`, `length`, `trim`, `ltrim`, `rtrim`, `reverse`, `substr`,
  `replace`, `concat`, `starts_with`, `ends_with`, `contains`, `split_part`,
  `lpad`, `rpad`

Numeric
: `abs`, `sign`, `round`, `floor`, `ceil`, `sqrt`, `power`, `mod`,
  `safe_divide`, `exp`, `ln`, `log`, `greatest`, `least`

Nulls
: `coalesce`, `ifnull`, `nullif`, `if`

Time
: `date_part`, `year`, `month`, `day`, `hour`, `minute`, `second`

Conversion
: `to_string`, `to_int`, `to_float`, `to_timestamp`

`substr` is one-based. `round` goes half away from zero. Functions that would
otherwise raise on a domain error — `sqrt` of a negative, `ln` of zero, `mod`
by zero — return `NULL`.

## Ordering

`ASC` (the default) and `DESC`, each with an optional `NULLS FIRST` or
`NULLS LAST`. By default nulls sort as the smallest values: first ascending,
last descending.

## Not supported

Subqueries, common table expressions, window functions,
`INSERT`/`UPDATE`/`DELETE`, DDL, and correlated anything. Registering a table
is a Python call, not a SQL statement.
