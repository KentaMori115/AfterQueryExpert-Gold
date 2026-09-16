//! Integration tests for error classification.

mod common;

use common::seeded;
use tanager::{Database, ErrorKind};

#[test]
fn parse_error_on_malformed_sql() {
    let mut db = Database::new();
    assert_eq!(
        db.query("SELECT FROM t").unwrap_err().kind(),
        ErrorKind::Parse
    );
    assert_eq!(
        db.query("SELECT 1 2 3").unwrap_err().kind(),
        ErrorKind::Parse
    );
}

#[test]
fn lex_error_on_unterminated_string() {
    let mut db = Database::new();
    assert_eq!(
        db.query("SELECT 'unterminated").unwrap_err().kind(),
        ErrorKind::Lex
    );
}

#[test]
fn binder_error_on_unknown_table() {
    let mut db = seeded();
    assert_eq!(
        db.query("SELECT * FROM nonexistent").unwrap_err().kind(),
        ErrorKind::Catalog
    );
}

#[test]
fn binder_error_on_unknown_column() {
    let mut db = seeded();
    assert_eq!(
        db.query("SELECT nope FROM employees").unwrap_err().kind(),
        ErrorKind::Binder
    );
}

#[test]
fn type_error_in_arithmetic() {
    let mut db = seeded();
    assert_eq!(
        db.query("SELECT name + 1 FROM employees")
            .unwrap_err()
            .kind(),
        ErrorKind::Type
    );
}

#[test]
fn type_error_in_where_non_boolean() {
    let mut db = seeded();
    assert_eq!(
        db.query("SELECT id FROM employees WHERE salary")
            .unwrap_err()
            .kind(),
        ErrorKind::Binder
    );
}

#[test]
fn execution_error_on_division_by_zero() {
    let mut db = seeded();
    assert_eq!(
        db.query("SELECT salary / 0 FROM employees")
            .unwrap_err()
            .kind(),
        ErrorKind::Execution
    );
}

#[test]
fn non_grouped_column_is_rejected() {
    let mut db = seeded();
    assert_eq!(
        db.query("SELECT name, COUNT(*) FROM employees GROUP BY dept_id")
            .unwrap_err()
            .kind(),
        ErrorKind::Binder
    );
}

#[test]
fn aggregate_in_where_is_rejected() {
    let mut db = seeded();
    // Aggregates belong in HAVING, not WHERE.
    assert_eq!(
        db.query("SELECT id FROM employees WHERE COUNT(*) > 1")
            .unwrap_err()
            .kind(),
        ErrorKind::Binder
    );
}

#[test]
fn having_without_grouping_is_rejected() {
    let mut db = seeded();
    let err = db
        .query("SELECT name FROM employees HAVING id > 1")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn query_on_non_select_statement_errors() {
    let mut db = seeded();
    // execute() of a DDL is fine, but query() requires a result set.
    let err = db.query("CREATE TABLE z (a INTEGER)").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Api);
}
