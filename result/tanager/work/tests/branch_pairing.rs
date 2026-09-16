//! How two query branches pair up: multiplicity, ordering, widening and the
//! shape rules that decide whether they can be combined at all.

use tanager::{Database, ErrorKind};

/// A database with three small tables whose rows overlap in different ways.
fn seeded() -> Database {
    let mut db = Database::new();
    db.execute("CREATE TABLE north (city TEXT, visits INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE south (city TEXT, visits INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE readings (station TEXT, level FLOAT)")
        .unwrap();
    db.execute(
        "INSERT INTO north (city, visits) VALUES \
            ('oslo', 3), ('bergen', 1), ('oslo', 3), ('tromso', 2), ('oslo', 3)",
    )
    .unwrap();
    db.execute(
        "INSERT INTO south (city, visits) VALUES \
            ('oslo', 3), ('cork', 5), ('oslo', 3), ('bergen', 9)",
    )
    .unwrap();
    db.execute(
        "INSERT INTO readings (station, level) VALUES \
            ('oslo', 3.0), ('cork', 1.5), ('tromso', 2.0)",
    )
    .unwrap();
    db
}

/// Every cell of every row, stringified in row order.
fn table(db: &mut Database, sql: &str) -> Vec<Vec<String>> {
    db.query(sql)
        .unwrap()
        .rows()
        .iter()
        .map(|row| row.values().iter().map(|v| v.to_string()).collect())
        .collect()
}

/// The first column of every row, in row order.
fn column(db: &mut Database, sql: &str) -> Vec<String> {
    table(db, sql)
        .into_iter()
        .map(|mut cells| cells.remove(0))
        .collect()
}

#[test]
fn union_reports_each_row_once() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north UNION SELECT city FROM south"
        ),
        vec!["oslo", "bergen", "tromso", "cork"]
    );
}

#[test]
fn union_all_keeps_every_copy() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north UNION ALL SELECT city FROM south"
        ),
        vec!["oslo", "bergen", "oslo", "tromso", "oslo", "oslo", "cork", "oslo", "bergen"]
    );
}

#[test]
fn intersect_reports_shared_rows_once() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north INTERSECT SELECT city FROM south"
        ),
        vec!["oslo", "bergen"]
    );
}

#[test]
fn intersect_all_keeps_the_smaller_count() {
    let mut db = seeded();
    // 'oslo' appears three times on the left and twice on the right.
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north INTERSECT ALL SELECT city FROM south"
        ),
        vec!["oslo", "bergen", "oslo"]
    );
}

#[test]
fn except_drops_rows_the_other_branch_holds() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north EXCEPT SELECT city FROM south"
        ),
        vec!["tromso"]
    );
}

#[test]
fn except_all_cancels_one_copy_per_right_row() {
    let mut db = seeded();
    // Three 'oslo' on the left less two on the right leaves one.
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north EXCEPT ALL SELECT city FROM south"
        ),
        vec!["oslo", "tromso"]
    );
}

#[test]
fn except_all_floors_a_surplus_on_the_right_at_zero() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM south EXCEPT ALL SELECT city FROM north"
        ),
        vec!["cork"]
    );
}

#[test]
fn rows_pair_on_every_column() {
    let mut db = seeded();
    // ('bergen', 1) and ('bergen', 9) differ in their second column.
    assert_eq!(
        table(
            &mut db,
            "SELECT city, visits FROM north INTERSECT SELECT city, visits FROM south"
        ),
        vec![vec!["oslo", "3"]]
    );
}

#[test]
fn a_null_pairs_with_a_null() {
    let mut db = Database::new();
    db.execute("CREATE TABLE l (v INTEGER)").unwrap();
    db.execute("CREATE TABLE r (v INTEGER)").unwrap();
    db.execute("INSERT INTO l (v) VALUES (NULL), (1), (NULL)")
        .unwrap();
    db.execute("INSERT INTO r (v) VALUES (NULL)").unwrap();
    assert_eq!(
        column(&mut db, "SELECT v FROM l INTERSECT SELECT v FROM r"),
        vec!["NULL"]
    );
    assert_eq!(
        column(&mut db, "SELECT v FROM l EXCEPT ALL SELECT v FROM r"),
        vec!["NULL", "1"]
    );
}

