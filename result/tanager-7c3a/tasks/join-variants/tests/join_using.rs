//! Integration tests for `USING`, where a join names the columns it pairs on
//! and each of those columns collapses to one output column.

use tanager::{Database, ErrorKind, QueryResult};

/// `east` and `west` are known to both relations, `north` only ships parcels
/// and `south` is only a hub. `depot` sits second in `parcels` and first in
/// `hubs`, so merging it moves the other columns.
fn network() -> Database {
    let mut db = Database::new();
    db.execute("CREATE TABLE parcels (label TEXT NOT NULL, depot TEXT NOT NULL, weight INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE hubs (depot TEXT NOT NULL, city TEXT NOT NULL)")
        .unwrap();
    db.execute("INSERT INTO parcels VALUES ('P1', 'east', 5), ('P2', 'west', 9), ('P3', 'north', 2)")
        .unwrap();
    db.execute("INSERT INTO hubs VALUES ('east', 'Ferrol'), ('west', 'Gant'), ('south', 'Hale')")
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

fn columns(db: &mut Database, sql: &str) -> Vec<String> {
    db.query(sql).unwrap().columns()
}

#[test]
fn merged_column_leads_the_output_row() {
    let mut db = network();
    let names = columns(&mut db, "SELECT * FROM parcels JOIN hubs USING (depot)");
    assert_eq!(names, vec!["depot", "label", "weight", "city"]);
}

#[test]
fn merged_column_appears_once_under_a_wildcard() {
    let mut db = network();
    let rows = run(&mut db, "SELECT * FROM parcels JOIN hubs USING (depot)");
    assert_eq!(
        rows,
        vec![
            vec![
                "east".to_string(),
                "P1".to_string(),
                "5".to_string(),
                "Ferrol".to_string()
            ],
            vec![
                "west".to_string(),
                "P2".to_string(),
                "9".to_string(),
                "Gant".to_string()
            ],
        ]
    );
}

#[test]
fn a_bare_name_reaches_the_merged_column() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT depot, label FROM parcels JOIN hubs USING (depot) ORDER BY depot",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "P1".to_string()],
            vec!["west".to_string(), "P2".to_string()],
        ]
    );
}

#[test]
fn either_qualifier_reaches_the_merged_column() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT parcels.depot, hubs.depot FROM parcels JOIN hubs USING (depot) \
         WHERE label = 'P1'",
    );
    assert_eq!(rows, vec![vec!["east".to_string(), "east".to_string()]]);
}

#[test]
fn merging_carries_whichever_side_is_present() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT depot, label, city FROM parcels FULL JOIN hubs USING (depot)",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "P1".to_string(), "Ferrol".to_string()],
            vec!["west".to_string(), "P2".to_string(), "Gant".to_string()],
            vec!["north".to_string(), "P3".to_string(), "NULL".to_string()],
            vec!["south".to_string(), "NULL".to_string(), "Hale".to_string()],
        ]
    );
}

#[test]
fn a_right_join_merges_the_same_way() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT depot, label FROM parcels RIGHT JOIN hubs USING (depot)",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "P1".to_string()],
            vec!["west".to_string(), "P2".to_string()],
            vec!["south".to_string(), "NULL".to_string()],
        ]
    );
}

#[test]
fn a_left_join_merges_the_same_way() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT depot, city FROM parcels LEFT JOIN hubs USING (depot)",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "Ferrol".to_string()],
            vec!["west".to_string(), "Gant".to_string()],
            vec!["north".to_string(), "NULL".to_string()],
        ]
    );
}

#[test]
fn a_filter_on_a_moved_column_reads_that_column() {
    let mut db = network();
    // `label` is first in `parcels` and second in the merged row. A rewrite
    // that carries the merged position into the input frame would read `depot`
    // here instead.
    let rows = run(
        &mut db,
        "SELECT depot, label, weight FROM parcels JOIN hubs USING (depot) WHERE label = 'P2'",
    );
    assert_eq!(
        rows,
        vec![vec![
            "west".to_string(),
            "P2".to_string(),
            "9".to_string()
        ]]
    );
}

#[test]
fn a_filter_on_a_carried_column_still_narrows() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT label FROM parcels JOIN hubs USING (depot) WHERE weight > 6",
    );
    assert_eq!(rows, vec![vec!["P2".to_string()]]);
}

#[test]
fn a_filter_on_the_merged_column_narrows() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT label, city FROM parcels FULL JOIN hubs USING (depot) WHERE depot = 'south'",
    );
    assert_eq!(rows, vec![vec!["NULL".to_string(), "Hale".to_string()]]);
}

#[test]
fn two_columns_merge_at_once() {
    let mut db = network();
    db.execute("CREATE TABLE lanes (depot TEXT NOT NULL, city TEXT NOT NULL, hours INTEGER)")
        .unwrap();
    db.execute("INSERT INTO lanes VALUES ('east', 'Ferrol', 3), ('west', 'Ilsa', 7)")
        .unwrap();
    let names = columns(&mut db, "SELECT * FROM hubs JOIN lanes USING (depot, city)");
    assert_eq!(names, vec!["depot", "city", "hours"]);
    let rows = run(&mut db, "SELECT * FROM hubs JOIN lanes USING (depot, city)");
    // west pairs on depot but not on city, so only east survives.
    assert_eq!(
        rows,
        vec![vec![
            "east".to_string(),
            "Ferrol".to_string(),
            "3".to_string()
        ]]
    );
}

