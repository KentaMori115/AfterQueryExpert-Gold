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
[ set_operator [ALL] select ]
```

A projection is `*`, `alias.*`, or an expression with an optional `AS name`
(the `AS` may be omitted). `FROM` is required.

## Set operations

```
select UNION     [ALL] select
select INTERSECT [ALL] select
select EXCEPT    [ALL] select
```

Both sides must produce the same number of columns; a mismatch is a planning
error. The result takes its column names from the left-hand side and its column
types from unifying the two sides pairwise, so `int64` against `float64`
publishes `float64`. Rows are then compared by value and by type after both
branches have been converted, which makes `1` and `1.0` one row. Two nulls are
the same row, even though `NULL = NULL` is not true.

Spelled plainly, every surviving row appears once. With `ALL`, matching becomes
counting: for a row supplied `m` times on the left and `n` times on the right,

| Operator | Plain | `ALL` |
| --- | --- | --- |
| `UNION` | once if `m + n > 0` | `m + n` times |
| `INTERSECT` | once if both sides produced it | `min(m, n)` times |
| `EXCEPT` | once if `n = 0` | `max(m - n, 0)` times |

`INTERSECT` and `EXCEPT` emit rows in left-hand order, and each right-hand copy
cancels the earliest left copy still standing.

In a chain, `INTERSECT` binds tightest; `UNION` and `EXCEPT` sit at one level
and read left to right. So `a UNION b INTERSECT c` is `a UNION (b INTERSECT c)`,
and `a UNION b EXCEPT c` is `(a UNION b) EXCEPT c`. Parentheses around a
`SELECT` are not supported, so a grouping the precedence rules do not give
cannot be written.

`ORDER BY`, `LIMIT` and `OFFSET` written after the last `SELECT` of a chain
apply to the whole chain and are keyed on its combined output names — the
left-hand ones.

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

Subqueries, common table expressions, window functions, parenthesised
`SELECT`s, `INSERT`/`UPDATE`/`DELETE`, DDL, and correlated anything.
Registering a table is a Python call, not a SQL statement.
