//! A query written inside another one may read the row around it. These cases
//! cover which names it can see, how far out it can reach, and what the
//! optimizer is allowed to do with a predicate that reaches.

use tanager::error::ErrorKind;
use tanager::Database;

fn depot() -> Database {
    let mut db = Database::new();
    db.execute("CREATE TABLE dept (id INTEGER, name TEXT, budget INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE staff (id INTEGER, dept_id INTEGER, name TEXT, pay INTEGER)")
        .unwrap();
    db.execute("INSERT INTO dept VALUES (1, 'Bakery', 900), (2, 'Deli', 400), (3, 'Flowers', 250)")
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

fn plan(db: &mut Database, sql: &str) -> Vec<String> {
    column(db, &format!("EXPLAIN {}", sql))
}

/// The depth of a plan line, in indent steps.
fn depth(line: &str) -> usize {
    (line.len() - line.trim_start().len()) / 2
}

/// The first line at the outermost depth whose text is `want`.
fn top_line(lines: &[String], want: &str) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if line.trim() != want {
            continue;
        }
        let better = match best {
            None => true,
            Some(b) => depth(line) < depth(&lines[b]),
        };
        if better {
            best = Some(i);
        }
    }
    best
}

#[test]
fn a_reaching_query_is_answered_once_for_each_outer_row() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT name, (SELECT COUNT(*) FROM staff WHERE staff.dept_id = dept.id) AS people \
         FROM dept ORDER BY id",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Bakery".to_string(), "2".to_string()],
            vec!["Deli".to_string(), "1".to_string()],
            vec!["Flowers".to_string(), "0".to_string()],
        ]
    );
}

#[test]
fn a_reaching_query_that_matches_nothing_reads_null() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT name, (SELECT MAX(pay) FROM staff WHERE staff.dept_id = dept.id) AS top \
         FROM dept ORDER BY id",
    );
    assert_eq!(rows[2], vec!["Flowers".to_string(), "NULL".to_string()]);
    assert_eq!(rows[0], vec!["Bakery".to_string(), "300".to_string()]);
}

#[test]
fn exists_over_a_reaching_query_filters_row_by_row() {
    let mut db = depot();
    let names = column(
        &mut db,
        "SELECT name FROM dept \
         WHERE EXISTS (SELECT 1 FROM staff WHERE staff.dept_id = dept.id AND pay > 250) \
         ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery"]);
}

#[test]
fn membership_over_a_reaching_query_filters_row_by_row() {
    let mut db = depot();
    let names = column(
        &mut db,
        "SELECT s.name FROM staff s \
         WHERE s.pay IN (SELECT pay FROM staff x WHERE x.dept_id = s.dept_id AND x.id <> s.id) \
         ORDER BY s.id",
    );
    assert!(names.is_empty());
    let shared = column(
        &mut db,
        "SELECT s.name FROM staff s \
         WHERE s.pay IN (SELECT pay FROM staff x WHERE x.dept_id = s.dept_id) \
         ORDER BY s.id",
    );
    assert_eq!(shared, vec!["Ada", "Bo", "Cy"]);
}

#[test]
fn the_inner_relations_are_consulted_first() {
    let mut db = depot();
    // `dept_id` and `id` both exist inside, so neither name reaches outward and
    // the condition is about staff alone. It holds for Ada, so every
    // department passes.
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE EXISTS (SELECT 1 FROM staff WHERE dept_id = id) ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery", "Deli", "Flowers"]);
}

#[test]
fn qualifying_a_name_reaches_the_enclosing_relation() {
    let mut db = depot();
    // Same query as above, except the right side is qualified with the outer
    // relation, which changes what it means and which rows survive.
    let names = column(
        &mut db,
        "SELECT name FROM dept \
         WHERE EXISTS (SELECT 1 FROM staff WHERE dept_id = dept.id) ORDER BY id",
    );
    assert_eq!(names, vec!["Bakery", "Deli"]);
}

