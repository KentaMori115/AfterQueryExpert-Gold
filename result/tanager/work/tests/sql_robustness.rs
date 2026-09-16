//! Integration tests for lexical robustness: casing, comments, and whitespace.

mod common;

use common::{scalar, seeded};

#[test]
fn keywords_are_case_insensitive() {
    let mut db = seeded();
    let a = scalar(&mut db, "SELECT COUNT(*) FROM employees");
    let b = scalar(&mut db, "select count(*) from employees");
    let c = scalar(&mut db, "SeLeCt CoUnT(*) FrOm employees");
    assert_eq!(a, b);
    assert_eq!(b, c);
}

#[test]
fn identifiers_are_case_insensitive() {
    let mut db = seeded();
    // Table and column names resolve regardless of case.
    let rows = common::query_strings(&mut db, "SELECT NAME FROM EMPLOYEES WHERE ID = 1");
    assert_eq!(rows, vec![vec!["Ada"]]);
}

#[test]
fn line_comments_are_ignored() {
    let mut db = seeded();
    let sql = "SELECT COUNT(*) -- count everyone\n FROM employees -- from the table\n";
    assert_eq!(scalar(&mut db, sql), "8");
}

#[test]
fn extra_whitespace_and_newlines() {
    let mut db = seeded();
    let sql = "SELECT\n\t COUNT(*)\n  FROM     employees\n\n WHERE  dept_id  =  1";
    assert_eq!(scalar(&mut db, sql), "3");
}

#[test]
fn trailing_semicolon_is_allowed() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT 1 + 1;"), "2");
}

#[test]
fn string_literals_are_case_preserving() {
    let mut db = seeded();
    // Keywords fold, but string contents do not.
    assert_eq!(scalar(&mut db, "select 'MixedCase'"), "MixedCase");
}
