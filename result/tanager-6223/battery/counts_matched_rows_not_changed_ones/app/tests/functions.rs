//! Integration tests for scalar functions.

mod common;

use common::{scalar, seeded};

#[test]
fn string_case_functions() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT UPPER('hello')"), "HELLO");
    assert_eq!(scalar(&mut db, "SELECT LOWER('WORLD')"), "world");
    assert_eq!(scalar(&mut db, "SELECT LENGTH('hello')"), "5");
    assert_eq!(scalar(&mut db, "SELECT TRIM('  hi  ')"), "hi");
}

#[test]
fn substr_one_based() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT SUBSTR('database', 1, 4)"), "data");
    assert_eq!(scalar(&mut db, "SELECT SUBSTR('database', 5)"), "base");
}

#[test]
fn replace_function() {
    let mut db = seeded();
    assert_eq!(
        scalar(&mut db, "SELECT REPLACE('a-b-c', '-', '+')"),
        "a+b+c"
    );
}

#[test]
fn concat_and_null_propagation() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CONCAT('a', 'b', 'c')"), "abc");
    assert_eq!(scalar(&mut db, "SELECT CONCAT('a', NULL)"), "NULL");
}

#[test]
fn coalesce_returns_first_non_null() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT COALESCE(NULL, NULL, 'x')"), "x");
    assert_eq!(scalar(&mut db, "SELECT COALESCE(NULL, 7)"), "7");
}

#[test]
fn nullif_function() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT NULLIF(5, 5)"), "NULL");
    assert_eq!(scalar(&mut db, "SELECT NULLIF(5, 6)"), "5");
}

#[test]
fn numeric_functions() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT ABS(-7)"), "7");
    assert_eq!(scalar(&mut db, "SELECT ABS(-2.5)"), "2.5");
    assert_eq!(scalar(&mut db, "SELECT ROUND(9.8765, 2)"), "9.88");
    assert_eq!(scalar(&mut db, "SELECT MOD(17, 5)"), "2");
    assert_eq!(scalar(&mut db, "SELECT FLOOR(3.7)"), "3.0");
    assert_eq!(scalar(&mut db, "SELECT CEIL(3.1)"), "4.0");
}

#[test]
fn coalesce_over_table_column() {
    let mut db = seeded();
    // dept_id is NULL for Tim -> COALESCE replaces with -1.
    let rows = common::query_strings(
        &mut db,
        "SELECT COALESCE(dept_id, 0 - 1) AS d FROM employees WHERE id = 8",
    );
    assert_eq!(rows, vec![vec!["-1"]]);
}

#[test]
fn functions_compose() {
    let mut db = seeded();
    assert_eq!(
        scalar(&mut db, "SELECT UPPER(SUBSTR('database', 1, 4))"),
        "DATA"
    );
    assert_eq!(scalar(&mut db, "SELECT LENGTH(TRIM('  abc  '))"), "3");
}

#[test]
fn cast_between_types() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT CAST('42' AS INTEGER) + 1"), "43");
    assert_eq!(scalar(&mut db, "SELECT CAST(3 AS FLOAT)"), "3.0");
    assert_eq!(scalar(&mut db, "SELECT CAST(3.9 AS INTEGER)"), "3");
    assert_eq!(scalar(&mut db, "SELECT CAST(100 AS TEXT)"), "100");
}

#[test]
fn padding_functions() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT LPAD('7', 4, '0')"), "0007");
    assert_eq!(scalar(&mut db, "SELECT RPAD('7', 4, '.')"), "7...");
    // longer-than-target truncates
    assert_eq!(scalar(&mut db, "SELECT LPAD('hello', 3)"), "hel");
    // default pad is a space
    assert_eq!(scalar(&mut db, "SELECT LPAD('x', 3)"), "  x");
}

#[test]
fn instr_finds_substring() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT INSTR('database', 'base')"), "5");
    assert_eq!(scalar(&mut db, "SELECT INSTR('database', 'xyz')"), "0");
    assert_eq!(scalar(&mut db, "SELECT INSTR('database', 'data')"), "1");
}

#[test]
fn new_math_functions() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT POWER(2, 8)"), "256.0");
    assert_eq!(scalar(&mut db, "SELECT SQRT(16.0)"), "4.0");
    assert_eq!(scalar(&mut db, "SELECT SIGN(-42)"), "-1");
    assert_eq!(scalar(&mut db, "SELECT GREATEST(3, 9, 1)"), "9");
    assert_eq!(scalar(&mut db, "SELECT LEAST(3, 9, 1)"), "1");
    assert_eq!(scalar(&mut db, "SELECT REVERSE('abc')"), "cba");
    assert_eq!(scalar(&mut db, "SELECT REPEAT('ab', 3)"), "ababab");
}

#[test]
fn unknown_function_is_rejected() {
    let mut db = seeded();
    let err = db.query("SELECT BOGUS(1)").unwrap_err();
    assert_eq!(err.kind(), tanager::ErrorKind::Binder);
}

#[test]
fn function_arity_is_checked() {
    let mut db = seeded();
    let err = db.query("SELECT ABS(1, 2)").unwrap_err();
    assert_eq!(err.kind(), tanager::ErrorKind::Binder);
}
