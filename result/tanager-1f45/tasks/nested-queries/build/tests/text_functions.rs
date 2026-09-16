//! Integration tests focused on text-processing functions over table columns.

mod common;

use common::{query_strings, scalar, seeded};

#[test]
fn upper_lower_over_column() {
    let mut db = seeded();
    let rows = query_strings(&mut db, "SELECT UPPER(name) FROM employees WHERE id = 1");
    assert_eq!(rows, vec![vec!["ADA"]]);
    let rows = query_strings(&mut db, "SELECT LOWER(name) FROM employees WHERE id = 6");
    assert_eq!(rows, vec![vec!["ken"]]);
}

#[test]
fn length_and_substr_over_column() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT name, LENGTH(name) AS n, SUBSTR(name, 1, 3) AS abbr \
         FROM employees WHERE id = 7",
    );
    // Barbara -> length 7, first three chars 'Bar'
    assert_eq!(rows, vec![vec!["Barbara", "7", "Bar"]]);
}

#[test]
fn concat_builds_labels() {
    let mut db = seeded();
    let rows = query_strings(
        &mut db,
        "SELECT CONCAT(name, ' #', CAST(id AS TEXT)) FROM employees WHERE id = 2",
    );
    assert_eq!(rows, vec![vec!["Grace #2"]]);
}

#[test]
fn replace_and_reverse() {
    let mut db = seeded();
    assert_eq!(
        scalar(&mut db, "SELECT REPLACE('a.b.c', '.', '/')"),
        "a/b/c"
    );
    assert_eq!(scalar(&mut db, "SELECT REVERSE('stressed')"), "desserts");
}

#[test]
fn instr_over_column() {
    let mut db = seeded();
    // Position of 'a' in each dept-1 name.
    let rows = query_strings(
        &mut db,
        "SELECT name, INSTR(name, 'a') AS pos FROM employees WHERE dept_id = 1 ORDER BY id",
    );
    // INSTR is case-sensitive: 'A' != 'a', so the match is the trailing 'a'.
    assert_eq!(rows[0], vec!["Ada", "3"]);
    assert_eq!(rows[1], vec!["Grace", "3"]);
    assert_eq!(rows[2], vec!["Linus", "0"]); // no lowercase 'a'
}

#[test]
fn trim_variants() {
    let mut db = seeded();
    assert_eq!(scalar(&mut db, "SELECT TRIM('  hi  ')"), "hi");
    assert_eq!(
        scalar(&mut db, "SELECT '[' || LTRIM('  hi  ') || ']'"),
        "[hi  ]"
    );
    assert_eq!(
        scalar(&mut db, "SELECT '[' || RTRIM('  hi  ') || ']'"),
        "[  hi]"
    );
}