#[test]
fn a_null_row_survives_a_union() {
    let mut db = Database::new();
    db.execute("CREATE TABLE l (v INTEGER)").unwrap();
    db.execute("CREATE TABLE r (v INTEGER)").unwrap();
    db.execute("INSERT INTO l (v) VALUES (NULL), (2)").unwrap();
    db.execute("INSERT INTO r (v) VALUES (NULL), (3)").unwrap();
    assert_eq!(
        column(&mut db, "SELECT v FROM l UNION SELECT v FROM r"),
        vec!["NULL", "2", "3"]
    );
}

#[test]
fn a_narrow_branch_carries_its_values_over() {
    let mut db = seeded();
    // The INTEGER branch meets a FLOAT one, so its rows arrive as floats.
    assert_eq!(
        column(
            &mut db,
            "SELECT visits FROM north UNION SELECT level FROM readings"
        ),
        vec!["3.0", "1.0", "2.0", "1.5"]
    );
}

#[test]
fn widened_rows_pair_across_the_branches() {
    let mut db = seeded();
    // visits 3 and level 3.0 are the same row once both are floats.
    assert_eq!(
        column(
            &mut db,
            "SELECT visits FROM north INTERSECT SELECT level FROM readings"
        ),
        vec!["3.0", "2.0"]
    );
}

#[test]
fn a_widened_branch_reports_the_wider_type() {
    let mut db = seeded();
    let result = db
        .query("SELECT visits FROM north UNION SELECT level FROM readings")
        .unwrap();
    let types: Vec<String> = result
        .schema()
        .fields()
        .iter()
        .map(|f| f.data_type().to_string())
        .collect();
    assert_eq!(types, vec!["FLOAT"]);
}

#[test]
fn result_names_come_from_the_leftmost_branch() {
    let mut db = seeded();
    let result = db
        .query(
            "SELECT city AS place, visits FROM north \
             UNION SELECT station, level FROM readings",
        )
        .unwrap();
    assert_eq!(result.columns(), vec!["place", "visits"]);
}

#[test]
fn intersect_binds_tighter_than_union() {
    let mut db = seeded();
    // north UNION (south INTERSECT readings): the intersection is 'oslo' and
    // 'cork', so 'cork' joins the north cities and nothing else does.
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north UNION SELECT city FROM south \
             INTERSECT SELECT station FROM readings"
        ),
        vec!["oslo", "bergen", "tromso", "cork"]
    );
}

#[test]
fn intersect_first_can_leave_fewer_rows_than_folding_left() {
    let mut db = seeded();
    // north EXCEPT (south INTERSECT readings) removes only 'oslo' and 'cork'.
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north EXCEPT SELECT city FROM south \
             INTERSECT SELECT station FROM readings"
        ),
        vec!["bergen", "tromso"]
    );
}

#[test]
fn equal_operators_fold_from_the_left() {
    let mut db = Database::new();
    db.execute("CREATE TABLE a (v INTEGER)").unwrap();
    db.execute("CREATE TABLE b (v INTEGER)").unwrap();
    db.execute("CREATE TABLE c (v INTEGER)").unwrap();
    db.execute("INSERT INTO a (v) VALUES (1), (2), (3)")
        .unwrap();
    db.execute("INSERT INTO b (v) VALUES (2)").unwrap();
    db.execute("INSERT INTO c (v) VALUES (2), (3)").unwrap();
    // (a EXCEPT b) EXCEPT c leaves 1. Folding from the right would leave 1 and 3.
    assert_eq!(
        column(
            &mut db,
            "SELECT v FROM a EXCEPT SELECT v FROM b EXCEPT SELECT v FROM c"
        ),
        vec!["1"]
    );
}

#[test]
fn a_union_follows_the_left_branch_then_appends() {
    let mut db = Database::new();
    db.execute("CREATE TABLE a (v INTEGER)").unwrap();
    db.execute("CREATE TABLE b (v INTEGER)").unwrap();
    db.execute("INSERT INTO a (v) VALUES (9), (4), (7)")
        .unwrap();
    db.execute("INSERT INTO b (v) VALUES (8), (4), (1)")
        .unwrap();
    assert_eq!(
        column(&mut db, "SELECT v FROM a UNION SELECT v FROM b"),
        vec!["9", "4", "7", "8", "1"]
    );
}

