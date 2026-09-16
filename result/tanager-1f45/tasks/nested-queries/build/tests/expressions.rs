//! Integration tests for expression evaluation depth and precedence.
//! Graded as inherited behaviour: the verifier restores this file from the
//! base commit before it runs, so edits made alongside a change are ignored.

mod common;

use common::{scalar, seeded};

#[test]
fn nested_arithmetic() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT ((1 + 2) * (3 + 4)) - 5"), "16");
    assert_eq!(scalar(&mut db, "SELECT 100 / 5 / 2"), "10");
    assert_eq!(scalar(&mut db, "SELECT 2 * 3 + 4 * 5"), "26");
}

#[test]
fn boolean_precedence() {
    let mut db = seeded();
    // AND binds tighter than OR
    assert_eq!(scalar(&mut db, "SELECT TRUE OR FALSE AND FALSE"), "true");
    assert_eq!(scalar(&mut db, "SELECT (TRUE OR FALSE) AND FALSE"), "false");
    assert_eq!(scalar(&mut db, "SELECT NOT FALSE AND TRUE"), "true");
}

#[test]
fn nested_case_expression() {
    let mut db = seeded();
    let sql = "SELECT CASE \
                   WHEN salary >= 150000 THEN 'A' \
                   WHEN salary >= 130000 THEN 'B' \
                   ELSE 'C' END \
               FROM employees WHERE id = 5";
    // Dennis earns 130000 -> band B
    assert_eq!(scalar(&mut db, sql), "B");
}

#[test]
fn simple_case_form() {
    let mut db = seeded();
    let sql = "SELECT CASE dept_id WHEN 1 THEN 'eng' WHEN 2 THEN 'sales' ELSE 'other' END \
               FROM employees WHERE id = 4";
    assert_eq!(scalar(&mut db, sql), "sales");
}

#[test]
fn coalesce_and_arithmetic_combined() {
    let mut db = seeded();
    // Tim has NULL dept_id; COALESCE to 0 then add 10.
    let rows = common::query_strings(
        &mut db,
        "SELECT COALESCE(dept_id, 0) + 10 AS d FROM employees WHERE id = 8",
    );
    assert_eq!(rows, vec![vec!["10"]]);
}

#[test]
fn comparison_chain_with_and() {
    let mut db = seeded();
    let result = db
        .query("SELECT id FROM employees WHERE salary > 100000 AND salary < 150000 AND dept_id = 1")
        .unwrap();
    // Linus 140000 in dept 1
    assert_eq!(result.row_count(), 1);
}

#[test]
fn deeply_nested_functions() {
    let mut db = seeded();
    assert_eq!(
        scalar(&mut db, "SELECT UPPER(REVERSE(SUBSTR('database', 1, 4)))"),
        "ATAD"
    );
    assert_eq!(
        scalar(&mut db, "SELECT LENGTH(CONCAT('ab', 'cde', 'f'))"),
        "6"
    );
}

#[test]
fn arithmetic_on_grouped_aggregates() {
    let mut db = seeded();
    let rows = common::query_strings(
        &mut db,
        "SELECT dept_id, MAX(salary) - MIN(salary) AS spread FROM employees \
         WHERE dept_id IS NOT NULL GROUP BY dept_id ORDER BY dept_id",
    );
    assert_eq!(rows[0], vec!["1", "20000"]); // 160000 - 140000
    assert_eq!(rows[1], vec!["2", "10000"]); // 130000 - 120000
}
