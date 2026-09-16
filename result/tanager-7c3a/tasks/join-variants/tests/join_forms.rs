//! Integration tests for the join forms that keep rows from the right input:
//! `RIGHT`, `FULL` and the unconstrained `CROSS`.

use tanager::{Database, ErrorKind, QueryResult};

/// Two small relations that overlap partially in both directions: `east` and
/// `west` pair up, `north` is a depot with no crew, and `south` is a crew with
/// no depot.
fn fleet() -> Database {
    let mut db = Database::new();
    db.execute("CREATE TABLE depots (region TEXT NOT NULL, bays INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE crews (region TEXT NOT NULL, lead TEXT NOT NULL, size INTEGER)")
        .unwrap();
    db.execute("INSERT INTO depots VALUES ('east', 4), ('west', 2), ('north', 9)")
        .unwrap();
    db.execute(
        "INSERT INTO crews VALUES \
            ('east', 'Ines', 6), \
            ('east', 'Omar', 3), \
            ('west', 'Pia', 5), \
            ('south', 'Ravi', 8)",
    )
    .unwrap();
    db
}

fn cells(result: &QueryResult) -> Vec<Vec<String>> {
    result
        .rows()
        .iter()
        .map(|row| row.values().iter().map(|v| v.to_string()).collect())
        .collect()
}

fn run(db: &mut Database, sql: &str) -> Vec<Vec<String>> {
    cells(&db.query(sql).unwrap())
}

#[test]
fn right_join_keeps_unmatched_right_rows() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT d.region, c.lead FROM depots d RIGHT JOIN crews c ON d.region = c.region",
    );
    // Every crew survives; Ravi's south crew has no depot to pair with.
    assert_eq!(rows.len(), 4);
    assert!(rows.contains(&vec!["NULL".to_string(), "Ravi".to_string()]));
    // north has no crew, so it is nowhere in the output.
    assert!(!rows.iter().any(|r| r[0] == "north"));
}

#[test]
fn right_join_pads_the_left_columns_with_null() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT d.bays, c.size FROM depots d RIGHT JOIN crews c ON d.region = c.region \
         WHERE c.lead = 'Ravi'",
    );
    assert_eq!(rows, vec![vec!["NULL".to_string(), "8".to_string()]]);
}

#[test]
fn right_join_puts_unmatched_right_rows_last() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT c.lead FROM depots d RIGHT JOIN crews c ON d.region = c.region",
    );
    // Pairings come first in left order, so both east crews precede the west
    // one; Ravi pairs with nothing and closes the result.
    let order: Vec<String> = rows.into_iter().map(|r| r[0].clone()).collect();
    assert_eq!(order, vec!["Ines", "Omar", "Pia", "Ravi"]);
}

#[test]
fn full_join_keeps_both_unmatched_sides() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT d.region, c.lead FROM depots d FULL JOIN crews c ON d.region = c.region",
    );
    // 3 pairings + north with no crew + Ravi with no depot.
    assert_eq!(rows.len(), 5);
    assert!(rows.contains(&vec!["north".to_string(), "NULL".to_string()]));
    assert!(rows.contains(&vec!["NULL".to_string(), "Ravi".to_string()]));
}

#[test]
fn full_join_orders_left_leftovers_before_right_leftovers() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT d.region, c.lead FROM depots d FULL JOIN crews c ON d.region = c.region",
    );
    let shape: Vec<String> = rows.iter().map(|r| format!("{}/{}", r[0], r[1])).collect();
    assert_eq!(
        shape,
        vec![
            "east/Ines",
            "east/Omar",
            "west/Pia",
            "north/NULL",
            "NULL/Ravi",
        ]
    );
}

#[test]
fn outer_is_optional_noise() {
    let mut db = fleet();
    let plain = run(
        &mut db,
        "SELECT c.lead FROM depots d FULL JOIN crews c ON d.region = c.region",
    );
    let spelled = run(
        &mut db,
        "SELECT c.lead FROM depots d FULL OUTER JOIN crews c ON d.region = c.region",
    );
    assert_eq!(plain, spelled);
    let right_plain = run(
        &mut db,
        "SELECT c.lead FROM depots d RIGHT JOIN crews c ON d.region = c.region",
    );
    let right_spelled = run(
        &mut db,
        "SELECT c.lead FROM depots d RIGHT OUTER JOIN crews c ON d.region = c.region",
    );
    assert_eq!(right_plain, right_spelled);
}

#[test]
fn cross_join_pairs_everything() {
    let mut db = fleet();
    let rows = run(&mut db, "SELECT d.region, c.lead FROM depots d CROSS JOIN crews c");
    assert_eq!(rows.len(), 12);
    // Left order outside, right order inside.
    assert_eq!(rows[0], vec!["east".to_string(), "Ines".to_string()]);
    assert_eq!(rows[3], vec!["east".to_string(), "Ravi".to_string()]);
    assert_eq!(rows[4], vec!["west".to_string(), "Ines".to_string()]);
}

