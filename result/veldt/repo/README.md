# veldt

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

`veldt` is a small analytical query engine written in pure Python. It takes a
SQL `SELECT` statement, turns it into a logical plan, rewrites that plan with a
handful of optimizer rules, compiles it into a tree of pull-based physical
operators, and streams column-oriented record batches through them.

It exists because most Python "query engine" code either wraps a C library or
stops at a toy `eval()` over dictionaries. `veldt` sits in between: real schema
resolution, real null semantics, real plan rewriting, and a batch-at-a-time
execution model — but small enough to read end to end.

## Quick start

```python
from veldt import Engine

engine = Engine()
engine.register_csv("trips", "data/trips.csv")

result = engine.sql(
    """
    SELECT driver, COUNT(*) AS trips, ROUND(AVG(fare), 2) AS avg_fare
    FROM trips
    WHERE fare > 0 AND status <> 'cancelled'
    GROUP BY driver
    HAVING COUNT(*) >= 5
    ORDER BY avg_fare DESC
    LIMIT 10
    """
)

for row in result.to_dicts():
    print(row)
```

## Command line

```
veldt query --csv trips=data/trips.csv "SELECT status, COUNT(*) FROM trips GROUP BY status"
veldt explain --csv trips=data/trips.csv "SELECT * FROM trips WHERE fare > 10"
veldt schema --csv trips=data/trips.csv trips
```

## Layout

| Package | Responsibility |
| --- | --- |
| `veldt.types` | Data types, fields, schemas, casting rules |
| `veldt.core` | Columns, record batches, tables, query results |
| `veldt.expr` | Expression AST, tokenizer, parser, functions, evaluation |
| `veldt.plan` | Logical plan nodes, optimizer rules, statistics |
| `veldt.execution` | Physical planner and pull-based operators |
| `veldt.sql` | SQL surface: keywords, lexer, statement parser, compiler |
| `veldt.storage` | Data sources, catalog, partitioning, caching |
| `veldt.io` | Readers and writers for CSV / JSON Lines |
| `veldt.cli` | Command line front end |
| `veldt.observability` | Metrics, tracing spans, logging helpers |
| `veldt.utils` | Small shared helpers with no engine dependencies |

## What it supports

`SELECT` with projections and aliases, `WHERE`, `GROUP BY`, `HAVING`,
`ORDER BY` (with `ASC`/`DESC` and `NULLS FIRST`/`LAST`), `LIMIT`/`OFFSET`,
`DISTINCT`, `UNION [ALL]`, and inner, left, right, full and cross joins.
Expressions cover arithmetic, comparison, three-valued logic, `IN`, `BETWEEN`,
`LIKE`, `CASE` and `CAST`, over 45 scalar functions and 12 aggregates — all of
which an embedding application can extend.

See [docs/sql-support.md](docs/sql-support.md) for the exact surface, and
[docs/architecture.md](docs/architecture.md) for how a statement becomes rows.

## Design notes

* **Nulls are `None`.** Every comparison and arithmetic operator propagates
  nulls; boolean `AND`/`OR` use SQL three-valued logic.
* **Batches, not rows.** Operators consume and produce `RecordBatch` objects.
  The batch size is a knob on `ExecutionContext`, not a global.
* **Plans are immutable.** Optimizer rules return new nodes; nothing is mutated
  in place, which keeps rule composition honest.
* **No third-party runtime dependencies.** The engine only needs the standard
  library; `pytest` is required to run the test suite.

## Tests

```
python -m pytest          # the whole suite
make example              # the quickstart tour
```

The suite covers each layer on its own and then checks the properties that
must hold across all of them: that optimization never changes an answer, that
batch size never changes an answer, and that repeated runs agree.
