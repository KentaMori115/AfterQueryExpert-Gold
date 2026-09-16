//! Integration tests that drive the compiled `tanager` binary.

use std::process::Command;

/// Path to the binary under test, provided by Cargo.
fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_tanager")
}

fn run(args: &[&str]) -> (String, String, bool) {
    let output = Command::new(bin())
        .args(args)
        .output()
        .expect("failed to run tanager binary");
    (
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
        output.status.success(),
    )
}

#[test]
fn runs_a_script_from_arguments() {
    let (stdout, _stderr, ok) = run(&["CREATE TABLE t (id INTEGER, name TEXT); \
         INSERT INTO t VALUES (1, 'ada'), (2, 'grace'); \
         SELECT name FROM t ORDER BY id DESC"]);
    assert!(ok);
    assert!(stdout.contains("CREATE TABLE t"));
    assert!(stdout.contains("INSERT 2"));
    // grace (id 2) comes before ada (id 1) under DESC.
    let grace = stdout.find("grace").unwrap();
    let ada = stdout.find("ada").unwrap();
    assert!(grace < ada, "output was:\n{}", stdout);
}

#[test]
fn reports_row_count() {
    let (stdout, _stderr, ok) = run(&["SELECT 1 + 1 AS answer"]);
    assert!(ok);
    assert!(stdout.contains("answer"));
    assert!(stdout.contains('2'));
    assert!(stdout.trim_end().ends_with("(1 row)"));
}

#[test]
fn exits_nonzero_on_error() {
    let (_stdout, stderr, ok) = run(&["SELECT * FROM does_not_exist"]);
    assert!(!ok);
    assert!(stderr.contains("error"));
}
