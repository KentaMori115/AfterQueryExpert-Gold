//! Integration tests for runtime (execution-stage) errors.

mod common;

use common::seeded;
use tanager::ErrorKind;

fn exec_err(sql: &str) -> ErrorKind {
    seeded().query(sql).unwrap_err().kind()
}

#[test]
fn integer_division_by_zero() {
    assert_eq!(exec_err("SELECT 1 / 0"), ErrorKind::Execution);
}

#[test]
fn float_division_by_zero() {
    assert_eq!(exec_err("SELECT 1.0 / 0.0"), ErrorKind::Execution);
}

#[test]
fn modulo_by_zero() {
    assert_eq!(exec_err("SELECT 10 % 0"), ErrorKind::Execution);
    assert_eq!(exec_err("SELECT MOD(10, 0)"), ErrorKind::Execution);
}

#[test]
fn sqrt_of_negative() {
    assert_eq!(exec_err("SELECT SQRT(-4.0)"), ErrorKind::Execution);
}

#[test]
fn repeat_negative_count() {
    assert_eq!(exec_err("SELECT REPEAT('x', 0 - 1)"), ErrorKind::Execution);
}

#[test]
fn invalid_numeric_cast() {
    assert_eq!(
        exec_err("SELECT CAST('twelve' AS INTEGER)"),
        ErrorKind::Execution
    );
}

#[test]
fn division_by_zero_only_when_row_reaches_it() {
    // The 1/0 is guarded by a WHERE that removes every row, so it never runs.
    let mut db = seeded();
    let result = db
        .query("SELECT salary / 0 FROM employees WHERE 1 = 2")
        .unwrap();
    assert_eq!(result.row_count(), 0);
}

#[test]
fn error_surfaces_from_a_later_row() {
    // salary/(dept_id - 1): dept_id=1 makes the denominator zero for Ada.
    assert_eq!(
        exec_err("SELECT salary / (dept_id - 1) FROM employees"),
        ErrorKind::Execution
    );
}
