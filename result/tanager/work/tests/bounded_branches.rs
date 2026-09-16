//! The clauses that close a query — `ORDER BY`, `LIMIT`, `OFFSET` — and what
//! the optimizer is allowed to do with a limit that sits over a concatenation.

use tanager::ast::statement::Statement;
use tanager::optimizer::Optimizer;
use tanager::parser::parse_statement;
use tanager::planner::logical::LogicalPlan;
use tanager::planner::Binder;
use tanager::{Database, ErrorKind};

/// Two tables of four and three rows, with one value in common.
fn seeded() -> Database {
    let mut db = Database::new();
    db.execute("CREATE TABLE early (mark INTEGER, label TEXT)")
        .unwrap();
    db.execute("CREATE TABLE late (mark INTEGER, label TEXT)")
        .unwrap();
    db.execute("CREATE TABLE spare (mark INTEGER, label TEXT)")
        .unwrap();
    db.execute(
        "INSERT INTO early (mark, label) VALUES \
            (10, 'a'), (30, 'b'), (20, 'c'), (40, 'd')",
    )
    .unwrap();
    db.execute("INSERT INTO late (mark, label) VALUES (50, 'e'), (20, 'f'), (60, 'g')")
        .unwrap();
    db.execute("INSERT INTO spare (mark, label) VALUES (70, 'h'), (80, 'i')")
        .unwrap();
    db
}

fn column(db: &mut Database, sql: &str) -> Vec<String> {
    db.query(sql)
        .unwrap()
        .rows()
        .iter()
        .map(|row| row.get(0).unwrap().to_string())
        .collect()
}

/// Bind and optimize `sql` against the database's catalog.
fn optimized(db: &Database, sql: &str) -> LogicalPlan {
    let select = match parse_statement(sql).unwrap() {
        Statement::Select(s) => s,
        other => panic!("expected a query, got {:?}", other),
    };
    let plan = Binder::new(db.catalog()).bind_select(&select).unwrap();
    Optimizer::new().optimize(plan).unwrap()
}

/// The detail line of every node in the plan, parents before children.
fn details(plan: &LogicalPlan) -> Vec<String> {
    let mut out = vec![plan.detail()];
    for child in plan.children() {
        out.extend(details(child));
    }
    out
}

/// The branches of the node that combines two inputs. These queries read two
/// tables and never join them, so the plan holds exactly one such node,
/// wherever a build chooses to put it.
fn branches(plan: &LogicalPlan) -> Vec<&LogicalPlan> {
    if plan.children().len() == 2 {
        return plan.children();
    }
    for child in plan.children() {
        let found = branches(child);
        if !found.is_empty() {
            return found;
        }
    }
    Vec::new()
}

/// The same, insisting the query really did combine two branches.
fn two_branches(plan: &LogicalPlan) -> Vec<&LogicalPlan> {
    let found = branches(plan);
    assert_eq!(
        found.len(),
        2,
        "no node combining two inputs in: {}",
        plan.explain()
    );
    found
}

#[test]
fn order_by_sorts_the_whole_result() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early UNION ALL SELECT mark FROM late ORDER BY mark"
        ),
        vec!["10", "20", "20", "30", "40", "50", "60"]
    );
}

#[test]
fn order_by_a_position_picks_a_result_column() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark, label FROM early UNION SELECT mark, label FROM late \
             ORDER BY 1 DESC"
        ),
        vec!["60", "50", "40", "30", "20", "20", "10"]
    );
}

#[test]
fn order_by_uses_the_leftmost_branch_names() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark AS score FROM early UNION SELECT mark FROM late \
             ORDER BY score DESC"
        ),
        vec!["60", "50", "40", "30", "20", "10"]
    );
}

#[test]
fn order_by_a_column_outside_the_result_is_rejected() {
    let mut db = seeded();
    let err = db
        .query("SELECT mark FROM early UNION SELECT mark FROM late ORDER BY label")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Binder);
}

