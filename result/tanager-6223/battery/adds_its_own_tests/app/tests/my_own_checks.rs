use tanager::{Database, Outcome};

#[test]
fn update_reports_a_count() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (id INTEGER)").unwrap();
    db.execute("INSERT INTO t VALUES (1)").unwrap();
    assert_eq!(db.execute("UPDATE t SET id = 2").unwrap(), Outcome::Updated(1));
}