#[test]
fn cross_join_refuses_a_constraint() {
    let mut db = fleet();
    let err = db
        .query("SELECT d.bays FROM depots d CROSS JOIN crews c ON d.region = c.region")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Parse);
    let err2 = db
        .query("SELECT d.bays FROM depots d CROSS JOIN crews c USING (region)")
        .unwrap_err();
    assert_eq!(err2.kind(), ErrorKind::Parse);
}

#[test]
fn a_constrained_join_demands_its_constraint() {
    let mut db = fleet();
    let err = db
        .query("SELECT d.bays FROM depots d FULL JOIN crews c")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Parse);
}

#[test]
fn where_over_a_right_join_reads_the_padded_row() {
    let mut db = fleet();
    // bays is NULL on Ravi's padded row, so a test on it drops that row and a
    // test for NULL keeps only it.
    let kept = run(
        &mut db,
        "SELECT c.lead FROM depots d RIGHT JOIN crews c ON d.region = c.region WHERE d.bays > 1",
    );
    assert_eq!(kept.len(), 3);
    let padded = run(
        &mut db,
        "SELECT c.lead FROM depots d RIGHT JOIN crews c ON d.region = c.region \
         WHERE d.bays IS NULL",
    );
    assert_eq!(padded, vec![vec!["Ravi".to_string()]]);
}

#[test]
fn where_over_a_full_join_reads_both_padded_sides() {
    let mut db = fleet();
    let left_only = run(
        &mut db,
        "SELECT d.region FROM depots d FULL JOIN crews c ON d.region = c.region \
         WHERE c.size IS NULL",
    );
    assert_eq!(left_only, vec![vec!["north".to_string()]]);
    let right_only = run(
        &mut db,
        "SELECT c.lead FROM depots d FULL JOIN crews c ON d.region = c.region \
         WHERE d.bays IS NULL",
    );
    assert_eq!(right_only, vec![vec!["Ravi".to_string()]]);
}

#[test]
fn a_left_side_test_still_narrows_a_left_join() {
    let mut db = fleet();
    // The rewrite that moves this conjunct into the left input is sound here,
    // and the answer must not change either way.
    let rows = run(
        &mut db,
        "SELECT d.region, c.lead FROM depots d LEFT JOIN crews c ON d.region = c.region \
         WHERE d.bays > 3",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "Ines".to_string()],
            vec!["east".to_string(), "Omar".to_string()],
            vec!["north".to_string(), "NULL".to_string()],
        ]
    );
}

#[test]
fn aggregating_over_a_full_join_counts_the_padded_rows() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT COUNT(*), COUNT(c.lead), COUNT(d.region) FROM depots d \
         FULL JOIN crews c ON d.region = c.region",
    );
    // 5 rows out, 4 of them carrying a crew and 4 carrying a depot.
    assert_eq!(
        rows,
        vec![vec!["5".to_string(), "4".to_string(), "4".to_string()]]
    );
}

#[test]
fn grouping_over_a_right_join_sees_the_null_group() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT d.region, COUNT(*) FROM depots d RIGHT JOIN crews c ON d.region = c.region \
         GROUP BY d.region",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "2".to_string()],
            vec!["west".to_string(), "1".to_string()],
            vec!["NULL".to_string(), "1".to_string()],
        ]
    );
}

#[test]
fn ordering_a_right_join_sorts_the_padded_row_by_its_nulls() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT c.lead FROM depots d RIGHT JOIN crews c ON d.region = c.region \
         ORDER BY d.bays NULLS FIRST, c.lead",
    );
    let order: Vec<String> = rows.into_iter().map(|r| r[0].clone()).collect();
    assert_eq!(order, vec!["Ravi", "Pia", "Ines", "Omar"]);
}

#[test]
fn a_right_join_chains_onto_an_earlier_join() {
    let mut db = fleet();
    db.execute("CREATE TABLE vans (lead TEXT NOT NULL, plate TEXT NOT NULL)")
        .unwrap();
    db.execute("INSERT INTO vans VALUES ('Ines', 'VN-1'), ('Ravi', 'VN-2'), ('Zoe', 'VN-3')")
        .unwrap();
    let rows = run(
        &mut db,
        "SELECT c.lead, v.plate FROM depots d RIGHT JOIN crews c ON d.region = c.region \
         RIGHT JOIN vans v ON c.lead = v.lead",
    );
    assert_eq!(
        rows,
        vec![
            vec!["Ines".to_string(), "VN-1".to_string()],
            vec!["Ravi".to_string(), "VN-2".to_string()],
            vec!["NULL".to_string(), "VN-3".to_string()],
        ]
    );
}

#[test]
fn cross_join_feeds_an_aggregate() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT SUM(d.bays * c.size) FROM depots d CROSS JOIN crews c",
    );
    // (4 + 2 + 9) bays against (6 + 3 + 5 + 8) crew, every pairing once.
    assert_eq!(rows, vec![vec!["330".to_string()]]);
}

#[test]
fn cross_join_narrows_under_a_where() {
    let mut db = fleet();
    let rows = run(
        &mut db,
        "SELECT d.region, c.lead FROM depots d CROSS JOIN crews c \
         WHERE d.bays > 3 AND c.size < 4",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "Omar".to_string()],
            vec!["north".to_string(), "Omar".to_string()],
        ]
    );
}
