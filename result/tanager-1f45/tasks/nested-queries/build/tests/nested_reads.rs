//! Queries that read another query: a parenthesized SELECT used as a value,
//! EXISTS, and IN over a query rather than a written-out list.

use tanager::error::ErrorKind;
use tanager::{Database, Value};

/// Three departments, one of them with nobody in it, and one employee whose
/// department is unknown. The NULL is deliberate: membership tests over this
/// column are where three-valued logic shows up.
fn shop() -> Database {
    let mut db = Database::new();
    db.execute("CREATE TABLE dept (id INTEGER, name TEXT, budget INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE staff (id INTEGER, dept_id INTEGER, name TEXT, pay INTEGER)")
        .unwrap();
    db.execute(
        "INSERT INTO dept VALUES (1, 'Bakery', 900), (2, 'Deli', 400), (3, 'Flowers', 250)",
    )
    .unwrap();
    db.execute(
        "INSERT INTO staff VALUES \
            (1, 1, 'Ada', 300), \
            (2, 1, 'Bo', 250), \
            (3, 2, 'Cy', 200), \
            (4, NULL, 'Di', 150)",
    )
    .unwrap();
    db
}

fn cells(db: &mut Database, sql: &str) -> Vec<Vec<String>> {
    db.query(sql)
        .unwrap_or_else(|e| panic!("query failed: {} ({})", e, sql))
        .rows()
        .iter()
        .map(|r| r.values().iter().map(|v| v.to_string()).collect())
        .collect()
}

fn column(db: &mut Database, sql: &str) -> Vec<String> {
    cells(db, sql).into_iter().map(|mut r| r.remove(0)).collect()
}

#[test]
fn a_query_in_a_value_position_supplies_its_single_value() {
    let mut db = shop();
    let rows = cells(&mut db, "SELECT (SELECT COUNT(*) FROM staff) AS headcount");
    assert_eq!(rows, vec![vec!["4".to_string()]]);
}

#[test]
fn a_value_query_that_finds_nothing_reads_as_null() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT (SELECT pay FROM staff WHERE pay > 10000) AS missing",
    );
    assert_eq!(rows, vec![vec!["NULL".to_string()]]);
    // The column still has a type, taken from the query's own column.
    let result = db
        .query("SELECT (SELECT pay FROM staff WHERE pay > 10000) AS missing")
        .unwrap();
    assert_eq!(result.schema().len(), 1);
}

#[test]
fn a_value_query_returning_several_rows_fails_while_running() {
    let mut db = shop();
    let err = db
        .query("SELECT (SELECT pay FROM staff) AS ambiguous")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Execution);
    // Control: the same shape with one row is fine, so the failure is about
    // how many rows came back rather than about the syntax.
    let rows = cells(
        &mut db,
        "SELECT (SELECT pay FROM staff WHERE id = 3) AS one_row",
    );
    assert_eq!(rows, vec![vec!["200".to_string()]]);
}

#[test]
fn a_value_query_of_two_columns_is_rejected_before_it_runs() {
    let mut db = shop();
    let err = db
        .query("SELECT (SELECT id, pay FROM staff WHERE id = 1) AS pair")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    let rows = cells(
        &mut db,
        "SELECT (SELECT pay FROM staff WHERE id = 1) AS single",
    );
    assert_eq!(rows, vec![vec!["300".to_string()]]);
}

#[test]
fn a_value_query_can_stand_on_either_side_of_a_comparison() {
    let mut db = shop();
    // Average pay is 225, so the two rows above it come back.
    let names = column(
        &mut db,
        "SELECT name FROM staff WHERE pay > (SELECT AVG(pay) FROM staff) ORDER BY name",
    );
    assert_eq!(names, vec!["Ada".to_string(), "Bo".to_string()]);
    let below = column(
        &mut db,
        "SELECT name FROM staff WHERE pay < (SELECT AVG(pay) FROM staff) ORDER BY name",
    );
    assert_eq!(below, vec!["Cy".to_string(), "Di".to_string()]);
}

#[test]
fn a_value_query_feeds_arithmetic_like_any_other_value() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT (SELECT MAX(pay) FROM staff) - (SELECT MIN(pay) FROM staff) AS spread",
    );
    assert_eq!(rows, vec![vec!["150".to_string()]]);
}

#[test]
fn exists_is_true_as_soon_as_one_row_comes_back() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT name FROM dept WHERE EXISTS (SELECT id FROM staff WHERE pay > 100) ORDER BY id",
    );
    assert_eq!(rows.len(), 3);
}

