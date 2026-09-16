# SQL reference

The dialect SlateQL accepts. Anything not listed here is not implemented.

## Statements

```
statement := EXPLAIN [VERBOSE] query
           | SHOW TABLES
           | SHOW COLUMNS FROM table
           | DESCRIBE table
           | query

query     := select ( UNION [ALL] select )* [ORDER BY ...] [LIMIT n] [OFFSET n]

select    := SELECT [DISTINCT | ALL] select_list
             [FROM from_item]
             [WHERE predicate]
             [GROUP BY expr_list [HAVING predicate]]
             [ORDER BY sort_list]
             [LIMIT n] [OFFSET n]
```

A trailing `ORDER BY` / `LIMIT` / `OFFSET` after `UNION` applies to the whole
set operation. Parenthesise an arm to give it its own sort or limit.

## Identifiers

Unquoted identifiers fold to lower case. Double quotes preserve case and allow
any character; a literal double quote is written twice.

```sql
SELECT "Order Total" FROM "sales 2024"
```

Reserved words must be quoted to be used as identifiers. Contextual keywords
such as `first`, `last`, `values` and `using` may be used bare.

## Literals

| Kind | Examples |
| --- | --- |
| Integer | `1`, `-42` |
| Double | `1.5`, `3e2`, `4.5e-1` |
| String | `'text'`, `'it''s'` |
| Boolean | `TRUE`, `FALSE` |
| Null | `NULL` |
| Interval | `INTERVAL 'P1Y2M3DT4H5M6S'`, `INTERVAL '3' DAY` |

## Types

`BOOLEAN`, `INTEGER`, `DOUBLE`, `STRING`, `DATE`, `TIMESTAMP`, `INTERVAL`.

Common aliases are accepted in `CAST`: `int`, `bigint`, `smallint` map to
`INTEGER`; `float`, `real`, `decimal`, `numeric` map to `DOUBLE`; `text`,
`varchar`, `char` map to `STRING`; `datetime` maps to `TIMESTAMP`. Length and
precision modifiers such as `VARCHAR(32)` parse and are discarded.

Implicit widening is narrow by design: `INTEGER` widens to `DOUBLE`, `DATE`
widens to `TIMESTAMP`, and `NULL` unifies with anything. Everything else needs
an explicit `CAST`.

## Intervals

An `INTERVAL` is a span of time held as three separate fields: months, days
and seconds. The fields never fold into each other, because a month has no
fixed length and a day is not always twenty-four hours once a calendar is
involved. Years are stored as months, weeks as days, and hours and minutes as
seconds. Every field carries its own sign, so `P1M-1D` is a valid value.

### Literals and text

```sql
INTERVAL 'P1Y2M3DT4H5M6S'      -- ISO 8601 duration
INTERVAL 'PT36H'               -- stays 36 hours, never becomes a day and a half
INTERVAL '3' DAY               -- a whole number and one unit
INTERVAL '-2' MONTH
CAST('P14D' AS INTERVAL)       -- same text rules as the literal
CAST(INTERVAL 'P2W' AS STRING) -- 'P14D'
```

The bare form takes an ISO 8601 duration: `P`, then any of `nY`, `nM`, `nW`,
`nD`, then optionally `T` followed by any of `nH`, `nM`, `nS`. Components may
be left out but at least one must be present, and a `T` must be followed by
a time component. Only seconds may carry a fraction, kept to the microsecond.
A leading `-` negates the whole duration and each component may also carry
its own sign. The unit form takes a whole number and one of `YEAR`, `MONTH`,
`WEEK`, `DAY`, `HOUR`, `MINUTE`, `SECOND`, singular or plural.

Rendering, whether by `CAST(... AS STRING)`, by the command line or by
`EXPLAIN`, produces the same ISO 8601 text: months as years and months, the
time part as hours, minutes and seconds, zero components omitted, and `PT0S`
for a zero interval. Nothing crosses a field, so `PT36H` renders as `PT36H`
and `P14M` as `P1Y2M`.

Text that does not follow these rules is a parse error in a literal and, in a
`CAST`, `NULL` unless the session sets `strict_casts`.

### Arithmetic

| Expression | Result |
| --- | --- |
| `interval + interval`, `interval - interval`, `-interval` | `INTERVAL`, field by field |
| `date + interval`, `timestamp + interval`, `interval + date` | `TIMESTAMP` |
| `date - interval`, `timestamp - interval` | `TIMESTAMP` |
| `timestamp - timestamp`, `timestamp - date`, `date - timestamp` | `INTERVAL` with days and seconds, no months |
| `date - date` | `INTEGER` days, as `date_diff` |
| `interval * number`, `number * interval`, `interval / number` | `INTERVAL` |

Adding an interval to a date or timestamp applies the months first, clamping
the day to the last day of the target month, then the days, then the seconds:

