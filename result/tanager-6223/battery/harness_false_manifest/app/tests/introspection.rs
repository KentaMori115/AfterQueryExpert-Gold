//! Integration tests for catalog introspection on the Database API.

mod common;

use common::seeded;
use tanager::Database;

#[test]
fn lists_tables_in_sorted_order() {
    let db = seeded();
    assert_eq!(db.table_names(), vec!["departments", "employees"]);
}

#[test]
fn has_table_is_case_insensitive() {
    let db = seeded();
    assert!(db.has_table("EMPLOYEES"));
    assert!(db.has_table("departments"));
    assert!(!db.has_table("missing"));
}

#[test]
fn drop_updates_introspection() {
    let mut db = seeded();
    db.execute("DROP TABLE employees").unwrap();
    assert!(!db.has_table("employees"));
    assert_eq!(db.table_names(), vec!["departments"]);
}

#[test]
fn result_schema_exposes_column_types() {
    let mut db = Database::new();
    db.execute("CREATE TABLE t (id INTEGER, label TEXT, score FLOAT)")
        .unwrap();
    db.execute("INSERT INTO t VALUES (1, 'a', 2.5)").unwrap();
    let result = db.query("SELECT id, label, score FROM t").unwrap();
    let types: Vec<String> = result
        .schema()
        .fields()
        .iter()
        .map(|f| f.data_type().to_string())
        .collect();
    assert_eq!(types, vec!["INTEGER", "TEXT", "FLOAT"]);
}