#[test]
fn exists_is_false_when_nothing_comes_back() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT name FROM dept WHERE EXISTS (SELECT id FROM staff WHERE pay > 9000)",
    );
    assert!(rows.is_empty());
}

#[test]
fn not_exists_turns_the_answer_around() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE NOT EXISTS (SELECT id FROM staff WHERE pay > 9000) ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery", "Deli", "Flowers"]);
}

#[test]
fn exists_does_not_care_what_the_rows_hold() {
    let mut db = shop();
    // Every row the inner query produces is NULL, and EXISTS still reports
    // true: it counts rows, it does not read them.
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE EXISTS (SELECT dept_id FROM staff WHERE id = 4) ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery", "Deli", "Flowers"]);
}

#[test]
fn exists_is_never_unknown_so_not_exists_covers_the_rest() {
    let mut db = shop();
    let with = column(
        &mut db,
        "SELECT name FROM dept WHERE EXISTS (SELECT id FROM staff WHERE pay > 220) ORDER BY id",
    );
    let without = column(
        &mut db,
        "SELECT name FROM dept WHERE NOT EXISTS (SELECT id FROM staff WHERE pay > 220) ORDER BY id",
    );
    assert_eq!(with.len() + without.len(), 3);
    assert!(without.is_empty());
}

#[test]
fn in_over_a_query_tests_membership() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE id IN (SELECT dept_id FROM staff) ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery", "Deli"]);
}

#[test]
fn in_over_a_query_that_yields_nothing_keeps_no_rows() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE id IN (SELECT dept_id FROM staff WHERE pay > 9000)",
    );
    assert!(names.is_empty());
    // Control: the same query without the impossible filter does match.
    let matched = column(
        &mut db,
        "SELECT name FROM dept WHERE id IN (SELECT dept_id FROM staff WHERE pay > 250) ORDER BY id",
    );
    assert_eq!(matched, vec!["Bakery"]);
}

#[test]
fn a_null_among_the_candidates_leaves_a_miss_unknown() {
    let mut db = shop();
    // Flowers matches nothing, and the candidate column holds a NULL, so the
    // answer is unknown rather than false and the row is not kept.
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE id IN (SELECT dept_id FROM staff) ORDER BY id",
    );
    assert!(!names.contains(&"Flowers".to_string()));
    // With the NULL filtered out of the candidates, the miss is a plain false,
    // and the rows that do match are unaffected either way.
    let still = column(
        &mut db,
        "SELECT name FROM dept WHERE id IN (SELECT dept_id FROM staff WHERE dept_id IS NOT NULL) ORDER BY id",
    );
    assert_eq!(still, vec!["Bakery", "Deli"]);
}

#[test]
fn not_in_finds_nothing_while_a_null_is_among_the_candidates() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE id NOT IN (SELECT dept_id FROM staff)",
    );
    assert!(names.is_empty());
}

#[test]
fn not_in_works_once_the_candidates_are_free_of_nulls() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE id NOT IN (SELECT dept_id FROM staff WHERE dept_id IS NOT NULL) ORDER BY id",
    );
    assert_eq!(names, vec!["Flowers"]);
}

#[test]
fn a_null_on_the_left_of_in_is_unknown() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM staff WHERE dept_id IN (SELECT id FROM dept) ORDER BY id",
    );
    // Di's department is NULL, so the test is unknown for that row.
    assert_eq!(names, vec!["Ada", "Bo", "Cy"]);
}

#[test]
fn in_over_a_query_of_two_columns_is_rejected_before_it_runs() {
    let mut db = shop();
    let err = db
        .query("SELECT name FROM dept WHERE id IN (SELECT id, name FROM dept)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE id IN (SELECT id FROM dept) ORDER BY id",
    );
    assert_eq!(names.len(), 3);
}

#[test]
fn in_over_a_query_of_an_uncomparable_type_is_rejected() {
    let mut db = shop();
    let err = db
        .query("SELECT name FROM dept WHERE id IN (SELECT name FROM dept)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE name IN (SELECT name FROM dept) ORDER BY id",
    );
    assert_eq!(names.len(), 3);
}

