//! Integration tests for CAST and implicit numeric handling.

mod common;

use common::{scalar, seeded};
use tanager::ErrorKind;

#[test]
fn cast_text_to_number() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CAST('42' AS INTEGER)"), "42");
    assert_eq!(scalar(&mut db, "SELECT CAST('3.5' AS FLOAT)"), "3.5");
    assert_eq!(scalar(&mut db, "SELECT CAST('  7 ' AS INTEGER)"), "7");
}

#[test]
fn cast_number_to_text() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CAST(42 AS TEXT)"), "42");
    assert_eq!(scalar(&mut db, "SELECT CAST(3.0 AS TEXT)"), "3.0");
}

#[test]
fn cast_float_to_integer_truncates() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CAST(3.9 AS INTEGER)"), "3");
    assert_eq!(scalar(&mut db, "SELECT CAST(-3.9 AS INTEGER)"), "-3");
}

#[test]
fn cast_integer_to_float() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CAST(5 AS FLOAT)"), "5.0");
}

#[test]
fn cast_to_boolean() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CAST('true' AS BOOLEAN)"), "true");
    assert_eq!(scalar(&mut db, "SELECT CAST(0 AS BOOLEAN)"), "false");
    assert_eq!(scalar(&mut db, "SELECT CAST(1 AS BOOLEAN)"), "true");
}

#[test]
fn cast_null_stays_null() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CAST(NULL AS INTEGER)"), "NULL");
}

#[test]
fn invalid_text_cast_is_execution_error() {
    let mut db = seeded();
    let err = db
        .query("SELECT CAST('not a number' AS INTEGER)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Execution);
}

#[test]
fn cast_enables_mixed_arithmetic() {
    let mut db = seeded();
    // '10' is text; casting lets it participate in arithmetic.
    assert_eq!(scalar(&mut db, "SELECT CAST('10' AS INTEGER) * 5"), "50");
}

#[test]
fn cast_column_values() {
    let mut db = seeded();
    // salary is INTEGER; cast to FLOAT then divide to force float division.
    let rows = common::query_strings(
        &mut db,
        "SELECT CAST(salary AS FLOAT) / 2 AS half FROM employees WHERE id = 1",
    );
    assert_eq!(rows, vec![vec!["80000.0"]]);
}
