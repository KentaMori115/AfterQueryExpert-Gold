//! `DELETE`: which rows go, which stay, in what order, and what the statement
//! reports back.

use tanager::{Database, ErrorKind, Outcome};

/// A small table with one nullable column, so a predicate over it can come out
/// unknown rather than false.
fn seeded() -> Database {
    let mut db = Database::new();
    db.execute(
        "CREATE TABLE parts (\
            id INTEGER NOT NULL, \
            code TEXT NOT NULL, \
            stock INTEGER)",
    )
    .unwrap();
    db.execute(
        "INSERT INTO parts (id, code, stock) VALUES \
            (1, 'bolt',   40), \
            (2, 'washer', 12), \
            (3, 'nut',    NULL), \
            (4, 'clip',   7), \
            (5, 'pin',    NULL)",
    )
    .unwrap();
    db
}

/// The `id` column of every stored row, in stored order.
fn ids(db: &mut Database) -> Vec<String> {
    db.query("SELECT id FROM parts")
        .unwrap()
        .rows()
        .iter()
        .map(|row| row.values()[0].to_string())
        .collect()
}

fn deleted(db: &mut Database, sql: &str) -> usize {
    match db.execute(sql).unwrap() {
        Outcome::Deleted(n) => n,
        other => panic!("expected a delete outcome, got {:?}", other),
    }
}

#[test]
fn reports_the_rows_it_removed() {
    let mut db = seeded();
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE id = 2"), 1);
    assert_eq!(ids(&mut db), vec!["1", "3", "4", "5"]);
}

#[test]
fn without_a_where_it_empties_the_table() {
    let mut db = seeded();
    assert_eq!(deleted(&mut db, "DELETE FROM parts"), 5);
    assert!(db.query("SELECT id FROM parts").unwrap().is_empty());
    // The table itself is still there and still accepts rows.
    assert!(db.has_table("parts"));
    db.execute("INSERT INTO parts (id, code, stock) VALUES (9, 'new', 1)")
        .unwrap();
    assert_eq!(ids(&mut db), vec!["9"]);
}

#[test]
fn only_rows_where_the_predicate_is_true() {
    let mut db = seeded();
    // Rows 3 and 5 hold a NULL stock, where `stock < 20` is unknown.
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE stock < 20"), 2);
    assert_eq!(ids(&mut db), vec!["1", "3", "5"]);
}

#[test]
fn an_unknown_predicate_can_be_asked_for_directly() {
    let mut db = seeded();
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE stock IS NULL"), 2);
    assert_eq!(ids(&mut db), vec!["1", "2", "4"]);
}

#[test]
fn survivors_keep_their_stored_order() {
    let mut db = seeded();
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE id = 1 OR id = 3"), 2);
    assert_eq!(ids(&mut db), vec!["2", "4", "5"]);
    let codes: Vec<String> = db
        .query("SELECT code FROM parts")
        .unwrap()
        .rows()
        .iter()
        .map(|row| row.values()[0].to_string())
        .collect();
    assert_eq!(codes, vec!["washer", "clip", "pin"]);
}

#[test]
fn every_column_shrinks_together() {
    let mut db = seeded();
    deleted(&mut db, "DELETE FROM parts WHERE id = 2 OR id = 4");
    let rows: Vec<Vec<String>> = db
        .query("SELECT id, code, stock FROM parts")
        .unwrap()
        .rows()
        .iter()
        .map(|row| row.values().iter().map(|v| v.to_string()).collect())
        .collect();
    assert_eq!(
        rows,
        vec![
            vec!["1".to_string(), "bolt".to_string(), "40".to_string()],
            vec!["3".to_string(), "nut".to_string(), "NULL".to_string()],
            vec!["5".to_string(), "pin".to_string(), "NULL".to_string()],
        ]
    );
}

#[test]
fn a_predicate_that_matches_nothing_reports_zero() {
    let mut db = seeded();
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE id = 77"), 0);
    assert_eq!(ids(&mut db), vec!["1", "2", "3", "4", "5"]);
}

#[test]
fn deleting_from_an_empty_table_reports_zero() {
    let mut db = seeded();
    deleted(&mut db, "DELETE FROM parts");
    assert_eq!(deleted(&mut db, "DELETE FROM parts"), 0);
}

