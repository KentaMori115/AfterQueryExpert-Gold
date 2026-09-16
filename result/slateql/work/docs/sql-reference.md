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

## Types

`BOOLEAN`, `INTEGER`, `DOUBLE`, `STRING`, `DATE`, `TIMESTAMP`, `INTERVAL`.

Common aliases are accepted in `CAST`: `int`, `bigint`, `smallint` map to
`INTEGER`; `float`, `real`, `decimal`, `numeric` map to `DOUBLE`; `text`,
`varchar`, `char` map to `STRING`; `datetime` maps to `TIMESTAMP`. Length and
precision modifiers such as `VARCHAR(32)` parse and are discarded.

Implicit widening is narrow by design: `INTEGER` widens to `DOUBLE`, `DATE`
widens to `TIMESTAMP`, and `NULL` unifies with anything. Everything else needs
an explicit `CAST`.

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

`/` always produces `DOUBLE`. `/` and `%` by zero raise an error rather than
returning `NULL`. `%` takes the sign of its left operand.

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
| `SUM(x)` | `NULL` for an all-null group; stays integral for integers |
| `AVG(x)`, `MEAN(x)` | Always `DOUBLE` |
| `MIN(x)`, `MAX(x)` | Nulls ignored |
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
(1 = Monday), `dayofyear`, `hour`, `minute`, `second`. `date_trunc` units:
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
SHOW INDEXES                  -- every index in the catalog
SHOW INDEXES FROM customers   -- just one table's
```

`SHOW INDEXES` reports `table_name`, `column_name`, `kind`, `entries`,
`distinct_keys` and `has_nulls`, ordered by table and then by column.
`entries` counts every row the index was built from, including rows whose key
is null, and `has_nulls` reads `YES` or `NO` the way `SHOW COLUMNS` reports
nullability.

Indexes are created from the embedding code rather than in SQL:

```python
session.create_index("orders", "customer_id")             # hash
session.create_index("orders", "ordered_on", kind="sorted")
session.drop_index("orders", "customer_id")               # True if one went
```

A hash index answers equality, `IN` and `IS NULL`. A sorted index answers
equality, `IN` and ranges, and can also supply `ORDER BY` on its own column
without a sort. Neither changes a result: same rows, same order, fewer of
them read.

## Not implemented

Subqueries (scalar, `IN`, `EXISTS`), common table expressions, window functions
and `OVER`, `INTERSECT` and `EXCEPT`, `GROUPING SETS` / `ROLLUP` / `CUBE`,
`INSERT` / `UPDATE` / `DELETE` / `CREATE`, transactions, and prepared statement
parameters.
