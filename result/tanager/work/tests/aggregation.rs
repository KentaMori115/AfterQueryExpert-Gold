//! Integration tests for GROUP BY, HAVING, and aggregate functions.
//! Every case runs through the public `Database` API, so grouping keeps its
//! meaning across a rewrite of the planner or the executor.

mod common;

use common::{query_strings, scalar, seeded};

#[test]
fn count_star_counts_rows() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT COUNT(*) FROM employees"), "8");
}

#[test]
fn count_column_ignores_nulls() {
    let mut db = seeded();
    // dept_id is NULL for Tim.
    assert_eq!(scalar(&mut db, "SELECT COUNT(dept_id) FROM employees"), "7");
}

#[test]
fn sum_of_integers_is_integer() {
    let mut db = seeded();
    assert_eq!(
        scalar(
            &mut db,
            "SELECT SUM(salary) FROM employees WHERE dept_id = 1"
        ),
        "450000"
    );
}

#[test]
fn avg_is_float() {
    let mut db = seeded();
    assert_eq!(
        scalar(
            &mut db,
            "SELECT AVG(salary) FROM employees WHERE dept_id = 1"
        ),
        "150000.0"
    );
}

#[test]
fn min_and_max() {
    let mut db = seeded();
    assert_eq!(
        scalar(&mut db, "SELECT MIN(salary) FROM employees"),
        "90000"
    );
    assert_eq!(
        scalar(&mut db, "SELECT MAX(salary) FROM employees"),
        "160000"
    );
}

#[test]
fn group_by_with_multiple_aggregates() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT dept_id, COUNT(*), SUM(salary), MAX(salary) FROM employees \
         WHERE dept_id IS NOT NULL GROUP BY dept_id ORDER BY dept_id",
    );
    assert_eq!(rows[0], vec!["1", "3", "450000", "160000"]);
    assert_eq!(rows[1], vec!["2", "2", "250000", "130000"]);
    assert_eq!(rows[2], vec!["3", "2", "280000", "145000"]);
}

#[test]
fn having_filters_groups() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT dept_id FROM employees WHERE dept_id IS NOT NULL \
         GROUP BY dept_id HAVING COUNT(*) >= 3 ORDER BY dept_id",
    );
    assert_eq!(rows, vec![vec!["1"]]);
}

#[test]
fn having_can_reference_aggregate_not_in_projection() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT dept_id FROM employees WHERE dept_id IS NOT NULL \
         GROUP BY dept_id HAVING SUM(salary) > 300000 ORDER BY dept_id",
    );
    // Engineering 450k only.
    assert_eq!(rows, vec![vec!["1"]]);
}

#[test]
fn count_distinct() {
    let mut db = seeded();
    // distinct dept_ids ignoring null: 1, 2, 3 -> 3
    assert_eq!(
        scalar(&mut db, "SELECT COUNT(DISTINCT dept_id) FROM employees"),
        "3"
    );
}

#[test]
fn aggregate_expression_in_projection() {
    let mut db = seeded();
    // ratio of max to count as a computed aggregate expression
    let rows = query_strings(
        &mut db,
        "SELECT dept_id, SUM(salary) / COUNT(*) AS avg_int FROM employees \
         WHERE dept_id = 1 GROUP BY dept_id",
    );
    assert_eq!(rows, vec![vec!["1", "150000"]]);
}

#[test]
fn group_concat_joins_values_in_order() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT dept_id, GROUP_CONCAT(name) AS names FROM employees \
         WHERE dept_id = 1 GROUP BY dept_id",
    );
    assert_eq!(rows, vec![vec!["1", "Ada,Grace,Linus"]]);
}

#[test]
fn group_concat_distinct() {
    let mut db = seeded();
    // Every employee has a distinct name, so DISTINCT collapses nothing here;
    // use a repeated value via a constant to check distinctness.
    let rows = query_strings(
        &mut db,
        "SELECT GROUP_CONCAT(DISTINCT dept_id) AS d FROM employees WHERE dept_id IS NOT NULL",
    );
    assert_eq!(rows, vec![vec!["1,2,3"]]);
}

#[test]
fn population_variance_and_stddev() {
    let mut db = seeded();
    db.execute("CREATE TABLE nums (x INTEGER)").unwrap();
    db.execute("INSERT INTO nums VALUES (2), (4), (4), (4), (5), (5), (7), (9)")
        .unwrap();
    assert_eq!(scalar(&mut db, "SELECT VAR_POP(x) FROM nums"), "4.0");
    assert_eq!(scalar(&mut db, "SELECT STDDEV_POP(x) FROM nums"), "2.0");
}

#[test]
fn stddev_of_empty_is_null() {
    let mut db = seeded();
    assert_eq!(
        scalar(
            &mut db,
            "SELECT STDDEV_POP(salary) FROM employees WHERE id > 1000"
        ),
        "NULL"
    );
}

#[test]
fn grouped_aggregate_over_empty_input_is_empty() {
    let mut db = seeded();
    let result = db
        .query("SELECT dept_id, COUNT(*) FROM employees WHERE salary > 1000000 GROUP BY dept_id")
        .unwrap();
    assert_eq!(result.row_count(), 0);
}

#[test]
fn bare_aggregate_over_empty_input_yields_one_row() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT COUNT(*), SUM(salary) FROM employees WHERE salary > 1000000",
    );
    assert_eq!(rows, vec![vec!["0", "NULL"]]);
}