#[test]
fn limit_cuts_the_combined_result() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early UNION ALL SELECT mark FROM late LIMIT 2"
        ),
        vec!["10", "30"]
    );
}

#[test]
fn offset_skips_into_the_second_branch() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early UNION ALL SELECT mark FROM late OFFSET 4"
        ),
        vec!["50", "20", "60"]
    );
}

#[test]
fn a_limit_after_an_offset_spans_both_branches() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early UNION ALL SELECT mark FROM late \
             LIMIT 3 OFFSET 3"
        ),
        vec!["40", "50", "20"]
    );
}

#[test]
fn a_limit_reaching_past_the_first_branch_still_reads_the_second() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early UNION ALL SELECT mark FROM late \
             LIMIT 2 OFFSET 5"
        ),
        vec!["20", "60"]
    );
}

#[test]
fn order_by_before_the_last_branch_is_rejected() {
    let mut db = seeded();
    // The same two branches read fine with the clause in its proper place.
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early UNION SELECT mark FROM late ORDER BY mark",
        ),
        vec!["10", "20", "30", "40", "50", "60"]
    );
    let err = db
        .query("SELECT mark FROM early ORDER BY mark UNION SELECT mark FROM late")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Parse);
}

#[test]
fn limit_before_the_last_branch_is_rejected() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early UNION SELECT mark FROM late LIMIT 2",
        ),
        vec!["10", "30"]
    );
    let err = db
        .query("SELECT mark FROM early LIMIT 2 UNION SELECT mark FROM late")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Parse);
}

#[test]
fn offset_before_the_last_branch_is_rejected() {
    let mut db = seeded();
    assert_eq!(
        column(
            &mut db,
            "SELECT mark FROM early EXCEPT SELECT mark FROM late OFFSET 1",
        ),
        vec!["30", "40"]
    );
    let err = db
        .query("SELECT mark FROM early OFFSET 1 EXCEPT SELECT mark FROM late")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Parse);
}

#[test]
fn explain_reports_the_operator_as_written() {
    let mut db = seeded();
    for (sql, expected) in [
        (
            "SELECT mark FROM early UNION SELECT mark FROM late",
            "UNION",
        ),
        (
            "SELECT mark FROM early UNION ALL SELECT mark FROM late",
            "UNION ALL",
        ),
        (
            "SELECT mark FROM early INTERSECT SELECT mark FROM late",
            "INTERSECT",
        ),
        (
            "SELECT mark FROM early INTERSECT ALL SELECT mark FROM late",
            "INTERSECT ALL",
        ),
        (
            "SELECT mark FROM early EXCEPT SELECT mark FROM late",
            "EXCEPT",
        ),
        (
            "SELECT mark FROM early EXCEPT ALL SELECT mark FROM late",
            "EXCEPT ALL",
        ),
    ] {
        let lines: Vec<String> = db
            .query(&format!("EXPLAIN {}", sql))
            .unwrap()
            .rows()
            .iter()
            .map(|r| r.get(0).unwrap().to_string().trim().to_string())
            .collect();
        // The line is the operator as written; a build may add its own detail
        // in brackets after it.
        let opening = format!("{} (", expected);
        assert!(
            lines
                .iter()
                .any(|line| line == expected || line.starts_with(&opening)),
            "expected a `{}` line for `{}`, got {:?}",
            expected,
            sql,
            lines
        );
    }
}

#[test]
fn a_concatenation_bounds_both_of_its_branches() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late LIMIT 3",
    );
    for branch in two_branches(&plan) {
        assert!(
            details(branch).iter().any(|d| d == "Limit 3"),
            "branch was not bounded: {:?}",
            details(branch)
        );
    }
}

#[test]
fn the_bound_is_the_limit_plus_the_offset() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late LIMIT 3 OFFSET 2",
    );
    for branch in two_branches(&plan) {
        assert!(
            details(branch).iter().any(|d| d == "Limit 5"),
            "branch carries the wrong bound: {:?}",
            details(branch)
        );
    }
}

