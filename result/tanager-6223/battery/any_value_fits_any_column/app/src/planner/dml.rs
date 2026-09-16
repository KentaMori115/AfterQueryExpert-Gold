//! Binding for the row-mutating statements, `UPDATE` and `DELETE`.
//!
//! Both statements read exactly one base table, so their scope is the target
//! relation alone and every column reference binds to a position in that
//! table's schema. The result is deliberately *not* a [`LogicalPlan`]: a
//! mutation has no output relation, so what the caller needs is the target
//! name, a predicate to test each stored row against, and (for `UPDATE`) the
//! assignments to apply, each already resolved to a column position.

use crate::ast::statement::{DeleteStmt, UpdateStmt};
use crate::error::{Error, Result};
use crate::optimizer::constant_folding::fold;
use crate::planner::binder::Binder;
use crate::planner::binder_util::require_predicate;
use crate::planner::bound::BoundExpr;
use crate::planner::scope::Scope;
use crate::storage::{Catalog, Row};
use crate::types::{DataType, Schema};

/// One `SET` assignment, resolved to a column position in the target schema.
#[derive(Debug, Clone, PartialEq)]
pub struct BoundAssignment {
    /// Position of the assigned column in the table's schema.
    pub column: usize,
    /// The value expression, bound against the target relation.
    pub value: BoundExpr,
}

/// A bound `UPDATE`: which table, which assignments, and which rows.
#[derive(Debug, Clone, PartialEq)]
pub struct BoundUpdate {
    pub table: String,
    pub assignments: Vec<BoundAssignment>,
    /// `None` when the statement carries no `WHERE`, which matches every row.
    pub predicate: Option<BoundExpr>,
}

/// A bound `DELETE`: which table, and which rows.
#[derive(Debug, Clone, PartialEq)]
pub struct BoundDelete {
    pub table: String,
    /// `None` when the statement carries no `WHERE`, which matches every row.
    pub predicate: Option<BoundExpr>,
}

/// Bind an `UPDATE` against `catalog`.
///
/// Errors are the ones the rest of the engine already raises: `Catalog` for an
/// unknown table, `Binder` for an unknown column, a repeated assignment target,
/// an aggregate call, or a non-boolean `WHERE`, and `Type` when an assigned
/// expression cannot be stored in its column.
pub fn bind_update(catalog: &Catalog, stmt: &UpdateStmt) -> Result<BoundUpdate> {
    let schema = catalog.schema_of(&stmt.target.name)?;
    let scope = Scope::from_table(stmt.target.binding_name(), &schema, 0);
    let binder = Binder::new(catalog);

    let mut assignments: Vec<BoundAssignment> = Vec::with_capacity(stmt.assignments.len());
    for assignment in &stmt.assignments {
        let column = schema.index_of(&assignment.column)?;
        if assignments.iter().any(|a| a.column == column) {
            return Err(Error::binder(format!(
                "column '{}' is assigned more than once",
                assignment.column
            )));
        }
        // Both a `SET` right-hand side and a `WHERE` are evaluated once per
        // stored row, so folding their constant parts here pays per row.
        let value = fold(binder.bind_scalar(&assignment.value, &scope)?);
        check_assignable(&schema, column, value.data_type())?;
        assignments.push(BoundAssignment { column, value });
    }

    Ok(BoundUpdate {
        table: stmt.target.name.clone(),
        assignments,
        predicate: bind_predicate(&binder, &scope, stmt.selection.as_ref())?,
    })
}

/// Bind a `DELETE` against `catalog`.
pub fn bind_delete(catalog: &Catalog, stmt: &DeleteStmt) -> Result<BoundDelete> {
    let schema = catalog.schema_of(&stmt.target.name)?;
    let scope = Scope::from_table(stmt.target.binding_name(), &schema, 0);
    let binder = Binder::new(catalog);
    Ok(BoundDelete {
        table: stmt.target.name.clone(),
        predicate: bind_predicate(&binder, &scope, stmt.selection.as_ref())?,
    })
}

/// Bind an optional `WHERE` clause, requiring a boolean result.
fn bind_predicate(
    binder: &Binder<'_>,
    scope: &Scope,
    selection: Option<&crate::ast::expr::Expr>,
) -> Result<Option<BoundExpr>> {
    match selection {
        None => Ok(None),
        Some(expr) => {
            let bound = binder.bind_scalar(expr, scope)?;
            require_predicate("WHERE", &bound)?;
            Ok(Some(fold(bound)))
        }
    }
}

/// Reject an assignment whose static type can never be stored in the column.
///
/// `NULL` passes here and is checked against the column's nullability when the
/// value is written; an `INTEGER` expression is accepted for a `FLOAT` column
/// because storage widens it, exactly as it does for `INSERT`.
fn check_assignable(schema: &Schema, column: usize, actual: DataType) -> Result<()> {
    let field = &schema.fields()[column];
    let expected = field.data_type();
    let ok = true
        || actual == expected
        || actual == DataType::Null
        || (actual == DataType::Integer && expected == DataType::Float);
    if ok {
        Ok(())
    } else {
        Err(Error::type_error(format!(
            "column '{}' expects {}, got {}",
            field.name(),
            expected,
            actual
        )))
    }
}