```sql
CAST('2024-01-31' AS DATE) + INTERVAL 'P1M'                 -- 2024-02-29 00:00:00
CAST('2024-01-31' AS DATE) + INTERVAL 'P1M' + INTERVAL 'P1M' -- 2024-03-29 00:00:00
CAST('2024-01-31' AS DATE) + INTERVAL 'P2M'                 -- 2024-03-31 00:00:00
CAST('2024-01-29' AS DATE) + INTERVAL 'P1M2D'               -- 2024-03-02 00:00:00
CAST('2024-01-29' AS DATE) + INTERVAL 'P2D' + INTERVAL 'P1M' -- 2024-02-29 00:00:00
```

A timestamp minus a timestamp has a whole number of days, truncated toward
zero, and the remaining seconds: `2024-03-01 00:00` minus `2024-01-31 10:00`
is `P29DT14H`.

Scaling keeps whole months and whole days and carries the fractions down:
a fractional month becomes days at thirty per month and a fractional day
becomes seconds at 86400 per day, rounded to the microsecond. So
`INTERVAL 'P1M' / 2` is `P15D`, `INTERVAL 'P1M' / 3` is `P10D`,
`INTERVAL 'P1M' * 1.5` is `P1M15D` and `INTERVAL 'P1D' / 4` is `PT6H`.
Division by zero is an error, as for numbers.

Any other combination, such as `interval + integer` or `interval * interval`,
is a type error.

### Comparison, ordering and grouping

Comparing two intervals, sorting by one, and treating two as the same key in
`GROUP BY`, `DISTINCT`, `UNION` or an equi-join all use one rule: a month
counts as thirty days and a day as twenty-four hours. So `INTERVAL 'P1M' =
INTERVAL 'P30D'` and `INTERVAL 'P1D' = INTERVAL 'PT24H'` are both `TRUE`, and
`P29D < P1M < P30DT1H < P31D`. This is a rule about comparison only; adding
`P1M` and `P30D` to the same date can give different days.

### Functions

`SUM` adds intervals field by field, `AVG` divides that total by the count
with the scaling rule above, and `MIN` and `MAX` follow the comparison rule.
`extract` reads one stored field of an interval: `year` and `month` split the
month count, `hour`, `minute` and `second` split the time part, `day` is the
day count, and nothing crosses a field. `extract('month', INTERVAL 'P14M')`
is `2`, `extract('hour', INTERVAL 'PT36H')` is `36` and `extract('day',
INTERVAL 'PT36H')` is `0`. Each part keeps the sign of its field.

Rows registered from Python may hold `datetime.timedelta` values; they arrive
as intervals with no month part.

## Operators

| Precedence | Operators |
| --- | --- |
| lowest | `OR` |
| | `AND` |
| | `NOT` |
| | `=`, `<>`, `!=`, `<`, `<=`, `>`, `>=`, `IS [NOT] NULL`, `[NOT] IN`, `[NOT] BETWEEN`, `[NOT] LIKE` |
| | `\|\|` |
| | `+`, `-` |
| | `*`, `/`, `%` |
| highest | unary `-`, unary `+` |

`/` always produces `DOUBLE` for numbers. `/` and `%` by zero raise an error
rather than returning `NULL`. `%` takes the sign of its left operand. Dates,
timestamps and intervals take part in `+`, `-`, `*` and `/` as described
under Intervals.

### Null semantics

Comparison and arithmetic propagate `NULL`. `AND` is `FALSE` if either side is
`FALSE` even when the other is `NULL`; `OR` is `TRUE` if either side is `TRUE`.
`WHERE` and `HAVING` keep only rows whose predicate is exactly `TRUE`.

`x IN (1, NULL)` is `TRUE` when `x = 1`, and `NULL` otherwise. `IS NULL` and
`IS NOT NULL` never return `NULL`.

`GROUP BY`, `DISTINCT` and `UNION` treat two `NULL`s as the same value even
though `NULL = NULL` is unknown. Equi-joins never match on `NULL`.

## `CASE`

Both forms are accepted; the simple form is rewritten into the searched form.

```sql
CASE WHEN qty > 10 THEN 'bulk' WHEN qty > 0 THEN 'retail' ELSE 'none' END
CASE status WHEN 'new' THEN 1 WHEN 'old' THEN 2 END
```

All branch results must unify to one type. A `CASE` with no matching branch and
no `ELSE` is `NULL`.

## `LIKE`

`%` matches any run of characters, `_` matches exactly one. `ESCAPE` takes a
single-character string that makes the following wildcard literal.

```sql
WHERE code LIKE 'A!_%' ESCAPE '!'
```

Matching is case sensitive.

## Joins

```sql
FROM a JOIN b ON a.id = b.a_id
FROM a LEFT [OUTER] JOIN b ON a.id = b.a_id
FROM a RIGHT [OUTER] JOIN b ON a.id = b.a_id
FROM a FULL  [OUTER] JOIN b ON a.id = b.a_id
FROM a CROSS JOIN b
FROM a, b                      -- same as CROSS JOIN
FROM a JOIN b USING (id, day)  -- expands to equalities on both sides
```

