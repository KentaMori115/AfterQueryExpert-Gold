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
[ UNION [ALL] select ]
[ INTERSECT [ALL] select ]
[ EXCEPT [ALL] select ]
```

A projection is `*`, `alias.*`, or an expression with an optional `AS name`
(the `AS` may be omitted). `FROM` is required.

## Set operations

```
select UNION     [ALL] select
select INTERSECT [ALL] select
select EXCEPT    [ALL] select
```

`INTERSECT` binds more tightly than `UNION` and `EXCEPT`.  `UNION` and
`EXCEPT` sit at the same precedence level and associate left to right, so
`a EXCEPT b EXCEPT c` means `(a EXCEPT b) EXCEPT c` and
`a UNION b INTERSECT c` means `a UNION (b INTERSECT c)`.

Both branches must produce the same number of columns.  Column names come from
the left-hand branch; types are unified pairwise (the same rule `UNION` uses).
Rows are compared by value and by type after both branches have been cast to
the unified types, so integer `1` and float `1.0` are the same row.  Two
`NULL` values are considered equal by set-operation matching, even though a
comparison between them would not be.

Plain (without `ALL`): each distinct surviving row appears exactly once.

With `ALL` the multiset counts are preserved:

* `INTERSECT ALL` keeps each row `min(m, n)` times, where *m* is its left
  count and *n* its right count.
* `EXCEPT ALL` keeps each row `max(m − n, 0)` times, in left-input order;
  each right-side copy cancels the earliest surviving left-side copy.

`ORDER BY`, `LIMIT`, and `OFFSET` placed after the last branch of a chain
belong to the whole chain and are keyed on the combined output column names.

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
