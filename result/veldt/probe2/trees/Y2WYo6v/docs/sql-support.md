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
(the `AS` may be omitted). `FROM` is required. A set operator is `UNION`,
`INTERSECT` or `EXCEPT`.

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

## Set operations

```
select UNION     [ALL] select
select INTERSECT [ALL] select
select EXCEPT    [ALL] select
```

All three want the same number of columns on both sides — a mismatch is a
planning error — and all three publish the same thing: the left-hand column
names, with the types of each pair unified. Rows pair by value and by type once
both branches have been converted to those types, so `1` and `1.0` are one row,
and two nulls are one row, a pairing no comparison between them would make.

Written plain, every surviving row appears once:

| Operator | Rows kept |
| --- | --- |
| `UNION` | everything either side produced |
| `INTERSECT` | what both sides produced |
| `EXCEPT` | left rows the right side never produced |

Written with `ALL`, duplicates are kept and the operators count. For a row
supplied `m` times on the left and `n` times on the right, `UNION ALL` produces
`m + n` copies, `INTERSECT ALL` produces `min(m, n)` and `EXCEPT ALL` produces
`m - n`, floored at zero. Output follows left order, each right-hand copy
cancelling the earliest left copy still standing.

In a chain, `INTERSECT` binds tightest; `UNION` and `EXCEPT` share one level and
read left to right. So

```sql
a UNION b INTERSECT c EXCEPT d
```

means `(a UNION (b INTERSECT c)) EXCEPT d`. An `ORDER BY`, `LIMIT` or `OFFSET`
written after the last select of a chain belongs to the whole chain and is keyed
on the names the chain publishes.

`INTERSECT` and `EXCEPT` have to pair rows, so each needs its right branch in
hand before it can answer and reports as blocking; a `UNION` still streams.

## Not supported

Subqueries, common table expressions, window functions,
`INSERT`/`UPDATE`/`DELETE`, DDL, and correlated anything. Registering a table
is a Python call, not a SQL statement.