Every join except `CROSS` requires `ON` or `USING`. A condition attached to an
outer join participates in matching, so a left row that fails it is padded with
nulls rather than dropped -- which is different from putting the same predicate
in `WHERE`.

## Grouping

`GROUP BY` accepts columns, arbitrary expressions, and 1-based select-list
ordinals. Every select-list item must be a group key, an aggregate, or built
only from those.

```sql
SELECT city, COUNT(*) FROM customers GROUP BY city
SELECT city, COUNT(*) FROM customers GROUP BY 1
SELECT UPPER(city) AS c, COUNT(*) FROM customers GROUP BY UPPER(city)
```

Grouping is inferred when an aggregate appears without `GROUP BY`, in which case
the whole input forms one group. An ungrouped aggregate over an empty input
still produces one row: `COUNT(*)` is `0`, everything else is `NULL`. A grouped
aggregate over an empty input produces no rows at all.

`HAVING` filters groups and may reference group keys and aggregates. It requires
grouping; use `WHERE` to filter individual rows.

## Ordering and paging

```sql
ORDER BY revenue DESC NULLS LAST, name ASC
ORDER BY 2 DESC
ORDER BY alias
```

Sort keys may be select-list aliases, 1-based ordinals, or expressions over the
input. Null placement defaults to the session's `null_ordering` setting
(`nulls_last` out of the box). Sorting is stable, so equal keys keep input
order.

`LIMIT` and `OFFSET` take non-negative integer literals.

## Aggregate functions

| Function | Notes |
| --- | --- |
| `COUNT(*)`, `COUNT(x)` | `COUNT(*)` counts rows, `COUNT(x)` skips nulls |
| `SUM(x)` | `NULL` for an all-null group; stays integral for integers, intervals add field by field |
| `AVG(x)`, `MEAN(x)` | `DOUBLE` for numbers, `INTERVAL` for intervals |
| `MIN(x)`, `MAX(x)` | Nulls ignored; intervals compare at thirty-day months |
| `ANY_VALUE(x)` | First non-null value in input order |
| `BOOL_AND(x)`, `EVERY(x)`, `BOOL_OR(x)` | Nulls ignored |
| `STRING_AGG(x [, sep])` | Separator defaults to `,` |
| `VAR_POP`, `VAR_SAMP`, `STDDEV_POP`, `STDDEV_SAMP`, `STDDEV` | Welford's algorithm |

`DISTINCT` is accepted by every aggregate except `ANY_VALUE`.

## Scalar functions

**Strings** `upper`/`ucase`, `lower`/`lcase`, `length`/`char_length`, `trim`,
`ltrim`, `rtrim`, `substr`/`substring`, `replace`, `concat`, `concat_ws`,
`position`/`strpos`, `left`, `right`, `lpad`, `rpad`, `reverse`, `repeat`,
`starts_with`, `ends_with`, `split_part`, `like`.

String positions are 1-based. A negative `substr` start counts from the end.

**Numbers** `abs`, `sign`, `ceil`, `floor`, `round`, `trunc`, `sqrt`,
`power`/`pow`, `exp`, `ln`, `log`, `mod`, `greatest`, `least`.

`greatest` and `least` ignore nulls instead of propagating them.

**Dates** `extract`, `date_trunc`, `date_add`, `date_diff`, `year`, `month`,
`day`, `to_date`, `format_date`, `now`, `current_date`.

`extract` fields: `year`, `quarter`, `month`, `week`, `day`, `dayofweek`
(1 = Monday), `dayofyear`, `hour`, `minute`, `second`. On an interval only
`year`, `month`, `day`, `hour`, `minute` and `second` are defined, each reading
a stored field. `date_trunc` units:
`year`, `quarter`, `month`, `week`, `day`, `hour`, `minute`, `second`.

**Conditionals** `coalesce`, `nullif`, `ifnull`/`nvl`, `is_null`, `if`.

**Conversions** `to_string`/`str`, `to_integer`/`int`, `to_double`/`float`,
`to_boolean`/`bool`, `to_timestamp`, `to_date_strict`, `typeof`.

A failed `CAST` yields `NULL` unless the session sets `strict_casts`.

## Metadata statements

```sql
EXPLAIN SELECT ...            -- optimized logical plan
EXPLAIN VERBOSE SELECT ...    -- plus the unoptimized and physical plans
SHOW TABLES
SHOW COLUMNS FROM customers
DESCRIBE customers            -- synonym for SHOW COLUMNS
```

## Not implemented

Subqueries (scalar, `IN`, `EXISTS`), common table expressions, window functions
and `OVER`, `INTERSECT` and `EXCEPT`, `GROUPING SETS` / `ROLLUP` / `CUBE`,
`INSERT` / `UPDATE` / `DELETE` / `CREATE`, transactions, and prepared statement
parameters.
