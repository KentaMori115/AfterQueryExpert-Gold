//! The high-level embedding API: [`Database`], [`QueryResult`], and [`Outcome`].

use crate::ast::statement::{
    CreateTableStmt, DeleteStmt, DropTableStmt, InsertStmt, SelectStmt, Statement, UpdateStmt,
};
use crate::error::{Error, Result};
use crate::exec::Executor;
use crate::optimizer::Optimizer;
use crate::parser::{parse_program, parse_statement};
use crate::planner::dml::{bind_delete, bind_update, row_matches};
use crate::planner::scope::Scope;
use crate::planner::Binder;
use crate::storage::{Catalog, Row};
use crate::types::{Field, Schema, Value};

/// An embeddable SQL database: an in-memory catalog plus the query pipeline.
///
/// ```
/// use tanager::Database;
/// let mut db = Database::new();
/// db.execute("CREATE TABLE t (id INTEGER, name TEXT)").unwrap();
/// db.execute("INSERT INTO t VALUES (1, 'ada'), (2, 'grace')").unwrap();
/// let result = db.query("SELECT name FROM t WHERE id = 2").unwrap();
/// assert_eq!(result.row_count(), 1);
/// assert_eq!(result.rows()[0].get(0).unwrap().to_string(), "grace");
/// ```
///
/// Stored rows can be rewritten and removed as well:
///
/// ```
/// use tanager::{Database, Outcome};
/// let mut db = Database::new();
/// db.execute("CREATE TABLE t (id INTEGER, name TEXT)").unwrap();
/// db.execute("INSERT INTO t VALUES (1, 'ada'), (2, 'grace')").unwrap();
/// assert_eq!(
///     db.execute("UPDATE t SET name = 'hopper' WHERE id = 2").unwrap(),
///     Outcome::Updated(1)
/// );
/// assert_eq!(
///     db.execute("DELETE FROM t WHERE id = 1").unwrap(),
///     Outcome::Deleted(1)
/// );
/// assert_eq!(db.query("SELECT name FROM t").unwrap().row_count(), 1);
/// ```
pub struct Database {
    catalog: Catalog,
    optimizer: Optimizer,
}

/// The result of a statement that is not a query.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// `CREATE TABLE` succeeded (or was a no-op under `IF NOT EXISTS`).
    TableCreated(String),
    /// `DROP TABLE` succeeded (or was a no-op under `IF EXISTS`).
    TableDropped(String),
    /// `INSERT` added this many rows.
    Inserted(usize),
    /// `UPDATE` left this many rows holding different values.
    Updated(usize),
    /// `DELETE` removed this many rows.
    Deleted(usize),
    /// `SELECT` produced a result set.
    Query(QueryResult),
}

impl Outcome {
    /// Extract the query result, or error if this outcome was not a query.
    pub fn into_query(self) -> Result<QueryResult> {
        match self {
            Outcome::Query(q) => Ok(q),
            _ => Err(Error::api("statement did not produce a result set")),
        }
    }
}

impl Database {
    /// A new, empty database.
    pub fn new() -> Database {
        Database {
            catalog: Catalog::new(),
            optimizer: Optimizer::new(),
        }
    }

    /// Borrow the catalog (for inspection).
    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    /// The names of all tables, in deterministic (case-insensitive) order.
    pub fn table_names(&self) -> Vec<String> {
        self.catalog.table_names()
    }

    /// Whether a table with the given name exists.
    pub fn has_table(&self, name: &str) -> bool {
        self.catalog.contains(name)
    }

    /// Execute a single statement.
    pub fn execute(&mut self, sql: &str) -> Result<Outcome> {
        let stmt = parse_statement(sql)?;
        self.execute_statement(stmt)
    }

    /// Execute a `;`-separated script, returning one outcome per statement.
    pub fn execute_script(&mut self, sql: &str) -> Result<Vec<Outcome>> {
        let stmts = parse_program(sql)?;
        let mut outcomes = Vec::with_capacity(stmts.len());
        for stmt in stmts {
            outcomes.push(self.execute_statement(stmt)?);
        }
        Ok(outcomes)
    }

    /// Execute a statement that must be a `SELECT`, returning its result set.
    pub fn query(&mut self, sql: &str) -> Result<QueryResult> {
        self.execute(sql)?.into_query()
    }

    fn execute_statement(&mut self, stmt: Statement) -> Result<Outcome> {
        match stmt {
            Statement::CreateTable(c) => self.exec_create(c),
            Statement::DropTable(d) => self.exec_drop(d),
            Statement::Insert(i) => self.exec_insert(i),
            Statement::Update(u) => self.exec_update(u),
            Statement::Delete(d) => self.exec_delete(d),
            Statement::Select(s) => Ok(Outcome::Query(self.run_select(&s)?)),
            Statement::Explain(s) => Ok(Outcome::Query(self.run_explain(&s)?)),
        }
    }

    fn run_explain(&self, select: &SelectStmt) -> Result<QueryResult> {
        let plan = Binder::new(&self.catalog).bind_select(select)?;
        let plan = self.optimizer.optimize(plan)?;
        let schema = Schema::new_unchecked(vec![Field::new("plan", crate::types::DataType::Text)]);
        let rows = plan
            .explain_lines()
            .into_iter()
            .map(|line| Row::new(vec![Value::text(line)]))
            .collect();
        Ok(QueryResult { schema, rows })
    }

    fn exec_create(&mut self, stmt: CreateTableStmt) -> Result<Outcome> {
        if stmt.if_not_exists && self.catalog.contains(&stmt.name) {
            return Ok(Outcome::TableCreated(stmt.name));
        }
        let fields = stmt
            .columns
            .iter()
            .map(|c| Field::with_nullability(c.name.clone(), c.data_type, !c.not_null))
            .collect();
        let schema = Schema::new(fields)?;
        self.catalog.create_table(stmt.name.clone(), schema)?;
        Ok(Outcome::TableCreated(stmt.name))
    }

