//! Integration tests for CREATE TABLE, INSERT, and DROP TABLE.

mod common;

use tanager::{Database, ErrorKind, Outcome};

#[test]
fn create_insert_select_roundtrip() {
    let mut db = Database::new();
    assert_eq!(
        db.execute("CREATE TABLE t (id INTEGER, name TEXT)")
            .unwrap(),
        Outcome::TableCreated("t".to_string())
    );
    assert_eq!(
        db.execute("INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c')")
            .unwrap(),
        Outcome::Inserted(3)
    );
    let result = db.query("SELECT id, name FROM t ORDER BY id").unwrap();
    assert_eq!(result.row_count(), 3);
    assert_eq!(result.value(2, 1).unwrap().to_string(), "c");
}

#[test]
fn insert_with_explicit_columns_fills_missing_with_null() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (a INTEGER, b TEXT, c INTEGER)")
        .unwrap();
    db.execute("INSERT INTO t (c, a) VALUES (99, 1)").unwrap();
    let result = db.query("SELECT a, b, c FROM t").unwrap();
    assert_eq!(result.value(0, 0).unwrap().to_string(), "1");
    assert_eq!(result.value(0, 1).unwrap().to_string(), "NULL");
    assert_eq!(result.value(0, 2).unwrap().to_string(), "99");
}

#[test]
fn insert_widens_integer_into_float_column() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (x FLOAT)").unwrap();
    db.execute("INSERT INTO t VALUES (5)").unwrap();
    assert_eq!(common::scalar(&mut db, "SELECT x FROM t"), "5.0");
}

#[test]
fn not_null_violation_is_rejected() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (id INTEGER NOT NULL, name TEXT)")
        .unwrap();
    let err = db.execute("INSERT INTO t VALUES (NULL, 'x')").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Api);
}

#[test]
fn insert_is_atomic_on_failure() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (id INTEGER NOT NULL)").unwrap();
    // Second row violates NOT NULL; nothing should be inserted.
    let err = db
        .execute("INSERT INTO t VALUES (1), (NULL), (3)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Api);
    assert_eq!(
        db.query("SELECT COUNT(*) FROM t")
            .unwrap()
            .value(0, 0)
            .unwrap()
            .to_string(),
        "0"
    );
}

#[test]
fn wrong_arity_insert_is_rejected() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (a INTEGER, b INTEGER)").unwrap();
    let err = db.execute("INSERT INTO t VALUES (1)").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Api);
}

#[test]
fn duplicate_table_errors_unless_if_not_exists() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (a INTEGER)").unwrap();
    let err = db.execute("CREATE TABLE t (a INTEGER)").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Catalog);
    // IF NOT EXISTS makes it a no-op.
    assert!(db
        .execute("CREATE TABLE IF NOT EXISTS t (a INTEGER)")
        .is_ok());
}

#[test]
fn create_table_rejects_duplicate_columns() {
    let mut db = Database::new();
    let err = db
        .execute("CREATE TABLE t (a INTEGER, a TEXT)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Catalog);
}

#[test]
fn drop_table_removes_it() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (a INTEGER)").unwrap();
    assert_eq!(
        db.execute("DROP TABLE t").unwrap(),
        Outcome::TableDropped("t".to_string())
    );
    assert!(db.query("SELECT a FROM t").is_err());
    // IF EXISTS makes a missing drop a no-op.
    assert!(db.execute("DROP TABLE IF EXISTS t").is_ok());
    assert!(db.execute("DROP TABLE t").is_err());
}

#[test]
fn script_runs_multiple_statements() {
    let mut db = Database::new();
    let outcomes = db
        .execute_script(
            "CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);",
        )
        .unwrap();
    assert_eq!(outcomes.len(), 3);
    assert_eq!(common::scalar(&mut db, "SELECT COUNT(*) FROM t"), "2");
}
