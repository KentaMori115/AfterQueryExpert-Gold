//! Integration tests for operators, including string concatenation.

mod common;

use common::{query_strings, scalar, seeded};

#[test]
fn string_concatenation() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT 'foo' || 'bar'"), "foobar");
    assert_eq!(
        scalar(&mut db, "SELECT 'a' || '-' || 'b' || '-' || 'c'"),
        "a-b-c"
    );
}

#[test]
fn concatenation_propagates_null() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT 'x' || NULL"), "NULL");
}

#[test]
fn concatenation_over_columns() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT name || ' (' || CAST(salary AS TEXT) || ')' AS label \
         FROM employees WHERE id = 1",
    );
    assert_eq!(rows, vec![vec!["Ada (160000)"]]);
}

#[test]
fn concatenation_requires_text_operands() {
    let mut db = seeded();
    // integer || integer is a type error (no implicit numeric concat)
    let err = db.query("SELECT 1 || 2").unwrap_err();
    assert_eq!(err.kind(), tanager::ErrorKind::Type);
}

#[test]
fn concatenation_binds_tighter_than_comparison() {
    let mut db = seeded();
    // 'a' || 'b' = 'ab'  parses as ('a' || 'b') = 'ab'  => TRUE
    assert_eq!(scalar(&mut db, "SELECT 'a' || 'b' = 'ab'"), "true");
}

#[test]
fn unary_minus_and_precedence() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT -3 + 5"), "2");
    assert_eq!(scalar(&mut db, "SELECT -(3 + 5)"), "-8");
    assert_eq!(scalar(&mut db, "SELECT -2 * -3"), "6");
}

#[test]
fn not_operator_precedence() {
    let mut db = seeded();
    // NOT binds looser than comparison: NOT 1 = 2  ==  NOT (1 = 2)  == TRUE
    assert_eq!(scalar(&mut db, "SELECT NOT 1 = 2"), "true");
}