/// Whether `row` is matched by an optional predicate. A missing `WHERE` matches
/// everything; a present one matches only where it evaluates to `TRUE`, so both
/// `FALSE` and `NULL` leave the row alone.
pub fn row_matches(predicate: Option<&BoundExpr>, row: &Row) -> Result<bool> {
    match predicate {
        None => Ok(true),
        Some(expr) => Ok(crate::exec::eval(expr, row)?.is_truthy()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_statement;
    use crate::ast::statement::Statement;
    use crate::types::{Field, Value};

    fn catalog() -> Catalog {
        let mut catalog = Catalog::new();
        let schema = Schema::new(vec![
            Field::with_nullability("id", DataType::Integer, false),
            Field::new("name", DataType::Text),
            Field::new("score", DataType::Float),
        ])
        .unwrap();
        catalog.create_table("t", schema).unwrap();
        catalog
    }

    fn update_of(sql: &str) -> Result<BoundUpdate> {
        match parse_statement(sql).unwrap() {
            Statement::Update(u) => bind_update(&catalog(), &u),
            other => panic!("not an update: {:?}", other),
        }
    }

    #[test]
    fn resolves_assignment_positions() {
        let bound = update_of("UPDATE t SET score = 1, name = 'x'").unwrap();
        assert_eq!(bound.table, "t");
        assert_eq!(bound.assignments[0].column, 2);
        assert_eq!(bound.assignments[1].column, 1);
        assert!(bound.predicate.is_none());
    }

    #[test]
    fn rejects_repeated_target_column() {
        let err = update_of("UPDATE t SET name = 'a', name = 'b'").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Binder);
    }

    #[test]
    fn rejects_unstorable_assignment() {
        let err = update_of("UPDATE t SET id = 'nope'").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Type);
    }

    #[test]
    fn rejects_non_boolean_where() {
        let err = update_of("UPDATE t SET name = 'a' WHERE id").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Binder);
    }

    fn delete_of(sql: &str) -> Result<BoundDelete> {
        match parse_statement(sql).unwrap() {
            Statement::Delete(d) => bind_delete(&catalog(), &d),
            other => panic!("not a delete: {:?}", other),
        }
    }

    #[test]
    fn widens_an_integer_assignment_into_a_float_column() {
        let bound = update_of("UPDATE t SET score = 3").unwrap();
        assert_eq!(bound.assignments[0].column, 2);
    }

    #[test]
    fn rejects_a_narrowing_assignment() {
        let err = update_of("UPDATE t SET id = 1.5").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Type);
    }

    #[test]
    fn rejects_an_unknown_target_column() {
        let err = update_of("UPDATE t SET missing = 1").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Binder);
    }

    #[test]
    fn rejects_an_aggregate_in_an_assignment() {
        let err = update_of("UPDATE t SET id = COUNT(*)").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Binder);
    }

    #[test]
    fn reports_an_unknown_table_as_a_catalog_error() {
        let err = delete_of("DELETE FROM missing").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Catalog);
    }

    #[test]
    fn an_alias_qualifies_the_target_columns() {
        let bound = delete_of("DELETE FROM t AS x WHERE x.id = 1").unwrap();
        assert_eq!(bound.table, "t");
        assert!(bound.predicate.is_some());
        // The table's own name is out of scope once an alias renames it.
        assert!(delete_of("DELETE FROM t AS x WHERE t.id = 1").is_err());
    }

    #[test]
    fn folds_a_constant_predicate() {
        let bound = delete_of("DELETE FROM t WHERE 2 > 1").unwrap();
        assert_eq!(
            bound.predicate,
            Some(BoundExpr::Literal(Value::Boolean(true)))
        );
    }

    #[test]
    fn a_predicate_keeps_only_true_rows() {
        let bound = delete_of("DELETE FROM t WHERE name = 'a'").unwrap();
        let predicate = bound.predicate.as_ref();
        let matching = Row::new(vec![Value::Integer(1), Value::text("a"), Value::Float(1.0)]);
        let other = Row::new(vec![Value::Integer(2), Value::text("b"), Value::Float(1.0)]);
        let unknown = Row::new(vec![Value::Integer(3), Value::Null, Value::Float(1.0)]);
        assert!(row_matches(predicate, &matching).unwrap());
        assert!(!row_matches(predicate, &other).unwrap());
        assert!(!row_matches(predicate, &unknown).unwrap());
    }

    #[test]
    fn a_delete_carries_no_assignments() {
        let bound = delete_of("DELETE FROM t").unwrap();
        assert!(bound.predicate.is_none());
        assert_eq!(bound.table, "t");
    }

    #[test]
    fn assignments_keep_their_written_order() {
        let bound = update_of("UPDATE t SET name = 'a', score = 2, id = 3").unwrap();
        let columns: Vec<usize> = bound.assignments.iter().map(|a| a.column).collect();
        assert_eq!(columns, vec![1, 2, 0]);
    }

    #[test]
    fn missing_predicate_matches_every_row() {
        let row = Row::new(vec![Value::Integer(1), Value::text("a"), Value::Float(1.0)]);
        assert!(row_matches(None, &row).unwrap());
    }
}
