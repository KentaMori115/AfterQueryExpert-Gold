//! Integration tests for result-set rendering.

mod common;

use common::seeded;
use tanager::render_table;

#[test]
fn renders_a_simple_result() {
    let mut db = seeded();
    let result = db
        .query("SELECT id, name FROM employees WHERE dept_id = 2 ORDER BY id")
        .unwrap();
    let text = render_table(&result);
    let expected = "id | name\n\
                    ---+---------\n\
                    4  | Margaret\n\
                    5  | Dennis\n\
                    (2 rows)";
    assert_eq!(text, expected);
}

#[test]
fn renders_nulls_as_null_keyword() {
    let mut db = seeded();
    let result = db
        .query("SELECT budget FROM departments WHERE id = 4")
        .unwrap();
    let text = render_table(&result);
    assert!(text.contains("NULL"));
    assert!(text.ends_with("(1 row)"));
}

#[test]
fn empty_result_still_shows_header_and_count() {
    let mut db = seeded();
    let result = db
        .query("SELECT id FROM employees WHERE id > 1000")
        .unwrap();
    let text = render_table(&result);
    assert!(text.starts_with("id"));
    assert!(text.ends_with("(0 rows)"));
}

#[test]
fn aggregate_result_columns_named() {
    let mut db = seeded();
    let result = db
        .query("SELECT dept_id, COUNT(*) AS headcount FROM employees WHERE dept_id IS NOT NULL GROUP BY dept_id ORDER BY dept_id")
        .unwrap();
    assert_eq!(result.columns(), vec!["dept_id", "headcount"]);
    let text = render_table(&result);
    assert!(text.contains("headcount"));
}
