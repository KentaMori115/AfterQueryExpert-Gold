//! Integration tests for joins.
//! A join's output row is the left columns then the right, and the cases here
//! hold that layout for anything built above it.

mod common;

use common::{query_strings, seeded};

#[test]
fn inner_join_matches_rows() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT e.name, d.name FROM employees e JOIN departments d ON e.dept_id = d.id \
         ORDER BY e.id",
    );
    // Tim has NULL dept_id -> excluded by inner join. 7 matched.
    assert_eq!(rows.len(), 7);
    assert_eq!(rows[0], vec!["Ada", "Engineering"]);
}

#[test]
fn left_join_keeps_unmatched_left_rows() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT e.name, d.name AS dept FROM employees e \
         LEFT JOIN departments d ON e.dept_id = d.id ORDER BY e.id",
    );
    assert_eq!(rows.len(), 8);
    // Tim's department is null-padded.
    assert_eq!(rows[7], vec!["Tim", "NULL"]);
}

#[test]
fn join_with_filter_on_joined_table() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT e.name FROM employees e JOIN departments d ON e.dept_id = d.id \
         WHERE d.name = 'Research' ORDER BY e.id",
    );
    assert_eq!(rows, vec![vec!["Ken"], vec!["Barbara"]]);
}

#[test]
fn qualified_columns_resolve_across_tables() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT e.id, d.budget FROM employees e JOIN departments d ON e.dept_id = d.id \
         WHERE e.id = 1",
    );
    assert_eq!(rows, vec![vec!["1", "1000000"]]);
}

#[test]
fn ambiguous_unqualified_column_is_rejected() {
    let mut db = seeded();
    // both tables have `name` and `id`.
    let err = db
        .query("SELECT name FROM employees e JOIN departments d ON e.dept_id = d.id")
        .unwrap_err();
    assert_eq!(err.kind(), tanager::ErrorKind::Binder);
}

#[test]
fn self_join_via_alias() {
    let mut db = seeded();
    // Employees joined to their managers.
    let rows = query_strings(
        &mut db,
        "SELECT e.name, m.name AS manager FROM employees e \
         JOIN employees m ON e.manager_id = m.id ORDER BY e.id",
    );
    assert_eq!(rows[0], vec!["Grace", "Ada"]);
    // Only employees with a manager appear.
    assert_eq!(rows.len(), 4);
}

#[test]
fn aggregate_over_join() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT d.name, COUNT(*) AS headcount FROM employees e \
         JOIN departments d ON e.dept_id = d.id GROUP BY d.name ORDER BY name",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Engineering".to_string(), "3".to_string()],
            vec!["Research".to_string(), "2".to_string()],
            vec!["Sales".to_string(), "2".to_string()],
        ]
    );
}
