//! Integration tests for EXPLAIN.
//! Graded as inherited behaviour: the verifier restores this file from the
//! base commit before it runs, so edits made alongside a change are ignored.

mod common;

use common::seeded;

fn plan_text(db: &mut tanager::Database, sql: &str) -> String {
    let result = db.query(sql).unwrap();
    result
        .rows()
        .iter()
        .map(|r| r.get(0).unwrap().to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn explain_reports_plan_tree() {
    let mut db = seeded();
    let text = plan_text(
        &mut db,
        "EXPLAIN SELECT dept_id, COUNT(*) FROM employees GROUP BY dept_id ORDER BY dept_id LIMIT 3",
    );
    assert!(text.contains("Limit 3"));
    assert!(text.contains("Sort"));
    assert!(text.contains("Aggregate"));
    assert!(text.contains("Scan employees"));
}

#[test]
fn explain_shows_predicate_pushdown() {
    let mut db = seeded();
    let text = plan_text(
        &mut db,
        "EXPLAIN SELECT e.name FROM employees e JOIN departments d ON e.dept_id = d.id \
         WHERE e.salary > 100000 AND d.budget > 500000",
    );
    // Both single-side predicates should be pushed below the join as Filters.
    assert!(text.contains("JOIN"));
    let filter_lines = text.matches("Filter").count();
    assert!(
        filter_lines >= 2,
        "expected pushed-down filters, got:\n{}",
        text
    );
}

#[test]
fn explain_result_has_single_plan_column() {
    let mut db = seeded();
    let result = db.query("EXPLAIN SELECT id FROM employees").unwrap();
    assert_eq!(result.columns(), vec!["plan"]);
    assert!(result.row_count() >= 2);
}