#[test]
fn an_alias_on_the_enclosing_relation_is_the_name_to_reach_for() {
    let mut db = depot();
    let names = column(
        &mut db,
        "SELECT d.name FROM dept d \
         WHERE EXISTS (SELECT 1 FROM staff s WHERE s.dept_id = d.id) ORDER BY d.id",
    );
    assert_eq!(names, vec!["Bakery", "Deli"]);
    let err = db
        .query(
            "SELECT d.name FROM dept d \
             WHERE EXISTS (SELECT 1 FROM staff s WHERE s.dept_id = dept.id)",
        )
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn a_name_neither_query_offers_is_unknown() {
    let mut db = depot();
    let err = db
        .query("SELECT name FROM dept WHERE EXISTS (SELECT 1 FROM staff WHERE nonesuch = 1)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    let names = column(
        &mut db,
        "SELECT name FROM dept WHERE EXISTS (SELECT 1 FROM staff WHERE pay = 300) ORDER BY id",
    );
    assert_eq!(names.len(), 3);
}

#[test]
fn only_the_query_immediately_around_it_is_visible() {
    let mut db = depot();
    // `d` encloses the middle query, which encloses this one: two levels out,
    // which is one too many.
    let err = db
        .query(
            "SELECT d.name FROM dept d WHERE EXISTS ( \
                SELECT 1 FROM staff s WHERE EXISTS ( \
                    SELECT 1 FROM dept x WHERE x.id = d.id))",
        )
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    // One level from each query is fine, however deeply the queries nest.
    let names = column(
        &mut db,
        "SELECT d.name FROM dept d WHERE EXISTS ( \
            SELECT 1 FROM staff s WHERE s.dept_id = d.id AND EXISTS ( \
                SELECT 1 FROM dept x WHERE x.id = s.dept_id)) ORDER BY d.id",
    );
    assert_eq!(names, vec!["Bakery", "Deli"]);
}

#[test]
fn a_reaching_query_sees_the_joined_row_it_sits_on() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT d.name, s.name FROM dept d JOIN staff s ON s.dept_id = d.id \
         WHERE s.pay IN (SELECT pay FROM staff x WHERE x.dept_id = d.id) \
         ORDER BY s.id",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Bakery".to_string(), "Ada".to_string()],
            vec!["Bakery".to_string(), "Bo".to_string()],
            vec!["Deli".to_string(), "Cy".to_string()],
        ]
    );
}

#[test]
fn a_reaching_predicate_stays_above_the_join_it_was_written_over() {
    let mut db = depot();
    let lines = plan(
        &mut db,
        "SELECT d.name FROM dept d JOIN staff s ON s.dept_id = d.id \
         WHERE s.pay IN (SELECT pay FROM staff x WHERE x.dept_id = d.id)",
    );
    let filter = top_line(&lines, "Filter");
    let join = top_line(&lines, "INNER JOIN");
    assert!(filter.is_some() && join.is_some(), "plan was {:?}", lines);
    assert!(
        filter.unwrap() < join.unwrap(),
        "the filter moved below the join: {:?}",
        lines
    );
}

#[test]
fn a_self_contained_predicate_is_free_to_move_into_an_input() {
    let mut db = depot();
    let lines = plan(
        &mut db,
        "SELECT d.name FROM dept d JOIN staff s ON s.dept_id = d.id \
         WHERE s.pay IN (SELECT pay FROM staff WHERE pay > 200)",
    );
    let filter = top_line(&lines, "Filter");
    let join = top_line(&lines, "INNER JOIN");
    assert!(filter.is_some() && join.is_some(), "plan was {:?}", lines);
    assert!(
        filter.unwrap() > join.unwrap(),
        "the filter stayed above the join: {:?}",
        lines
    );
}

#[test]
fn where_a_predicate_ends_up_does_not_change_the_answer() {
    let mut db = depot();
    let reaching = cells(
        &mut db,
        "SELECT d.name, s.name FROM dept d JOIN staff s ON s.dept_id = d.id \
         WHERE s.pay IN (SELECT pay FROM staff x WHERE x.dept_id = d.id) ORDER BY s.id",
    );
    // The same rows, asked without a subquery at all.
    let plain = cells(
        &mut db,
        "SELECT d.name, s.name FROM dept d JOIN staff s ON s.dept_id = d.id ORDER BY s.id",
    );
    assert_eq!(reaching, plain);
}

#[test]
fn an_aggregate_written_inside_belongs_to_the_inner_query() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT dept_id, COUNT(*) FROM staff GROUP BY dept_id \
         HAVING COUNT(*) < (SELECT COUNT(*) FROM staff) ORDER BY dept_id",
    );
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0], vec!["1".to_string(), "2".to_string()]);
}

#[test]
fn a_reaching_aggregate_summarises_only_the_matching_rows() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT name, (SELECT AVG(pay) FROM staff WHERE staff.dept_id = dept.id) AS mean \
         FROM dept WHERE id < 3 ORDER BY id",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Bakery".to_string(), "275.0".to_string()],
            vec!["Deli".to_string(), "200.0".to_string()],
        ]
    );
}

#[test]
fn a_reaching_query_may_order_and_limit_its_own_rows() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT name, (SELECT name FROM staff WHERE staff.dept_id = dept.id \
                       ORDER BY pay DESC LIMIT 1) AS lead \
         FROM dept ORDER BY id",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Bakery".to_string(), "Ada".to_string()],
            vec!["Deli".to_string(), "Cy".to_string()],
            vec!["Flowers".to_string(), "NULL".to_string()],
        ]
    );
}

#[test]
fn a_query_may_be_read_from_a_join_condition() {
    let mut db = depot();
    let names = column(
        &mut db,
        "SELECT d.name FROM dept d JOIN staff s \
         ON s.dept_id = d.id AND s.pay > (SELECT AVG(pay) FROM staff) ORDER BY d.id",
    );
    assert_eq!(names, vec!["Bakery", "Bakery"]);
}

