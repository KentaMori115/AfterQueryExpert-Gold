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
[ (UNION | INTERSECT | EXCEPT) [ALL] select ]
```

A projection is `*`, `alias.*`, or an expression with an optional `AS name`
(the `AS` may be omitted). `FROM` is required.

## Set operations

```
select UNION     [ALL] select
select INTERSECT [ALL] select
select EXCEPT    [ALL] select
```

All three want the same number of columns on both sides, and all three publish
the same schema: names from the left-hand side, types unified pairwise. Rows
pair by value *and* by type once both branches have converted to those types,
so `1` and `1.0` are one row where the unified type is `float64`. Two nulls
pair, which a comparison between them would not.

Spelled plainly, every surviving row appears once:

| Operator | Keeps |
| --- | --- |
| `UNION` | rows either side produced |
| `INTERSECT` | rows both sides produced |
| `EXCEPT` | left rows the right side never produced |

Spelled with `ALL`, they count instead. For a row supplied `m` times on the
left and `n` times on the right:

| Operator | Copies kept |
| --- | --- |
| `UNION ALL` | `m + n` |
| `INTERSECT ALL` | `min(m, n)` |
| `EXCEPT ALL` | `m - n`, floored at zero |

`INTERSECT` and `EXCEPT` emit rows in left-hand order, each right-hand copy
cancelling the earliest left copy still standing.

In a chain, `INTERSECT` binds tightest; `UNION` and `EXCEPT` sit at one level
and read left to right. So `a UNION b INTERSECT c` means
`a UNION (b INTERSECT c)`, while `a UNION b EXCEPT c` means
`(a UNION b) EXCEPT c`.

`ORDER BY`, `LIMIT` and `OFFSET` written after the last select of a chain
belong to the whole chain, and name the combined output columns — which is to
say the left-hand names. They may not name an aggregate.

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