#[test]
fn merged_columns_follow_the_order_they_were_named() {
    let mut db = network();
    db.execute("CREATE TABLE lanes (depot TEXT NOT NULL, city TEXT NOT NULL, hours INTEGER)")
        .unwrap();
    db.execute("INSERT INTO lanes VALUES ('east', 'Ferrol', 3)")
        .unwrap();
    let names = columns(&mut db, "SELECT * FROM hubs JOIN lanes USING (city, depot)");
    assert_eq!(names, vec!["city", "depot", "hours"]);
}

#[test]
fn a_qualified_wildcard_shows_its_own_columns() {
    let mut db = network();
    let names = columns(
        &mut db,
        "SELECT hubs.* FROM parcels JOIN hubs USING (depot)",
    );
    assert_eq!(names, vec!["depot", "city"]);
}

#[test]
fn ordering_by_the_merged_column_works_by_name_and_position() {
    let mut db = network();
    let by_name = run(
        &mut db,
        "SELECT depot, label FROM parcels FULL JOIN hubs USING (depot) ORDER BY depot DESC",
    );
    let by_position = run(
        &mut db,
        "SELECT depot, label FROM parcels FULL JOIN hubs USING (depot) ORDER BY 1 DESC",
    );
    assert_eq!(by_name, by_position);
    assert_eq!(by_name[0][0], "west");
    assert_eq!(by_name[3][0], "east");
}

#[test]
fn grouping_by_a_merged_column_counts_each_depot_once() {
    let mut db = network();
    let rows = run(
        &mut db,
        "SELECT depot, COUNT(*) FROM parcels FULL JOIN hubs USING (depot) GROUP BY depot \
         ORDER BY depot",
    );
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0], vec!["east".to_string(), "1".to_string()]);
}

#[test]
fn merging_chains_into_a_later_join() {
    let mut db = network();
    db.execute("CREATE TABLE crews (city TEXT NOT NULL, lead TEXT NOT NULL)")
        .unwrap();
    db.execute("INSERT INTO crews VALUES ('Ferrol', 'Ines'), ('Gant', 'Omar')")
        .unwrap();
    let rows = run(
        &mut db,
        "SELECT depot, label, lead FROM parcels JOIN hubs USING (depot) \
         JOIN crews ON hubs.city = crews.city ORDER BY depot",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "P1".to_string(), "Ines".to_string()],
            vec!["west".to_string(), "P2".to_string(), "Omar".to_string()],
        ]
    );
}

#[test]
fn a_second_using_merges_again() {
    let mut db = network();
    db.execute("CREATE TABLE runs (depot TEXT NOT NULL, shift INTEGER)")
        .unwrap();
    db.execute("INSERT INTO runs VALUES ('east', 1), ('west', 2)")
        .unwrap();
    let names = columns(
        &mut db,
        "SELECT * FROM parcels JOIN hubs USING (depot) JOIN runs USING (depot)",
    );
    assert_eq!(names, vec!["depot", "label", "weight", "city", "shift"]);
    let rows = run(
        &mut db,
        "SELECT depot, label, shift FROM parcels JOIN hubs USING (depot) JOIN runs USING (depot)",
    );
    assert_eq!(
        rows,
        vec![
            vec!["east".to_string(), "P1".to_string(), "1".to_string()],
            vec!["west".to_string(), "P2".to_string(), "2".to_string()],
        ]
    );
}

#[test]
fn a_name_missing_from_either_side_is_rejected() {
    let mut db = network();
    let err = db
        .query("SELECT depot FROM parcels JOIN hubs USING (weight)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    let err2 = db
        .query("SELECT depot FROM parcels JOIN hubs USING (nowhere)")
        .unwrap_err();
    assert_eq!(err2.kind(), ErrorKind::Binder);
}

#[test]
fn naming_one_column_twice_is_rejected() {
    let mut db = network();
    let err = db
        .query("SELECT depot FROM parcels JOIN hubs USING (depot, depot)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn merging_columns_of_unrelated_types_is_rejected() {
    let mut db = network();
    db.execute("CREATE TABLE tallies (depot INTEGER NOT NULL, seen INTEGER)")
        .unwrap();
    let err = db
        .query("SELECT seen FROM parcels JOIN tallies USING (depot)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn a_merged_pair_of_numeric_widths_settles_on_one_type() {
    let mut db = network();
    db.execute("CREATE TABLE marks (weight FLOAT NOT NULL, grade TEXT NOT NULL)")
        .unwrap();
    db.execute("INSERT INTO marks VALUES (9.0, 'heavy'), (5.0, 'light')")
        .unwrap();
    let result = db
        .query("SELECT weight, label, grade FROM parcels JOIN marks USING (weight) ORDER BY label")
        .unwrap();
    // An INTEGER column merged with a FLOAT one is a FLOAT column, and the row
    // that came in from the integer side reads back as one.
    assert_eq!(
        result.schema().field(0).unwrap().data_type().to_string(),
        "FLOAT"
    );
    assert_eq!(
        cells(&result),
        vec![
            vec!["5.0".to_string(), "P1".to_string(), "light".to_string()],
            vec!["9.0".to_string(), "P2".to_string(), "heavy".to_string()],
        ]
    );
}