#[test]
fn an_intersection_follows_the_left_branch() {
    let mut db = Database::new();
    db.execute("CREATE TABLE a (v INTEGER)").unwrap();
    db.execute("CREATE TABLE b (v INTEGER)").unwrap();
    db.execute("INSERT INTO a (v) VALUES (9), (4), (7)")
        .unwrap();
    db.execute("INSERT INTO b (v) VALUES (7), (9)").unwrap();
    assert_eq!(
        column(&mut db, "SELECT v FROM a INTERSECT SELECT v FROM b"),
        vec!["9", "7"]
    );
}

#[test]
fn branches_of_different_widths_are_rejected() {
    let mut db = seeded();
    let err = db
        .query("SELECT city FROM north UNION SELECT city, visits FROM south")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn columns_that_do_not_unify_are_rejected() {
    let mut db = seeded();
    let err = db
        .query("SELECT city FROM north EXCEPT SELECT visits FROM south")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn a_branch_may_group_and_aggregate() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT COUNT(*) FROM north UNION ALL SELECT COUNT(*) FROM south"
        ),
        vec!["5", "4"]
    );
}

#[test]
fn a_grouping_branch_collapses_only_its_own_rows() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north GROUP BY city \
             UNION ALL SELECT city FROM south"
        ),
        vec!["oslo", "bergen", "tromso", "oslo", "cork", "oslo", "bergen"]
    );
}

#[test]
fn each_branch_counts_within_its_own_groups() {
    let mut db = seeded();
    assert_eq!(
        table(
            &mut db,
            "SELECT city, COUNT(*) FROM north GROUP BY city \
             UNION ALL SELECT city, COUNT(*) FROM south GROUP BY city"
        ),
        vec![
            vec!["oslo", "3"],
            vec!["bergen", "1"],
            vec!["tromso", "1"],
            vec!["oslo", "2"],
            vec!["cork", "1"],
            vec!["bergen", "1"],
        ]
    );
}

#[test]
fn grouped_branches_pair_on_their_group_rows() {
    let mut db = seeded();
    assert_eq!(
        table(
            &mut db,
            "SELECT city, COUNT(*) FROM north GROUP BY city \
             INTERSECT SELECT city, COUNT(*) FROM south GROUP BY city"
        ),
        vec![vec!["bergen", "1"]]
    );
    assert_eq!(
        table(
            &mut db,
            "SELECT city, COUNT(*) FROM north GROUP BY city \
             EXCEPT SELECT city, COUNT(*) FROM south GROUP BY city"
        ),
        vec![vec!["oslo", "3"], vec!["tromso", "1"]]
    );
}

#[test]
fn a_grouped_branch_meets_an_ungrouped_one() {
    let mut db = seeded();
    let mut result = db
        .query(
            "SELECT city, SUM(visits) FROM north GROUP BY city \
             UNION SELECT city, visits FROM south",
        )
        .unwrap();
    assert_eq!(result.columns(), vec!["city", "sum"]);
    let rows: Vec<Vec<String>> = result
        .rows()
        .iter()
        .map(|row| row.values().iter().map(|v| v.to_string()).collect())
        .collect();
    assert_eq!(
        rows,
        vec![
            vec!["oslo", "9"],
            vec!["bergen", "1"],
            vec!["tromso", "2"],
            vec!["oslo", "3"],
            vec!["cork", "5"],
            vec!["bergen", "9"],
        ]
    );
    result = db
        .query("SELECT city, MAX(visits) FROM south GROUP BY city")
        .unwrap();
    assert_eq!(result.row_count(), 3);
}

#[test]
fn distinct_inside_a_branch_binds_to_that_branch() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT DISTINCT city FROM north UNION ALL SELECT city FROM south"
        ),
        vec!["oslo", "bergen", "tromso", "oslo", "cork", "oslo", "bergen"]
    );
}

#[test]
fn a_filtered_branch_contributes_only_its_matching_rows() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north WHERE visits > 2 \
             UNION SELECT city FROM south WHERE visits > 4"
        ),
        vec!["oslo", "cork", "bergen"]
    );
}

#[test]
fn three_branches_chain_left_to_right() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT city FROM north UNION SELECT city FROM south \
             UNION ALL SELECT station FROM readings"
        ),
        vec!["oslo", "bergen", "tromso", "cork", "oslo", "cork", "tromso"]
    );
}
