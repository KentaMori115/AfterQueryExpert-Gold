//! Integration tests for SQL three-valued (NULL) logic.

mod common;

use common::{scalar, seeded};

#[test]
fn comparison_with_null_is_unknown_and_filters_out() {
    let mut db = seeded();
    // dept_id = NULL never returns TRUE, so no rows match.
    let result = db
        .query("SELECT id FROM employees WHERE dept_id = NULL")
        .unwrap();
    assert_eq!(result.row_count(), 0);
}

#[test]
fn is_null_and_is_not_null() {
    let mut db = seeded();
    assert_eq!(
        scalar(
            &mut db,
            "SELECT COUNT(*) FROM employees WHERE dept_id IS NULL"
        ),
        "1"
    );
    assert_eq!(
        scalar(
            &mut db,
            "SELECT COUNT(*) FROM employees WHERE dept_id IS NOT NULL"
        ),
        "7"
    );
}

#[test]
fn null_propagates_through_arithmetic() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT NULL + 1"), "NULL");
    assert_eq!(scalar(&mut db, "SELECT 3 * NULL"), "NULL");
}

#[test]
fn three_valued_and_or() {
    let mut db = seeded();
    // FALSE AND NULL = FALSE (so the row is excluded, but the expression is not NULL)
    assert_eq!(scalar(&mut db, "SELECT FALSE AND NULL"), "false");
    // TRUE OR NULL = TRUE
    assert_eq!(scalar(&mut db, "SELECT TRUE OR NULL"), "true");
    // TRUE AND NULL = NULL
    assert_eq!(scalar(&mut db, "SELECT TRUE AND NULL"), "NULL");
}

#[test]
fn not_null_is_null() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT NOT NULL"), "NULL");
}

#[test]
fn in_list_with_null_is_unknown() {
    let mut db = seeded();
    // 99 IN (1, NULL) => NULL, filters out
    let result = db.query("SELECT 1 WHERE 99 IN (1, NULL)").unwrap();
    assert_eq!(result.row_count(), 0);
    // 1 IN (1, NULL) => TRUE
    let result = db.query("SELECT 1 WHERE 1 IN (1, NULL)").unwrap();
    assert_eq!(result.row_count(), 1);
}

#[test]
fn not_in_with_null_is_unknown() {
    let mut db = seeded();
    // 99 NOT IN (1, NULL) => NOT(NULL) => NULL => filters out
    let result = db.query("SELECT 1 WHERE 99 NOT IN (1, NULL)").unwrap();
    assert_eq!(result.row_count(), 0);
}

#[test]
fn between_with_null_bound() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT 5 BETWEEN NULL AND 10"), "NULL");
}

#[test]
fn case_with_no_match_and_no_else_is_null() {
    let mut db = seeded();
    assert_eq!(
        scalar(&mut db, "SELECT CASE WHEN 1 = 2 THEN 'x' END"),
        "NULL"
    );
}

#[test]
fn null_never_matches_case_operand() {
    let mut db = seeded();
    // Simple CASE: NULL operand never equals a WHEN value.
    assert_eq!(
        scalar(&mut db, "SELECT CASE NULL WHEN NULL THEN 'a' ELSE 'b' END"),
        "b"
    );
}

#[test]
fn aggregates_skip_nulls() {
    let mut db = seeded();
    // AVG over salaries ignores nothing here, but COUNT(dept_id) skips the NULL.
    assert_eq!(scalar(&mut db, "SELECT COUNT(dept_id) FROM employees"), "7");
    assert_eq!(scalar(&mut db, "SELECT COUNT(*) FROM employees"), "8");
}

#[test]
fn distinct_treats_nulls_as_equal() {
    let mut db = seeded();
    // manager_id has several NULLs; DISTINCT collapses them to one.
    let result = db
        .query("SELECT DISTINCT manager_id FROM employees")
        .unwrap();
    // manager_ids: NULL, 1, 4, 6 -> 4 distinct
    assert_eq!(result.row_count(), 4);
}

#[test]
fn a_null_operand_makes_arithmetic_null() {
    let mut db = seeded();
    assert_eq!(
        scalar(&mut db, "SELECT salary + dept_id FROM employees WHERE id = 8"),
        "NULL"
    );
}