#[test]
fn aggregates_over_the_table_follow_the_removal() {
    let mut db = seeded();
    deleted(&mut db, "DELETE FROM parts WHERE id = 1");
    let count = db.query("SELECT COUNT(*) FROM parts").unwrap();
    assert_eq!(count.value(0, 0).unwrap().to_string(), "4");
    let total = db.query("SELECT SUM(stock) FROM parts").unwrap();
    assert_eq!(total.value(0, 0).unwrap().to_string(), "19");
}

#[test]
fn an_alias_qualifies_the_predicate_columns() {
    let mut db = seeded();
    assert_eq!(deleted(&mut db, "DELETE FROM parts AS p WHERE p.id > 3"), 2);
    assert_eq!(ids(&mut db), vec!["1", "2", "3"]);
}

#[test]
fn an_unknown_table_is_a_catalog_error() {
    let mut db = seeded();
    let err = db.execute("DELETE FROM widgets WHERE id = 1").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Catalog);
}

#[test]
fn an_unknown_column_is_a_binder_error() {
    let mut db = seeded();
    let err = db.execute("DELETE FROM parts WHERE colour = 'red'").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    assert_eq!(ids(&mut db), vec!["1", "2", "3", "4", "5"]);
}

#[test]
fn a_where_that_is_not_boolean_is_a_binder_error() {
    let mut db = seeded();
    let err = db.execute("DELETE FROM parts WHERE code").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn an_aggregate_has_no_place_in_a_delete() {
    let mut db = seeded();
    let err = db
        .execute("DELETE FROM parts WHERE stock > AVG(stock)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn the_table_is_named_after_from() {
    let mut db = seeded();
    // `DELETE parts` is not the accepted form.
    assert!(db.execute("DELETE parts WHERE id = 1").is_err());
    assert_eq!(ids(&mut db), vec!["1", "2", "3", "4", "5"]);
}

#[test]
fn a_delete_runs_inside_a_script() {
    let mut db = seeded();
    let outcomes = db
        .execute_script("DELETE FROM parts WHERE id = 5; DELETE FROM parts WHERE stock IS NULL")
        .unwrap();
    assert_eq!(outcomes[0], Outcome::Deleted(1));
    assert_eq!(outcomes[1], Outcome::Deleted(1));
    assert_eq!(ids(&mut db), vec!["1", "2", "4"]);
}

#[test]
fn a_compound_predicate_selects_the_rows() {
    let mut db = seeded();
    assert_eq!(
        deleted(
            &mut db,
            "DELETE FROM parts WHERE (id = 1 OR code = 'clip') AND stock > 5"
        ),
        2
    );
    assert_eq!(ids(&mut db), vec!["2", "3", "5"]);
}

#[test]
fn a_negated_predicate_still_needs_to_be_true() {
    let mut db = seeded();
    // NOT of unknown stays unknown, so the NULL rows survive again.
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE NOT stock < 20"), 1);
    assert_eq!(ids(&mut db), vec!["2", "3", "4", "5"]);
}

#[test]
fn deletes_can_follow_one_another() {
    let mut db = seeded();
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE id = 1"), 1);
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE id = 1"), 0);
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE id IN (2, 5)"), 2);
    assert_eq!(ids(&mut db), vec!["3", "4"]);
}

#[test]
fn rows_added_after_a_delete_sit_behind_the_survivors() {
    let mut db = seeded();
    deleted(&mut db, "DELETE FROM parts WHERE id < 4");
    db.execute("INSERT INTO parts (id, code, stock) VALUES (6, 'stud', 3)")
        .unwrap();
    assert_eq!(ids(&mut db), vec!["4", "5", "6"]);
}

#[test]
fn a_predicate_may_compare_two_columns() {
    let mut db = seeded();
    db.execute("INSERT INTO parts (id, code, stock) VALUES (7, 'cap', 7)")
        .unwrap();
    assert_eq!(deleted(&mut db, "DELETE FROM parts WHERE stock = id"), 1);
    assert_eq!(ids(&mut db), vec!["1", "2", "3", "4", "5"]);
}

#[test]
fn a_delete_leaves_other_tables_alone() {
    let mut db = seeded();
    db.execute("CREATE TABLE spares (id INTEGER NOT NULL)").unwrap();
    db.execute("INSERT INTO spares (id) VALUES (1), (2)").unwrap();
    deleted(&mut db, "DELETE FROM parts");
    let kept = db.query("SELECT id FROM spares").unwrap();
    assert_eq!(kept.row_count(), 2);
}
