# tanager

**tanager** is an embeddable, in-memory analytical SQL query engine written in
Rust with **zero external dependencies**. It parses a substantial SQL subset,
binds and type-checks it against an in-memory catalog, applies rule-based
optimizations, and executes the resulting plan over columnar tables.

It is small enough to read end to end, but complete enough to run real analytical
queries: joins, grouping and aggregation, sorting with explicit NULL ordering,
scalar and aggregate functions, and SQL's three-valued (NULL) logic throughout.

```rust
use tanager::Database;

let mut db = Database::new();
db.execute("CREATE TABLE employees (id INTEGER, name TEXT, dept_id INTEGER, salary INTEGER)").unwrap();
db.execute("INSERT INTO employees VALUES (1, 'Ada', 1, 160000), (2, 'Grace', 1, 150000), (3, 'Tim', 2, 90000)").unwrap();

let result = db
    .query("SELECT dept_id, COUNT(*), AVG(salary) AS avg_pay
            FROM employees GROUP BY dept_id ORDER BY dept_id")
    .unwrap();

println!("{}", tanager::render_table(&result));
// dept_id | count | avg_pay
// --------+-------+---------
// 1       | 2     | 155000.0
// 2       | 1     | 90000.0
// (2 rows)
```

## Features

- **DDL / DML** — `CREATE TABLE` (with `NOT NULL` and `IF NOT EXISTS`),
  `DROP TABLE`, and multi-row `INSERT` with optional column lists. Inserts are
  atomic: a row that violates a type or `NOT NULL` constraint rejects the whole
  statement.
- **Queries** — `SELECT` with projection and aliases, `WHERE`, `INNER`/`LEFT`
  joins (with table aliases and self-joins), `GROUP BY` / `HAVING`, `DISTINCT`,
  `ORDER BY` (ASC/DESC, `NULLS FIRST`/`LAST`, positional and non-projected keys),
  and `LIMIT` / `OFFSET`.
- **Expressions** — arithmetic, comparison, `AND`/`OR`/`NOT`, `BETWEEN`, `IN`,
  `LIKE` (`%` and `_`), `IS [NOT] NULL`, `CAST`, and searched/simple `CASE`.
- **Functions** — a broad scalar library (math: `ABS`, `ROUND`, `CEIL`, `FLOOR`,
  `MOD`, `POWER`, `SQRT`, `SIGN`, `GREATEST`, `LEAST`; text: `LENGTH`, `UPPER`,
  `LOWER`, `TRIM`, `LTRIM`, `RTRIM`, `SUBSTR`, `CONCAT`, `REPLACE`, `REVERSE`,
  `REPEAT`, `LPAD`, `RPAD`, `INSTR`; general: `COALESCE`, `NULLIF`) and aggregates
  (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `GROUP_CONCAT`, `VAR_POP`, `STDDEV_POP`,
  all with optional `DISTINCT`), plus the `||` concatenation operator.
- **Typing** — a small static type system (`INTEGER`, `FLOAT`, `TEXT`,
  `BOOLEAN`, `NULL`) with integer→float promotion and full type checking at bind
  time.
- **NULL semantics** — SQL three-valued logic everywhere: comparisons yield
  `NULL`, predicates keep only `TRUE` rows, arithmetic propagates `NULL`, and
  division/modulo by zero is a deterministic error rather than an infinity.
- **Optimizer** — a rule-based, fixpoint optimizer with constant folding
  (conservative: never folds an expression whose evaluation would error) and
  predicate pushdown into join inputs.
- **Determinism** — grouping and `DISTINCT` preserve first-seen order and sorts
  are stable, so identical inputs always render identical output.

## Architecture

The engine is a pipeline of stages, each in its own module under `src/`:

| Stage | Module | Responsibility |
|-------|--------|----------------|
| Types | `types` | Logical types, runtime `Value`s (three-valued ops, casting), schemas |
| Storage | `storage` | Columnar `Table`s, `Row`s, and the `Catalog` |
| Parse | `parser` | Lexer, tokens/keywords, and a Pratt parser producing the AST |
| AST | `ast` | Expression and statement syntax trees |
| Plan | `planner` | Name/type binding, aggregate lifting, the typed `LogicalPlan` |
| Optimize | `optimizer` | `OptimizerRule` trait, fixpoint driver, folding + pushdown |
| Execute | `exec` | Expression evaluator and materializing physical operators |
| Functions | `functions` | Scalar and aggregate function registries |

The top-level `Database` (`api`) wires the pipeline together, and `format`
renders result sets as aligned ASCII tables.

```
SQL text
  │  parser::parse_statement
  ▼
AST (ast::Statement)
  │  planner::Binder            name resolution + type checking
  ▼
LogicalPlan (typed)
  │  optimizer::Optimizer       constant folding, predicate pushdown
  ▼
LogicalPlan (optimized)
  │  exec::Executor             materializing operators
  ▼
Rows  ──►  format::render_table
```

## Command-line runner

The crate ships a small `tanager` binary that runs SQL from arguments or standard
input:

```console
$ tanager "CREATE TABLE t (id INTEGER, name TEXT);
           INSERT INTO t VALUES (1, 'ada'), (2, 'grace');
           SELECT * FROM t ORDER BY id DESC"
CREATE TABLE t
INSERT 2
id | name
---+------
2  | grace
1  | ada
(2 rows)
```

## Supported SQL grammar (informal)

```
statement   := select | insert | create_table | drop_table
select      := SELECT [DISTINCT] select_list
               [FROM table [alias] { join }]
               [WHERE expr]
               [GROUP BY expr {, expr} [HAVING expr]]
               [ORDER BY sort_key {, sort_key}]
               [LIMIT n] [OFFSET n]
join        := [INNER | LEFT] JOIN table [alias] ON expr
sort_key    := expr [ASC | DESC] [NULLS (FIRST | LAST)]
insert      := INSERT INTO table [ ( col {, col} ) ] VALUES tuple {, tuple}
create_table:= CREATE TABLE [IF NOT EXISTS] table ( col type [NOT NULL] {, ...} )
type        := INTEGER | FLOAT | TEXT | BOOLEAN
```

## Building and testing

```console
$ cargo build
$ cargo test
```

The test suite combines module-level unit tests with end-to-end integration tests
under `tests/` that exercise the engine through the public `Database` API.

## License

MIT. See [LICENSE](LICENSE).
