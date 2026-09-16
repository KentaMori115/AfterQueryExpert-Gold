//! Integration tests for projection, filtering, and scalar expressions.

mod common;

use common::{scalar, seeded};

#[test]
fn projects_named_columns() {
    let mut db = seeded();
    let result = db
        .query("SELECT name, salary FROM employees WHERE id = 1")
        .unwrap();
    assert_eq!(result.columns(), vec!["name", "salary"]);
    assert_eq!(result.value(0, 0).unwrap().to_string(), "Ada");
    assert_eq!(result.value(0, 1).unwrap().to_string(), "160000");
}

#[test]
fn wildcard_projects_all_columns_in_order() {
    let mut db = seeded();
    let result = db.query("SELECT * FROM departments WHERE id = 1").unwrap();
    assert_eq!(result.columns(), vec!["id", "name", "budget"]);
}

#[test]
fn computed_column_with_alias() {
    let mut db = seeded();
    let result = db
        .query("SELECT name, salary / 12 AS monthly FROM employees WHERE id = 2")
        .unwrap();
    assert_eq!(result.columns(), vec!["name", "monthly"]);
    assert_eq!(result.value(0, 1).unwrap().to_string(), "12500");
}

#[test]
fn where_with_boolean_connectives() {
    let mut db = seeded();
    let result = db
        .query("SELECT id FROM employees WHERE dept_id = 1 AND salary > 145000")
        .unwrap();
    // Ada(160k) and Grace(150k) qualify; Linus(140k) does not.
    assert_eq!(result.row_count(), 2);
}

#[test]
fn arithmetic_precedence_is_respected() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT 2 + 3 * 4"), "14");
    assert_eq!(scalar(&mut db, "SELECT (2 + 3) * 4"), "20");
    assert_eq!(scalar(&mut db, "SELECT 10 - 2 - 3"), "5");
}

#[test]
fn integer_and_float_arithmetic_typing() {
    let mut db = seeded();
    // integer division truncates toward zero
    assert_eq!(scalar(&mut db, "SELECT 7 / 2"), "3");
    // any float operand promotes the result
    assert_eq!(scalar(&mut db, "SELECT 7 / 2.0"), "3.5");
    assert_eq!(scalar(&mut db, "SELECT 1 + 2.5"), "3.5");
}

#[test]
fn modulo_operator() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT 17 % 5"), "2");
}

#[test]
fn comparison_and_between() {
    let mut db = seeded();
    let result = db
        .query("SELECT id FROM employees WHERE salary BETWEEN 130000 AND 145000 ORDER BY id")
        .unwrap();
    // Linus 140k, Dennis 130k, Ken 145k, Barbara 135k
    assert_eq!(result.row_count(), 4);
}

#[test]
fn in_list_filter() {
    let mut db = seeded();
    let result = db
        .query("SELECT name FROM employees WHERE dept_id IN (2, 3) ORDER BY id")
        .unwrap();
    assert_eq!(result.row_count(), 4);
}

#[test]
fn like_filter() {
    let mut db = seeded();
    let rows = common::query_strings(
        &mut db,
        "SELECT name FROM employees WHERE name LIKE '_a%' ORDER BY name",
    );
    // names with 'a' as the second character: Barbara, Margaret
    assert_eq!(rows, vec![vec!["Barbara"], vec!["Margaret"]]);
}

#[test]
fn distinct_removes_duplicates() {
    let mut db = seeded();
    let result = db.query("SELECT DISTINCT dept_id FROM employees").unwrap();
    // dept_ids: 1, 2, 3, NULL -> 4 distinct
    assert_eq!(result.row_count(), 4);
}

#[test]
fn constant_select_without_from() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT 1 + 1"), "2");
    assert_eq!(scalar(&mut db, "SELECT 'hello'"), "hello");
}

#[test]
fn case_expression() {
    let mut db = seeded();
    let rows = common::query_strings(
        &mut db,
        "SELECT name, CASE WHEN salary >= 150000 THEN 'senior' ELSE 'staff' END AS band \
         FROM employees WHERE dept_id = 1 ORDER BY id",
    );
    assert_eq!(rows[0], vec!["Ada", "senior"]);
    assert_eq!(rows[2], vec!["Linus", "staff"]);
}
