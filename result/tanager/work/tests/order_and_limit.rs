//! Integration tests for ORDER BY, LIMIT, and OFFSET.
//! Ordering and slicing are written once per query, and these cases fix what
//! they apply to.

mod common;

use common::{query_strings, seeded};

#[test]
fn order_ascending_by_default() {
    let mut db = seeded();
    let rows = query_strings(&mut db, "SELECT salary FROM employees ORDER BY salary");
    assert_eq!(rows.first().unwrap(), &vec!["90000"]);
    assert_eq!(rows.last().unwrap(), &vec!["160000"]);
}

#[test]
fn order_descending() {
    let mut db = seeded();
    let rows = query_strings(&mut db, "SELECT salary FROM employees ORDER BY salary DESC");
    assert_eq!(rows.first().unwrap(), &vec!["160000"]);
}

#[test]
fn order_by_multiple_keys() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT dept_id, salary FROM employees WHERE dept_id IS NOT NULL \
         ORDER BY dept_id ASC, salary DESC",
    );
    // Within dept 1: 160k, 150k, 140k
    assert_eq!(rows[0], vec!["1", "160000"]);
    assert_eq!(rows[1], vec!["1", "150000"]);
    assert_eq!(rows[2], vec!["1", "140000"]);
}

#[test]
fn order_by_non_projected_column() {
    let mut db = seeded();
    // Order by salary but only project name.
    let rows = query_strings(
        &mut db,
        "SELECT name FROM employees ORDER BY salary DESC LIMIT 1",
    );
    assert_eq!(rows, vec![vec!["Ada"]]);
}

#[test]
fn order_by_position() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT name, salary FROM employees ORDER BY 2 DESC LIMIT 1",
    );
    assert_eq!(rows, vec![vec!["Ada".to_string(), "160000".to_string()]]);
}

#[test]
fn nulls_sort_last_by_default_ascending() {
    let mut db = seeded();
    // dept_id NULL should come last in ascending order.
    let rows = query_strings(&mut db, "SELECT dept_id FROM employees ORDER BY dept_id");
    assert_eq!(rows.last().unwrap(), &vec!["NULL"]);
}

#[test]
fn nulls_first_override() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT dept_id FROM employees ORDER BY dept_id ASC NULLS FIRST",
    );
    assert_eq!(rows.first().unwrap(), &vec!["NULL"]);
}

#[test]
fn nulls_first_by_default_descending() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT dept_id FROM employees ORDER BY dept_id DESC",
    );
    assert_eq!(rows.first().unwrap(), &vec!["NULL"]);
}

#[test]
fn limit_and_offset() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT id FROM employees ORDER BY id LIMIT 3 OFFSET 2",
    );
    assert_eq!(rows, vec![vec!["3"], vec!["4"], vec!["5"]]);
}

#[test]
fn limit_zero_returns_nothing() {
    let mut db = seeded();
    let result = db.query("SELECT id FROM employees LIMIT 0").unwrap();
    assert_eq!(result.row_count(), 0);
}

#[test]
fn offset_past_end_returns_nothing() {
    let mut db = seeded();
    let result = db
        .query("SELECT id FROM employees ORDER BY id OFFSET 100")
        .unwrap();
    assert_eq!(result.row_count(), 0);
}

#[test]
fn order_is_stable_for_equal_keys() {
    let mut db = seeded();
    // All rows share the same key; original (id) order must be preserved.
    let rows = query_strings(&mut db, "SELECT id FROM employees ORDER BY 1 - 1");
    let ids: Vec<String> = rows.into_iter().map(|r| r[0].clone()).collect();
    assert_eq!(ids, vec!["1", "2", "3", "4", "5", "6", "7", "8"]);
}
