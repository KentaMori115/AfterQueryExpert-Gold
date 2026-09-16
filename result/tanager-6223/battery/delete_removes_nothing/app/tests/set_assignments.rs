//! `UPDATE`: which rows it touches, what the assignments read, what it reports,
//! and what it leaves behind when a row cannot be stored.

use tanager::{Database, ErrorKind, Outcome};

/// A table whose columns cover every rule an assignment has to respect: a
/// `NOT NULL` key, a nullable integer, a float that an integer widens into, and
/// text.
fn seeded() -> Database {
    let mut db = Database::new();
    db.execute(
        "CREATE TABLE parts (\
            id INTEGER NOT NULL, \
            code TEXT NOT NULL, \
            stock INTEGER, \
            spare INTEGER, \
            weight FLOAT)",
    )
    .unwrap();
    db.execute(
        "INSERT INTO parts (id, code, stock, spare, weight) VALUES \
            (1, 'bolt',   40,   5, 8.0), \
            (2, 'washer', 12,   6, 1.5), \
            (3, 'nut',    NULL, 7, 2.0), \
            (4, 'clip',   7,    8, 0.5)",
    )
    .unwrap();
    db
}

/// Every stored row, as strings, in stored order.
fn dump(db: &mut Database) -> Vec<Vec<String>> {
    let result = db
        .query("SELECT id, code, stock, spare, weight FROM parts")
        .unwrap();
    result
        .rows()
        .iter()
        .map(|row| row.values().iter().map(|v| v.to_string()).collect())
        .collect()
}

/// One cell of the row carrying `id`.
fn cell(db: &mut Database, id: i64, column: &str) -> String {
    let sql = format!("SELECT {} FROM parts WHERE id = {}", column, id);
    db.query(&sql).unwrap().value(0, 0).unwrap().to_string()
}

fn updated(db: &mut Database, sql: &str) -> usize {
    match db.execute(sql).unwrap() {
        Outcome::Updated(n) => n,
        other => panic!("expected an update outcome, got {:?}", other),
    }
}

#[test]
fn reports_the_rows_it_changed() {
    let mut db = seeded();
    assert_eq!(updated(&mut db, "UPDATE parts SET stock = 99 WHERE id = 2"), 1);
    assert_eq!(cell(&mut db, 2, "stock"), "99");
    assert_eq!(cell(&mut db, 1, "stock"), "40");
}

#[test]
fn without_a_where_it_takes_every_row() {
    let mut db = seeded();
    assert_eq!(updated(&mut db, "UPDATE parts SET code = 'x'"), 4);
    let codes: Vec<String> = dump(&mut db).into_iter().map(|r| r[1].clone()).collect();
    assert_eq!(codes, vec!["x", "x", "x", "x"]);
}

#[test]
fn assignments_read_the_row_as_it_was() {
    let mut db = seeded();
    // Two columns exchange values in one statement.
    assert_eq!(
        updated(
            &mut db,
            "UPDATE parts SET stock = spare, spare = stock WHERE id = 1"
        ),
        1
    );
    assert_eq!(cell(&mut db, 1, "stock"), "5");
    assert_eq!(cell(&mut db, 1, "spare"), "40");
}

#[test]
fn one_assignment_cannot_see_another() {
    let mut db = seeded();
    // `stock` is set to 500 here, but the second assignment still reads 12.
    assert_eq!(
        updated(
            &mut db,
            "UPDATE parts SET stock = 500, weight = stock WHERE id = 2"
        ),
        1
    );
    assert_eq!(cell(&mut db, 2, "stock"), "500");
    assert_eq!(cell(&mut db, 2, "weight"), "12.0");
}

#[test]
fn only_rows_where_the_predicate_is_true() {
    let mut db = seeded();
    // Row 3 holds a NULL stock, so `stock > 10` is unknown there.
    assert_eq!(updated(&mut db, "UPDATE parts SET code = 'hit' WHERE stock > 10"), 2);
    let codes: Vec<String> = dump(&mut db).into_iter().map(|r| r[1].clone()).collect();
    assert_eq!(codes, vec!["hit", "hit", "nut", "clip"]);
}