#[test]
fn the_outer_limit_stays_where_it_was() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late LIMIT 3 OFFSET 2",
    );
    assert_eq!(plan.detail(), "Limit 3 Offset 2");
}

#[test]
fn a_branch_is_bounded_only_once() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late LIMIT 3 OFFSET 2",
    );
    let bounds = details(&plan)
        .into_iter()
        .filter(|d| d == "Limit 5")
        .count();
    assert_eq!(bounds, 2, "plan was: {}", plan.explain());
}

#[test]
fn a_deduplicating_union_leaves_its_branches_alone() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION SELECT mark FROM late LIMIT 3",
    );
    for branch in two_branches(&plan) {
        assert!(
            !details(branch).iter().any(|d| d.starts_with("Limit")),
            "branch was bounded: {:?}",
            details(branch)
        );
    }
}

#[test]
fn an_intersection_leaves_its_branches_alone() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early INTERSECT ALL SELECT mark FROM late LIMIT 3",
    );
    for branch in two_branches(&plan) {
        assert!(
            !details(branch).iter().any(|d| d.starts_with("Limit")),
            "branch was bounded: {:?}",
            details(branch)
        );
    }
}

#[test]
fn a_difference_leaves_its_branches_alone() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early EXCEPT ALL SELECT mark FROM late LIMIT 3",
    );
    for branch in two_branches(&plan) {
        assert!(
            !details(branch).iter().any(|d| d.starts_with("Limit")),
            "branch was bounded: {:?}",
            details(branch)
        );
    }
}

#[test]
fn an_offset_with_no_limit_bounds_nothing() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late OFFSET 2",
    );
    for branch in two_branches(&plan) {
        assert!(
            !details(branch).iter().any(|d| d.starts_with("Limit")),
            "branch was bounded: {:?}",
            details(branch)
        );
    }
}

#[test]
fn a_sort_between_the_limit_and_the_branches_blocks_the_bound() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late ORDER BY mark LIMIT 3",
    );
    // The only limit in the plan is the one the query wrote.
    let bounds = details(&plan)
        .into_iter()
        .filter(|d| d.starts_with("Limit"))
        .count();
    assert_eq!(bounds, 1, "plan was: {}", plan.explain());
}

#[test]
fn every_branch_of_a_chain_is_bounded() {
    let db = seeded();
    let plan = optimized(
        &db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late \
         UNION ALL SELECT mark FROM spare LIMIT 2 OFFSET 1",
    );
    let scans = bounded_scans(&plan, false, "Limit 3");
    assert_eq!(
        scans,
        vec![
            ("Scan early".to_string(), true),
            ("Scan late".to_string(), true),
            ("Scan spare".to_string(), true)
        ],
        "plan was: {}",
        plan.explain()
    );
}

/// Every table read in the plan, paired with whether some node above it
/// carries `bound`.
fn bounded_scans(plan: &LogicalPlan, above: bool, bound: &str) -> Vec<(String, bool)> {
    let detail = plan.detail();
    if detail.starts_with("Scan ") {
        return vec![(detail, above)];
    }
    let above = above || detail == bound;
    let mut out = Vec::new();
    for child in plan.children() {
        out.extend(bounded_scans(child, above, bound));
    }
    out
}

#[test]
fn bounding_the_branches_does_not_move_a_row() {
    let mut db = seeded();
    let whole = column(
        &mut db,
        "SELECT mark FROM early UNION ALL SELECT mark FROM late",
    );
    for offset in 0..whole.len() {
        for limit in 1..4 {
            let sql = format!(
                "SELECT mark FROM early UNION ALL SELECT mark FROM late \
                 LIMIT {} OFFSET {}",
                limit, offset
            );
            let expected: Vec<String> = whole.iter().skip(offset).take(limit).cloned().collect();
            assert_eq!(column(&mut db, &sql), expected, "for {}", sql);
        }
    }
}