#[test]
fn the_types_are_settled_before_any_row_is_read() {
    let mut db = shop();
    db.execute("CREATE TABLE blank (id INTEGER)").unwrap();
    // Nothing to compare here, since the outer table is empty. The mismatch is
    // still refused, because it is settled while binding rather than on the
    // first row that happens to reach the comparison.
    let err = db
        .query("SELECT id FROM blank WHERE id IN (SELECT name FROM dept)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    // Control: the same empty table with matching types is simply empty.
    let rows = cells(&mut db, "SELECT id FROM blank WHERE id IN (SELECT id FROM dept)");
    assert!(rows.is_empty());
}

#[test]
fn membership_widens_across_the_numeric_types() {
    let mut db = shop();
    db.execute("CREATE TABLE target (amount FLOAT)").unwrap();
    db.execute("INSERT INTO target VALUES (250.0), (900.0)")
        .unwrap();
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE budget IN (SELECT amount FROM target) ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery", "Flowers"]);
}

#[test]
fn a_membership_test_composes_with_the_rest_of_a_predicate() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE budget > 300 AND id IN (SELECT dept_id FROM staff) ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery", "Deli"]);
    // OR keeps a row the membership test alone would drop.
    let widened = column(
        &mut db,
        "SELECT name FROM dept WHERE id IN (SELECT dept_id FROM staff) OR budget < 300 ORDER BY id",
    );
    assert_eq!(widened, vec!["Bakery", "Deli", "Flowers"]);
}

#[test]
fn a_counting_query_over_no_rows_still_reads_as_zero() {
    let mut db = shop();
    db.execute("CREATE TABLE spare (id INTEGER)").unwrap();
    let rows = cells(&mut db, "SELECT (SELECT COUNT(*) FROM spare) AS n");
    assert_eq!(rows, vec![vec!["0".to_string()]]);
    // A value query with no rows at all is a different thing, and reads NULL.
    let none = cells(&mut db, "SELECT (SELECT id FROM spare) AS n");
    assert_eq!(none, vec![vec!["NULL".to_string()]]);
}

#[test]
fn a_query_may_appear_in_the_select_list_and_the_predicate_at_once() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT name, (SELECT COUNT(*) FROM staff) AS total FROM dept \
         WHERE id IN (SELECT dept_id FROM staff) ORDER BY id",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Bakery".to_string(), "4".to_string()],
            vec!["Deli".to_string(), "4".to_string()],
        ]
    );
}

#[test]
fn a_value_query_reads_the_same_way_inside_case() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT CASE WHEN (SELECT COUNT(*) FROM staff) > 3 THEN 'busy' ELSE 'quiet' END AS mood",
    );
    assert_eq!(rows, vec![vec!["busy".to_string()]]);
}

#[test]
fn the_value_of_a_query_survives_ordering_and_limiting() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT name, (SELECT MIN(pay) FROM staff) AS floor_pay FROM dept ORDER BY name LIMIT 2",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Bakery".to_string(), "150".to_string()],
            vec!["Deli".to_string(), "150".to_string()],
        ]
    );
}

#[test]
fn a_query_used_as_a_value_is_not_folded_away_at_plan_time() {
    let mut db = shop();
    // The inner query mentions no column of the outer one, which is exactly the
    // shape a constant folder would try to evaluate early. It has to keep
    // reading the table, so inserting a row changes the answer.
    let before = cells(&mut db, "SELECT (SELECT COUNT(*) FROM staff) AS n");
    assert_eq!(before, vec![vec!["4".to_string()]]);
    db.execute("INSERT INTO staff VALUES (5, 2, 'Eve', 210)")
        .unwrap();
    let after = cells(&mut db, "SELECT (SELECT COUNT(*) FROM staff) AS n");
    assert_eq!(after, vec![vec!["5".to_string()]]);
}

#[test]
fn a_value_query_reports_a_typed_column() {
    let mut db = shop();
    let result = db
        .query("SELECT (SELECT name FROM dept WHERE id = 1) AS label")
        .unwrap();
    assert_eq!(result.columns(), vec!["label".to_string()]);
    assert_eq!(result.value(0, 0), Some(&Value::text("Bakery")));
}

#[test]
fn a_plan_shows_the_query_an_operator_runs() {
    let mut db = shop();
    let lines: Vec<String> = db
        .query("EXPLAIN SELECT name, (SELECT COUNT(*) FROM staff) AS total FROM dept")
        .unwrap()
        .rows()
        .iter()
        .map(|r| r.get(0).unwrap().to_string())
        .collect();
    // The projection runs the query, so the query hangs under the projection
    // and ahead of what the projection reads.
    assert_eq!(lines[0].trim(), "Project (2 cols)");
    assert_eq!(lines[1].trim(), "Subquery");
    assert!(
        lines.iter().position(|l| l.trim() == "Scan staff").unwrap()
            < lines.iter().position(|l| l.trim() == "Scan dept").unwrap(),
        "the inner scan should sit inside the subquery, ahead of the input: {:?}",
        lines
    );
}