#[test]
fn a_false_predicate_changes_nothing() {
    let mut db = seeded();
    assert_eq!(updated(&mut db, "UPDATE parts SET code = 'no' WHERE id > 900"), 0);
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn an_integer_widens_into_a_float_column() {
    let mut db = seeded();
    assert_eq!(updated(&mut db, "UPDATE parts SET weight = 6 WHERE id = 4"), 1);
    assert_eq!(cell(&mut db, 4, "weight"), "6.0");
}

#[test]
fn a_row_that_comes_out_identical_is_not_counted() {
    let mut db = seeded();
    // Row 1 already weighs 8.0, and 8 widens to exactly that.
    assert_eq!(updated(&mut db, "UPDATE parts SET weight = 8 WHERE id = 1"), 0);
    assert_eq!(cell(&mut db, 1, "weight"), "8.0");
}

#[test]
fn a_null_written_over_a_null_is_not_a_change() {
    let mut db = seeded();
    assert_eq!(updated(&mut db, "UPDATE parts SET stock = NULL WHERE id = 3"), 0);
    assert_eq!(cell(&mut db, 3, "stock"), "NULL");
    // The same assignment on a row holding a value does count.
    assert_eq!(updated(&mut db, "UPDATE parts SET stock = NULL WHERE id = 4"), 1);
    assert_eq!(cell(&mut db, 4, "stock"), "NULL");
}

#[test]
fn a_mixed_statement_counts_only_the_rows_that_moved() {
    let mut db = seeded();
    // Every row matches; rows 1 and 3 already hold what is assigned.
    let n = updated(
        &mut db,
        "UPDATE parts SET weight = CASE id WHEN 1 THEN 8.0 WHEN 3 THEN 2.0 ELSE 100.0 END",
    );
    assert_eq!(n, 2);
    let weights: Vec<String> = dump(&mut db).into_iter().map(|r| r[4].clone()).collect();
    assert_eq!(weights, vec!["8.0", "100.0", "2.0", "100.0"]);
}

#[test]
fn changed_rows_stay_where_they_were() {
    let mut db = seeded();
    updated(&mut db, "UPDATE parts SET code = 'z' WHERE id = 1");
    let ids: Vec<String> = dump(&mut db).into_iter().map(|r| r[0].clone()).collect();
    assert_eq!(ids, vec!["1", "2", "3", "4"]);
}

#[test]
fn a_narrowing_value_is_a_type_error() {
    let mut db = seeded();
    let err = db.execute("UPDATE parts SET stock = 1.5").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Type);
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn text_cannot_be_stored_in_an_integer_column() {
    let mut db = seeded();
    let err = db.execute("UPDATE parts SET stock = 'many'").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Type);
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn a_null_into_a_not_null_column_rejects_the_statement() {
    let mut db = seeded();
    assert!(db.execute("UPDATE parts SET code = NULL WHERE id = 2").is_err());
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn a_computed_null_is_caught_the_same_way() {
    let mut db = seeded();
    // Concatenating NULL yields NULL, which `code` refuses.
    assert!(db
        .execute("UPDATE parts SET code = code || NULL WHERE id = 1")
        .is_err());
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn one_bad_row_holds_back_the_good_ones() {
    let mut db = seeded();
    // Rows 1, 2 and 4 would store fine; row 3 has a NULL stock, which turns
    // into a NULL code and is refused.
    assert!(db
        .execute("UPDATE parts SET code = CASE WHEN stock IS NULL THEN NULL ELSE 'ok' END")
        .is_err());
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn a_value_that_cannot_be_computed_leaves_the_table_alone() {
    let mut db = seeded();
    assert!(db.execute("UPDATE parts SET stock = stock / 0").is_err());
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn assigning_one_column_twice_is_rejected() {
    let mut db = seeded();
    let err = db
        .execute("UPDATE parts SET stock = 1, stock = 2 WHERE id = 1")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    assert_eq!(dump(&mut db), dump(&mut seeded()));
}

#[test]
fn an_unknown_column_is_a_binder_error() {
    let mut db = seeded();
    let err = db.execute("UPDATE parts SET colour = 'red'").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    let err = db.execute("UPDATE parts SET stock = 1 WHERE colour = 'red'").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn an_unknown_table_is_a_catalog_error() {
    let mut db = seeded();
    let err = db.execute("UPDATE widgets SET stock = 1").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Catalog);
}

#[test]
fn a_where_that_is_not_boolean_is_a_binder_error() {
    let mut db = seeded();
    let err = db.execute("UPDATE parts SET stock = 1 WHERE stock").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn an_aggregate_has_no_place_in_an_update() {
    let mut db = seeded();
    let err = db.execute("UPDATE parts SET stock = SUM(stock)").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
    let err = db
        .execute("UPDATE parts SET stock = 1 WHERE stock > AVG(stock)")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn an_alias_qualifies_the_columns() {
    let mut db = seeded();
    assert_eq!(
        updated(
            &mut db,
            "UPDATE parts AS p SET stock = p.stock + 1 WHERE p.id = 4"
        ),
        1
    );
    assert_eq!(cell(&mut db, 4, "stock"), "8");
}

#[test]
fn several_matched_rows_change_together() {
    let mut db = seeded();
    assert_eq!(
        updated(&mut db, "UPDATE parts SET stock = 0 WHERE id < 4"),
        3
    );
    let stocks: Vec<String> = dump(&mut db).into_iter().map(|r| r[2].clone()).collect();
    assert_eq!(stocks, vec!["0", "0", "0", "7"]);
}

#[test]
fn an_assignment_may_read_several_columns() {
    let mut db = seeded();
    assert_eq!(
        updated(
            &mut db,
            "UPDATE parts SET stock = stock + spare, code = code || '-x' WHERE id = 2"
        ),
        1
    );
    assert_eq!(cell(&mut db, 2, "stock"), "18");
    assert_eq!(cell(&mut db, 2, "code"), "washer-x");
}

#[test]
fn the_not_null_column_can_be_written_too() {
    let mut db = seeded();
    assert_eq!(updated(&mut db, "UPDATE parts SET id = id + 100"), 4);
    let ids: Vec<String> = dump(&mut db).into_iter().map(|r| r[0].clone()).collect();
    assert_eq!(ids, vec!["101", "102", "103", "104"]);
}

#[test]
fn a_widened_value_that_differs_does_count() {
    let mut db = seeded();
    // 2 widens to 2.0, which row 4 does not already hold.
    assert_eq!(updated(&mut db, "UPDATE parts SET weight = 2 WHERE id = 4"), 1);
    assert_eq!(cell(&mut db, 4, "weight"), "2.0");
}

#[test]
fn a_null_predicate_column_keeps_its_row_out_of_every_form() {
    let mut db = seeded();
    // Row 3 has a NULL stock, so none of these three reach it.
    assert_eq!(updated(&mut db, "UPDATE parts SET code = 'a' WHERE stock = 0"), 0);
    assert_eq!(updated(&mut db, "UPDATE parts SET code = 'b' WHERE NOT stock = 0"), 3);
    assert_eq!(
        updated(&mut db, "UPDATE parts SET code = 'c' WHERE stock > 0 AND id > 0"),
        3
    );
    assert_eq!(cell(&mut db, 3, "code"), "nut");
}

#[test]
fn a_statement_that_fails_reports_nothing_at_all() {
    let mut db = seeded();
    // The count belongs to a statement that ran; this one did not.
    let before = dump(&mut db);
    assert!(db.execute("UPDATE parts SET id = NULL WHERE id = 1").is_err());
    assert!(db.execute("UPDATE parts SET stock = 'x' WHERE id = 1").is_err());
    assert!(db.execute("UPDATE parts SET nope = 1").is_err());
    assert_eq!(dump(&mut db), before);
}

#[test]
fn an_update_touches_only_its_own_table() {
    let mut db = seeded();
    db.execute("CREATE TABLE spares (id INTEGER NOT NULL, stock INTEGER)")
        .unwrap();
    db.execute("INSERT INTO spares (id, stock) VALUES (1, 3), (2, 4)")
        .unwrap();
    assert_eq!(updated(&mut db, "UPDATE parts SET stock = 1"), 4);
    let kept: Vec<String> = db
        .query("SELECT stock FROM spares")
        .unwrap()
        .rows()
        .iter()
        .map(|row| row.values()[0].to_string())
        .collect();
    assert_eq!(kept, vec!["3", "4"]);
}

#[test]
fn an_update_runs_inside_a_script() {
    let mut db = seeded();
    let outcomes = db
        .execute_script("UPDATE parts SET stock = 5 WHERE id = 1; UPDATE parts SET stock = 5 WHERE id = 1")
        .unwrap();
    assert_eq!(outcomes[0], Outcome::Updated(1));
    // The second statement finds the value already there.
    assert_eq!(outcomes[1], Outcome::Updated(0));
}
