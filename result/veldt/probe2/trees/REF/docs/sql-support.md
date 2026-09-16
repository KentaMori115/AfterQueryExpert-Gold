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

where `set_operator` is `UNION`, `INTERSECT` or `EXCEPT`.

A projection is `*`, `alias.*`, or an expression with an optional `AS name`
(the `AS` may be omitted). `FROM` is required.

## Set operations

Three, each with an optional `ALL`, and each demanding the same column count
from both sides. Column names come from the left; the two types of a column are
unified the way a `CASE` unifies its branches, and both sides are converted to
that type before rows are matched.

| Written | Kept |
| --- | --- |
| `a UNION b` | every row of either side, once |
| `a UNION ALL b` | every row of either side, as often as it arrived |
| `a INTERSECT b` | rows both sides produced, once |
| `a INTERSECT ALL b` | `min(left copies, right copies)` of each row |
| `a EXCEPT b` | rows the left produced and the right did not, once |
| `a EXCEPT ALL b` | `max(left copies - right copies, 0)` of each row |

Matching is by value and by type, and two nulls match, which a `=` comparison
between them would not. Output follows the left side's order, and the copies a
right-hand row cancels are the earliest ones still standing on the left.

Cardinality estimation follows the same shape as the operations themselves.
Neither pairing can produce more rows than its left branch, and an intersection
is capped by its right branch as well; the `ALL` spelling reports that bound
directly, while the plain spelling scales it the way a union's estimate is
scaled, with zero as the floor rather than one.

`INTERSECT` binds tighter than the other two, so `a UNION b INTERSECT c` reads
as `a UNION (b INTERSECT c)`. `UNION` and `EXCEPT` share a level and chain left
to right: `a EXCEPT b EXCEPT c` is `(a EXCEPT b) EXCEPT c`.

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
