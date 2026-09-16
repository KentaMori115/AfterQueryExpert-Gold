//! Shared helpers for the integration tests.
#![allow(dead_code)]

use tanager::{Database, QueryResult, Value};

/// A database seeded with a small employees/departments dataset used across the
/// integration tests.
pub fn seeded() -> Database {
    let mut db = Database::new();
    db.execute(
        "CREATE TABLE departments (id INTEGER NOT NULL, name TEXT NOT NULL, budget INTEGER)",
    )
    .unwrap();
    db.execute(
        "CREATE TABLE employees (\
            id INTEGER NOT NULL, \
            name TEXT NOT NULL, \
            dept_id INTEGER, \
            salary INTEGER, \
            manager_id INTEGER)",
    )
    .unwrap();

    db.execute(
        "INSERT INTO departments (id, name, budget) VALUES \
            (1, 'Engineering', 1000000), \
            (2, 'Sales', 500000), \
            (3, 'Research', 750000), \
            (4, 'Facilities', NULL)",
    )
    .unwrap();

    db.execute(
        "INSERT INTO employees (id, name, dept_id, salary, manager_id) VALUES \
            (1, 'Ada',      1, 160000, NULL), \
            (2, 'Grace',    1, 150000, 1), \
            (3, 'Linus',    1, 140000, 1), \
            (4, 'Margaret', 2, 120000, NULL), \
            (5, 'Dennis',   2, 130000, 4), \
            (6, 'Ken',      3, 145000, NULL), \
            (7, 'Barbara',  3, 135000, 6), \
            (8, 'Tim',      NULL, 90000, NULL)",
    )
    .unwrap();

    db
}

/// Run a query and return its rows as vectors of stringified cell values.
pub fn rows_as_strings(result: &QueryResult) -> Vec<Vec<String>> {
    result
        .rows()
        .iter()
        .map(|row| row.values().iter().map(|v| v.to_string()).collect())
        .collect()
}

/// Convenience: run `sql` against `db` and return stringified rows.
pub fn query_strings(db: &mut Database, sql: &str) -> Vec<Vec<String>> {
    let result = db.query(sql).unwrap();
    rows_as_strings(&result)
}

/// Extract a single scalar cell (row 0, column 0) as a string.
pub fn scalar(db: &mut Database, sql: &str) -> String {
    db.query(sql).unwrap().value(0, 0).unwrap().to_string()
}

/// Assert two integer values are equal, unwrapping through the Value.
pub fn assert_int(value: &Value, expected: i64) {
    assert_eq!(value, &Value::Integer(expected), "value mismatch");
}
