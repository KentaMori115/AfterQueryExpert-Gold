//! Integration tests against the library parser API.
//! The parser's public surface is what embedders build on: the shapes asserted
//! here are part of the contract, not an implementation detail.

use tanager::ast::statement::{SelectItem, Statement};
use tanager::parser::{parse_program, parse_statement, tokenize};

#[test]
fn tokenizes_and_skips_comments() {
    // Line comments and extra whitespace should not affect the token stream.
    let with_comment = tokenize("SELECT 1 -- a comment\n + 2").unwrap();
    let without = tokenize("SELECT 1 + 2").unwrap();
    assert_eq!(with_comment.len(), without.len());
}

#[test]
fn parses_a_select_into_expected_shape() {
    let stmt = parse_statement("SELECT a, b AS bee FROM t WHERE a > 1").unwrap();
    match stmt {
        Statement::Select(s) => {
            assert_eq!(s.projection.len(), 2);
            match &s.projection[1] {
                SelectItem::Expr { alias, .. } => assert_eq!(alias.as_deref(), Some("bee")),
                _ => panic!("expected aliased expr"),
            }
            assert!(s.selection.is_some());
            assert!(s.from.is_some());
        }
        _ => panic!("expected a SELECT"),
    }
}

#[test]
fn parses_multiple_statements() {
    let stmts =
        parse_program("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1); SELECT a FROM t;")
            .unwrap();
    assert_eq!(stmts.len(), 3);
    assert!(matches!(stmts[0], Statement::CreateTable(_)));
    assert!(matches!(stmts[1], Statement::Insert(_)));
    assert!(matches!(stmts[2], Statement::Select(_)));
}

#[test]
fn rejects_incomplete_statement() {
    assert!(parse_statement("SELECT").is_err());
    assert!(parse_statement("SELECT * FROM").is_err());
    assert!(parse_statement("INSERT INTO t").is_err());
}

#[test]
fn string_literals_keep_escaped_quotes() {
    let stmt = parse_statement("SELECT 'it''s fine'").unwrap();
    match stmt {
        Statement::Select(s) => match &s.projection[0] {
            SelectItem::Expr { expr, .. } => {
                assert!(format!("{:?}", expr).contains("it's fine"));
            }
            _ => panic!(),
        },
        _ => panic!(),
    }
}

#[test]
fn explain_parses_to_explain_statement() {
    let stmt = parse_statement("EXPLAIN SELECT a FROM t").unwrap();
    assert!(matches!(stmt, Statement::Explain(_)));
}