#[test]
fn the_query_a_filter_runs_hangs_under_that_filter() {
    let mut db = shop();
    let lines: Vec<String> = db
        .query("EXPLAIN SELECT name FROM dept WHERE EXISTS (SELECT 1 FROM staff)")
        .unwrap()
        .rows()
        .iter()
        .map(|r| r.get(0).unwrap().to_string())
        .collect();
    let filter = lines.iter().position(|l| l.trim() == "Filter").unwrap();
    let sub = lines.iter().position(|l| l.trim() == "Subquery").unwrap();
    assert!(sub > filter, "plan was {:?}", lines);
    let indent = |l: &String| l.len() - l.trim_start().len();
    assert_eq!(
        indent(&lines[sub]),
        indent(&lines[filter]) + 2,
        "the subquery should sit one step inside the filter: {:?}",
        lines
    );
}

#[test]
fn a_plan_without_a_query_inside_reads_as_it_always_did() {
    let mut db = shop();
    let plain: Vec<String> = db
        .query("EXPLAIN SELECT name FROM dept WHERE budget > 300")
        .unwrap()
        .rows()
        .iter()
        .map(|r| r.get(0).unwrap().to_string())
        .collect();
    assert!(
        !plain.iter().any(|l| l.trim() == "Subquery"),
        "plan was {:?}",
        plain
    );
    // The same query with one inside does say so, which is what makes the
    // absence above mean something.
    let nested: Vec<String> = db
        .query("EXPLAIN SELECT name FROM dept WHERE budget > (SELECT MIN(pay) FROM staff)")
        .unwrap()
        .rows()
        .iter()
        .map(|r| r.get(0).unwrap().to_string())
        .collect();
    assert!(
        nested.iter().any(|l| l.trim() == "Subquery"),
        "plan was {:?}",
        nested
    );
}

#[test]
fn every_query_an_operator_runs_is_shown() {
    let mut db = shop();
    let lines: Vec<String> = db
        .query(
            "EXPLAIN SELECT (SELECT COUNT(*) FROM staff) AS a, \
                            (SELECT COUNT(*) FROM dept) AS b FROM dept",
        )
        .unwrap()
        .rows()
        .iter()
        .map(|r| r.get(0).unwrap().to_string())
        .collect();
    assert_eq!(
        lines.iter().filter(|l| l.trim() == "Subquery").count(),
        2,
        "plan was {:?}",
        lines
    );
}

#[test]
fn a_query_runs_far_enough_to_report_its_own_errors() {
    let mut db = shop();
    // EXISTS answers from whether rows came back, and the rows are produced the
    // ordinary way, so a division by zero inside one is raised rather than
    // stepped over.
    let err = db
        .query("SELECT name FROM dept WHERE EXISTS (SELECT pay / 0 FROM staff)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Execution);
    // Control: the same shape without the bad arithmetic answers true.
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE EXISTS (SELECT pay FROM staff) ORDER BY id",
    );
    assert_eq!(names.len(), 3);
}

#[test]
fn a_query_supplies_a_value_to_insert() {
    let mut db = shop();
    db.execute("CREATE TABLE tally (n INTEGER)").unwrap();
    db.execute("INSERT INTO tally VALUES ((SELECT COUNT(*) FROM staff))")
        .unwrap();
    let rows = cells(&mut db, "SELECT n FROM tally");
    assert_eq!(rows, vec![vec!["4".to_string()]]);
}

#[test]
fn a_query_orders_the_rows_of_the_one_around_it() {
    let mut db = shop();
    let names = column(
        &mut db,
        "SELECT name FROM dept \
         ORDER BY (SELECT COUNT(*) FROM staff WHERE staff.dept_id = dept.id) DESC, name",
    );
    assert_eq!(names, vec!["Bakery", "Deli", "Flowers"]);
}

#[test]
fn a_query_stands_in_a_group_by_key() {
    let mut db = shop();
    let rows = cells(
        &mut db,
        "SELECT COUNT(*) FROM staff GROUP BY (SELECT 1)",
    );
    assert_eq!(rows, vec![vec!["4".to_string()]]);
}