    fn exec_drop(&mut self, stmt: DropTableStmt) -> Result<Outcome> {
        if stmt.if_exists && !self.catalog.contains(&stmt.name) {
            return Ok(Outcome::TableDropped(stmt.name));
        }
        self.catalog.drop_table(&stmt.name)?;
        Ok(Outcome::TableDropped(stmt.name))
    }

    fn exec_insert(&mut self, stmt: InsertStmt) -> Result<Outcome> {
        let schema = self.catalog.schema_of(&stmt.table)?;
        let width = schema.len();

        // Resolve the target column positions for the supplied values.
        let target: Vec<usize> = match &stmt.columns {
            Some(cols) => {
                let mut idxs = Vec::with_capacity(cols.len());
                for c in cols {
                    idxs.push(schema.index_of(c)?);
                }
                idxs
            }
            None => (0..width).collect(),
        };

        // Bind and evaluate the constant value expressions (no column refs).
        let binder = Binder::new(&self.catalog);
        let empty_scope = Scope::empty();
        let empty_row = Row::empty();

        let mut built_rows = Vec::with_capacity(stmt.rows.len());
        for row_exprs in &stmt.rows {
            if row_exprs.len() != target.len() {
                return Err(Error::api(format!(
                    "INSERT into '{}' has {} target column(s) but {} value(s)",
                    stmt.table,
                    target.len(),
                    row_exprs.len()
                )));
            }
            let mut values = vec![Value::Null; width];
            for (expr, &pos) in row_exprs.iter().zip(&target) {
                let bound = binder.bind_scalar(expr, &empty_scope)?;
                values[pos] = crate::exec::eval::eval(&bound, &empty_row)?;
            }
            built_rows.push(Row::new(values));
        }

        // Apply after all rows are built and typed, so a bad row rejects the
        // whole statement without partial insertion.
        let table = self.catalog.table_mut(&stmt.table)?;
        // Validate every row first (dry run) to keep INSERT atomic.
        let mut probe = table.clone();
        for row in &built_rows {
            probe.insert_row(row.clone())?;
        }
        let n = built_rows.len();
        for row in built_rows {
            table.insert_row(row)?;
        }
        Ok(Outcome::Inserted(n))
    }

    /// Apply an `UPDATE`.
    ///
    /// Every candidate row is built and validated before a single column is
    /// touched, so a row the table refuses — a widening that does not exist, a
    /// `NULL` under `NOT NULL` — leaves the whole statement without effect.
    /// Assignments read the row as it stood before the statement, which is what
    /// makes `SET a = b, b = a` a swap rather than two copies of `b`.
    fn exec_update(&mut self, stmt: UpdateStmt) -> Result<Outcome> {
        let bound = bind_update(&self.catalog, &stmt)?;
        let table = self.catalog.table(&bound.table)?;

        let mut pending: Vec<(usize, Row)> = Vec::new();
        for (position, stored) in table.iter_rows().enumerate() {
            if !row_matches(bound.predicate.as_ref(), &stored)? {
                continue;
            }
            let mut values = stored.values().to_vec();
            for assignment in &bound.assignments {
                values[assignment.column] = crate::exec::eval::eval(&assignment.value, &stored)?;
            }
            let candidate = Row::new(values);
            // A matched row whose stored values do not move is not a change.
            if candidate != stored {
                pending.push((position, candidate));
            }
        }

        let changed = pending.len();
        self.catalog.table_mut(&bound.table)?.replace_rows(pending)?;
        Ok(Outcome::Updated(changed))
    }

    /// Apply a `DELETE`, keeping the surviving rows in their stored order.
    fn exec_delete(&mut self, stmt: DeleteStmt) -> Result<Outcome> {
        let bound = bind_delete(&self.catalog, &stmt)?;
        let table = self.catalog.table(&bound.table)?;

        let mut doomed = Vec::with_capacity(table.row_count());
        for stored in table.iter_rows() {
            doomed.push(row_matches(bound.predicate.as_ref(), &stored)?);
        }

        let removed = self.catalog.table_mut(&bound.table)?.remove_rows(&doomed);
        Ok(Outcome::Deleted(removed))
    }

    fn run_select(&self, select: &SelectStmt) -> Result<QueryResult> {
        let plan = Binder::new(&self.catalog).bind_select(select)?;
        let plan = self.optimizer.optimize(plan)?;
        let schema = plan.schema().clone();
        let rows = Executor::new(&self.catalog).execute(&plan)?;
        Ok(QueryResult { schema, rows })
    }
}

impl Default for Database {
    fn default() -> Self {
        Database::new()
    }
}

/// A materialized result set: an output schema and its rows.
#[derive(Debug, Clone, PartialEq)]
pub struct QueryResult {
    schema: Schema,
    rows: Vec<Row>,
}

impl QueryResult {
    /// The output schema (column names and types).
    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    /// The output column names, in order.
    pub fn columns(&self) -> Vec<String> {
        self.schema
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect()
    }

    /// The result rows.
    pub fn rows(&self) -> &[Row] {
        &self.rows
    }

    /// The number of result rows.
    pub fn row_count(&self) -> usize {
        self.rows.len()
    }

    /// Whether the result set is empty.
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Consume the result, returning its rows.
    pub fn into_rows(self) -> Vec<Row> {
        self.rows
    }

    /// The value at `(row, column)`, if in range.
    pub fn value(&self, row: usize, column: usize) -> Option<&Value> {
        self.rows.get(row).and_then(|r| r.get(column))
    }
}
