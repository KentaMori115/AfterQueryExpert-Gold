//! Integration tests for LIKE, IN, and BETWEEN predicates.

mod common;

use common::{query_strings, scalar, seeded};

#[test]
fn like_percent_matches_any_run() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT name FROM employees WHERE name LIKE 'A%' ORDER BY name",
    );
    assert_eq!(rows, vec![vec!["Ada"]]);
}

#[test]
fn like_underscore_matches_single_char() {
    let mut db = seeded();
    // Exactly three-letter names: Ada, Ken, Tim.
    let rows = query_strings(
        &mut db,
        "SELECT name FROM employees WHERE name LIKE '___' ORDER BY name",
    );
    assert_eq!(rows, vec![vec!["Ada"], vec!["Ken"], vec!["Tim"]]);
}

#[test]
fn not_like() {
    let mut db = seeded();
    let all = scalar(&mut db, "SELECT COUNT(*) FROM employees");
    let not_a = scalar(
        &mut db,
        "SELECT COUNT(*) FROM employees WHERE name NOT LIKE 'A%'",
    );
    assert_eq!(all, "8");
    assert_eq!(not_a, "7");
}

#[test]
fn like_matches_literal_middle() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT name FROM employees WHERE name LIKE '%ar%' ORDER BY name",
    );
    // Barbara, Margaret
    assert_eq!(rows, vec![vec!["Barbara"], vec!["Margaret"]]);
}

#[test]
fn in_list_of_text() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT id FROM employees WHERE name IN ('Ada', 'Ken', 'nobody') ORDER BY id",
    );
    assert_eq!(rows, vec![vec!["1"], vec!["6"]]);
}

#[test]
fn not_in_list() {
    let mut db = seeded();
    let count = scalar(
        &mut db,
        "SELECT COUNT(*) FROM employees WHERE dept_id NOT IN (1, 2)",
    );
    // dept 3 (Ken, Barbara); Tim's NULL dept is unknown, excluded.
    assert_eq!(count, "2");
}

#[test]
fn between_is_inclusive() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT id FROM employees WHERE salary BETWEEN 140000 AND 160000 ORDER BY salary",
    );
    // 140000 Linus, 145000 Ken, 150000 Grace, 160000 Ada
    assert_eq!(rows.len(), 4);
}

#[test]
fn not_between() {
    let mut db = seeded();
    let count = scalar(
        &mut db,
        "SELECT COUNT(*) FROM employees WHERE salary NOT BETWEEN 100000 AND 200000",
    );
    // Only Tim (90000) falls outside.
    assert_eq!(count, "1");
}
