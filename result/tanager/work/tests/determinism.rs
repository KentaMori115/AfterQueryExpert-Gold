//! Integration tests asserting that identical queries produce identical output.
//!
//! Determinism is a core guarantee: the reference test suite depends on it, and
//! these tests guard against accidental reliance on hash-map iteration order.
//! Anything that groups, deduplicates or pairs rows answers to these cases.

mod common;

use common::seeded;
use tanager::render_table;

fn render(sql: &str) -> String {
    let mut db = seeded();
    render_table(&db.query(sql).unwrap())
}

#[test]
fn grouped_aggregation_is_stable_across_runs() {
    let sql = "SELECT dept_id, COUNT(*), SUM(salary) FROM employees \
               WHERE dept_id IS NOT NULL GROUP BY dept_id";
    let first = render(sql);
    for _ in 0..20 {
        assert_eq!(render(sql), first);
    }
}

#[test]
fn group_order_follows_first_seen_input() {
    // dept_ids first appear in order 1, 2, 3 in the seed data.
    let rows = common::query_strings(
        &mut seeded(),
        "SELECT dept_id FROM employees WHERE dept_id IS NOT NULL GROUP BY dept_id",
    );
    assert_eq!(rows, vec![vec!["1"], vec!["2"], vec!["3"]]);
}

#[test]
fn distinct_preserves_first_seen_order() {
    let rows = common::query_strings(
        &mut seeded(),
        "SELECT DISTINCT dept_id FROM employees WHERE dept_id IS NOT NULL",
    );
    assert_eq!(rows, vec![vec!["1"], vec!["2"], vec!["3"]]);
}

#[test]
fn join_output_order_is_stable() {
    let sql = "SELECT e.id, d.name FROM employees e \
               JOIN departments d ON e.dept_id = d.id ORDER BY e.id";
    let first = render(sql);
    for _ in 0..10 {
        assert_eq!(render(sql), first);
    }
}
