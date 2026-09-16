# SlateQL

An embeddable analytical SQL engine written in pure Python, with no third-party
runtime dependencies. SlateQL parses SQL, binds and type-checks it against a
catalog, rewrites the logical plan with a rule-based optimizer, and executes the
result with batch-at-a-time volcano operators.

It exists because "run one SQL query over these CSV files" usually turns into
either a pile of ad-hoc pandas code or a database you now have to operate.
SlateQL is a library and a CLI: point it at a file, ask a question, get an
answer back as rows.

```python
from slateql import Session

session = Session()
session.register_csv("orders", "data/orders.csv")
session.register_csv("customers", "data/customers.csv")

result = session.sql("""
    SELECT c.city,
           COUNT(*)                                  AS order_count,
           ROUND(SUM(o.quantity * o.unit_price), 2)  AS revenue
    FROM customers c
    JOIN orders o ON o.customer_id = c.id
    GROUP BY c.city
    ORDER BY revenue DESC
""")

print(result.pretty())
```

```
+------+-------------+---------+
| city | order_count | revenue |
+======+=============+=========+
| Rome | 5           | 896.0   |
| Oslo | 3           | 167.5   |
| Lima | 2           | 165.25  |
+------+-------------+---------+
```

## Install

SlateQL targets Python 3.10 and newer and has no runtime dependencies.

```console
$ python -m pip install -e .
$ python -m pip install -e '.[dev]'   # adds pytest
```

## Command line

```console
$ slateql --csv orders=data/orders.csv query "SELECT COUNT(*) FROM orders"
$ slateql --csv orders=data/orders.csv explain "SELECT * FROM orders WHERE quantity > 2"
$ slateql --jsonl events=data/events.jsonl query "SELECT kind, COUNT(*) FROM events GROUP BY kind" --format csv
$ slateql --csv orders=data/orders.csv --shell
```

Every subcommand shares the registration flags, so `--csv name=path` and
`--jsonl name=path` work everywhere. `slateql functions` lists the built-in
scalar and aggregate functions.

## What the dialect covers

| Area | Supported |
| --- | --- |
| Projection | `SELECT`, `SELECT DISTINCT`, `*`, `alias.*`, `AS` aliases |
| Filtering | `WHERE`, `HAVING`, `AND`/`OR`/`NOT`, `IN`, `BETWEEN`, `LIKE`, `IS NULL` |
| Joins | `INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, `ON` and `USING` |
| Grouping | `GROUP BY` on columns, expressions or ordinals |
| Ordering | `ORDER BY` with `ASC`/`DESC` and `NULLS FIRST`/`NULLS LAST` |
| Paging | `LIMIT`, `OFFSET` |
| Set ops | `UNION`, `UNION ALL` |
| Intervals | `INTERVAL` literals, date and timestamp arithmetic, interval aggregates |
| Expressions | arithmetic, `\|\|`, `CASE`, `CAST`, 60+ scalar and 13 aggregate functions |
| Metadata | `EXPLAIN`, `EXPLAIN VERBOSE`, `SHOW TABLES`, `SHOW COLUMNS`, `DESCRIBE` |

Not implemented yet: subqueries, common table expressions, window functions,
`INTERSECT`/`EXCEPT`, and writes of any kind. The engine is read-only.

## How a query flows through the engine

```
SQL text
  |  slateql.sql          lexer -> parser -> AST
  v
AST
  |  slateql.analyze      scope resolution, type checking, aggregate rewriting
  v
Logical plan
  |  slateql.optimize     constant folding, simplification, predicate pushdown,
  |                       column pruning, limit pushdown, join input ordering
  v
Optimized logical plan
  |  slateql.execution    physical planning (hash join vs nested loop)
  v
Operator tree  ->  record batches  ->  QueryResult
```

`docs/architecture.md` walks through each stage in detail;
`docs/sql-reference.md` is the dialect reference.

## Design notes

* **Determinism.** Nothing in the execution path reads the clock, the network,
  or a hash-order-dependent iteration. Groups are emitted in first-appearance
  order and sorts are stable, so the same query over the same data always
  produces the same rows in the same order.
* **Three-valued logic everywhere.** `NULL` propagates through comparisons and
  arithmetic, `WHERE` keeps only rows that are exactly `TRUE`, and grouping
  treats two `NULL`s as the same key even though comparing them is unknown.
* **Plans are immutable.** Every optimizer rule is a pure function from plan to
  plan, and the pipeline runs to a fixed point, verifying after each rule that
  the output schema did not change.
* **Errors point at the problem.** Parse errors carry a line and column, unknown
  columns and tables suggest close matches, and type errors name both operands.

## Testing

```console
$ python -m pytest
$ python -m ruff check slateql tests conftest.py examples
```

The suite covers each layer in isolation plus end-to-end queries against the
sample files in `data/`.

Continuous integration runs on every push and pull request: the suite executes
against Python 3.10, 3.11 and 3.12, ruff lints the tree with the configuration
in `pyproject.toml`, and a third job installs the package to smoke-test the
example scripts and the command line interface.
