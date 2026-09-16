//! Integration tests for chained joins across three tables.

mod common;

use tanager::Database;

fn schema_db() -> Database {
    let mut db = Database::new();
    db.execute("CREATE TABLE customers (id INTEGER, name TEXT, city_id INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE cities (id INTEGER, city TEXT, country_id INTEGER)")
        .unwrap();
    db.execute("CREATE TABLE countries (id INTEGER, country TEXT)")
        .unwrap();

    db.execute("INSERT INTO customers VALUES (1, 'Ada', 10), (2, 'Grace', 20), (3, 'Tim', 10)")
        .unwrap();
    db.execute("INSERT INTO cities VALUES (10, 'London', 100), (20, 'Paris', 200)")
        .unwrap();
    db.execute("INSERT INTO countries VALUES (100, 'UK'), (200, 'France')")
        .unwrap();
    db
}

fn rows(db: &mut Database, sql: &str) -> Vec<Vec<String>> {
    db.query(sql)
        .unwrap()
        .rows()
        .iter()
        .map(|r| r.values().iter().map(|v| v.to_string()).collect())
        .collect()
}

#[test]
fn three_way_join_resolves_qualified_columns() {
    let mut db = schema_db();
    let got = rows(
        &mut db,
        "SELECT cu.name, ci.city, co.country \
         FROM customers cu \
         JOIN cities ci ON cu.city_id = ci.id \
         JOIN countries co ON ci.country_id = co.id \
         ORDER BY cu.id",
    );
    assert_eq!(got[0], vec!["Ada", "London", "UK"]);
    assert_eq!(got[1], vec!["Grace", "Paris", "France"]);
    assert_eq!(got[2], vec!["Tim", "London", "UK"]);
}

#[test]
fn three_way_join_with_filter_and_aggregate() {
    let mut db = schema_db();
    let got = rows(
        &mut db,
        "SELECT co.country, COUNT(*) AS customers \
         FROM customers cu \
         JOIN cities ci ON cu.city_id = ci.id \
         JOIN countries co ON ci.country_id = co.id \
         GROUP BY co.country ORDER BY country",
    );
    assert_eq!(
        got,
        vec![
            vec!["France".to_string(), "1".to_string()],
            vec!["UK".to_string(), "2".to_string()],
        ]
    );
}

#[test]
fn filter_across_multiple_joined_tables() {
    let mut db = schema_db();
    let got = rows(
        &mut db,
        "SELECT cu.name FROM customers cu \
         JOIN cities ci ON cu.city_id = ci.id \
         JOIN countries co ON ci.country_id = co.id \
         WHERE co.country = 'UK' AND ci.city = 'London' \
         ORDER BY cu.id",
    );
    assert_eq!(got, vec![vec!["Ada"], vec!["Tim"]]);
}