#[test]
fn reaching_and_self_contained_queries_nest_together() {
    let mut db = depot();
    let names = column(
        &mut db,
        "SELECT s.name FROM staff s WHERE EXISTS ( \
            SELECT 1 FROM dept WHERE dept.id = s.dept_id \
              AND budget > (SELECT AVG(budget) FROM dept)) ORDER BY s.id",
    );
    assert_eq!(names, vec!["Ada", "Bo"]);
}

#[test]
fn reaching_membership_keeps_its_three_valued_answer() {
    let mut db = depot();
    // Each row asks about the departments cheaper than its own pay, so the
    // candidates differ per row and are sometimes none at all. Di has no
    // department, and a NULL on the left is unknown however few candidates
    // there are, so that row is never kept.
    let names = column(
        &mut db,
        "SELECT s.name FROM staff s \
         WHERE s.dept_id NOT IN (SELECT id FROM dept WHERE dept.budget < s.pay) ORDER BY s.id",
    );
    assert_eq!(names, vec!["Ada", "Bo", "Cy"]);
    // Widening the candidates until every department qualifies leaves nothing.
    let none = column(
        &mut db,
        "SELECT s.name FROM staff s \
         WHERE s.dept_id NOT IN (SELECT id FROM dept WHERE dept.budget > 100) ORDER BY s.id",
    );
    assert!(none.is_empty());
}

#[test]
fn the_enclosing_row_is_read_again_when_the_data_changes() {
    let mut db = depot();
    let before = cells(
        &mut db,
        "SELECT name, (SELECT COUNT(*) FROM staff WHERE staff.dept_id = dept.id) AS people \
         FROM dept WHERE id = 3",
    );
    assert_eq!(before, vec![vec!["Flowers".to_string(), "0".to_string()]]);
    db.execute("INSERT INTO staff VALUES (5, 3, 'Eve', 180)")
        .unwrap();
    let after = cells(
        &mut db,
        "SELECT name, (SELECT COUNT(*) FROM staff WHERE staff.dept_id = dept.id) AS people \
         FROM dept WHERE id = 3",
    );
    assert_eq!(after, vec![vec!["Flowers".to_string(), "1".to_string()]]);
}

#[test]
fn ordering_the_outer_query_does_not_disturb_the_reaching_one() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT name, (SELECT COUNT(*) FROM staff WHERE staff.dept_id = dept.id) AS people \
         FROM dept ORDER BY budget",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Flowers".to_string(), "0".to_string()],
            vec!["Deli".to_string(), "1".to_string()],
            vec!["Bakery".to_string(), "2".to_string()],
        ]
    );
}

#[test]
fn a_grouped_query_offers_its_grouping_columns_to_an_inner_query() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT dept_id, (SELECT name FROM dept WHERE dept.id = dept_id) AS label \
         FROM staff GROUP BY dept_id ORDER BY dept_id",
    );
    assert_eq!(
        rows,
        vec![
            vec!["1".to_string(), "Bakery".to_string()],
            vec!["2".to_string(), "Deli".to_string()],
            vec!["NULL".to_string(), "NULL".to_string()],
        ]
    );
}

#[test]
fn a_grouping_column_reaches_into_a_having_clause_too() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT dept_id, COUNT(*) FROM staff GROUP BY dept_id \
         HAVING COUNT(*) > (SELECT 0 FROM dept WHERE dept.id = dept_id) ORDER BY dept_id",
    );
    assert_eq!(
        rows,
        vec![
            vec!["1".to_string(), "2".to_string()],
            vec!["2".to_string(), "1".to_string()],
        ]
    );
}

#[test]
fn a_grouped_query_offers_nothing_but_its_grouping_columns() {
    let mut db = depot();
    let err = db
        .query(
            "SELECT dept_id, (SELECT COUNT(*) FROM dept WHERE dept.budget > pay) \
             FROM staff GROUP BY dept_id",
        )
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    // Control: the same shape reading the grouping column binds and runs.
    let rows = cells(
        &mut db,
        "SELECT dept_id, (SELECT COUNT(*) FROM dept WHERE dept.id > dept_id) AS above \
         FROM staff GROUP BY dept_id ORDER BY dept_id",
    );
    assert_eq!(rows[0], vec!["1".to_string(), "2".to_string()]);
}

#[test]
fn a_self_contained_query_still_reads_the_same_under_grouping() {
    let mut db = depot();
    let rows = cells(
        &mut db,
        "SELECT dept_id FROM staff GROUP BY dept_id \
         HAVING COUNT(*) > (SELECT COUNT(*) FROM staff x WHERE x.pay > 1000) ORDER BY dept_id",
    );
    assert_eq!(rows.len(), 3);
}
