#!/usr/bin/env python3
"""Build the mutation and attack rows the battery runs.

Every row is a whole submission: base plus something. A mutation row is the
reference solution with one rule broken, and it has to cost at least one graded
case, otherwise that case is asserting nothing. An attack row is the reference
solution plus a foothold the block is supposed to refuse, and it has to end
with nothing graded at all. A benign row is something a solver plainly might
do, and it has to be graded normally.
"""

import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE.parents[1] / "work"
ROWS = HERE / "rows"

# Expected counts, read from the generated config so a row list can never drift
# from the id set it is judged against.
_config = json.loads((HERE / "tests" / "config.json").read_text())
F2P_COUNT = len(_config["f2p_node_ids"])
P2P_COUNT = len(_config["p2p_node_ids"])

SET_EXEC = "src/exec/set_exec.rs"
BINDER = "src/planner/binder.rs"
BINDER_UTIL = "src/planner/binder_util.rs"
LIMIT = "src/optimizer/limit_pushdown.rs"
LOGICAL = "src/planner/logical.rs"
PARSER = "src/parser/parser.rs"
MANIFEST = "Cargo.toml"
LIB = "src/lib.rs"
INHERITED = "tests/aggregation.rs"
HELD_OUT = "tests/branch_pairing.rs"

# (row, [(file, find, replace)], [(file, new contents)])
MUTANTS = [
    ("union_keeps_duplicates", [(SET_EXEC,
        "(SetOperator::Union, false) => dedup(concat(left, right)),",
        "(SetOperator::Union, false) => concat(left, right),")], []),
    ("intersect_all_keeps_every_left_copy", [(SET_EXEC,
        "Quota::Shared => held.min(other),", "Quota::Shared => held,")], []),
    ("except_all_drops_every_matched_copy", [(SET_EXEC,
        "Quota::Surplus => held.saturating_sub(other),",
        "Quota::Surplus => 0,")], []),
    ("except_distinct_counts_copies", [(SET_EXEC,
        "(SetOperator::Except, false) => keep_present(left, &right, false),",
        "(SetOperator::Except, false) => dedup(keep_copies(left, &right, Quota::Surplus)),")], []),
    ("copies_kept_are_the_trailing_ones", [(SET_EXEC,
        "    let mut out = Vec::new();\n    for row in left {\n        if let Some(remaining) = budget.get_mut(&row_key(&row)) {",
        "    let mut out = Vec::new();\n    let left: Vec<Row> = left.into_iter().rev().collect();\n    for row in left {\n        if let Some(remaining) = budget.get_mut(&row_key(&row)) {")], []),
    ("nulls_never_pair", [(SET_EXEC,
        "fn row_key(row: &Row) -> Vec<GroupKey> {\n    row.values().iter().map(|v| v.group_key()).collect()\n}",
        "fn row_key(row: &Row) -> Vec<GroupKey> {\n    if row.values().iter().any(|v| v.is_null()) {\n        return vec![GroupKey::Text(format!(\"{:p}\", row))];\n    }\n    row.values().iter().map(|v| v.group_key()).collect()\n}")], []),
    ("a_narrow_branch_keeps_its_own_values", [(BINDER_UTIL,
        "    let already_wide = branch_schema", "    let already_wide = true || branch_schema")], []),
    ("names_come_from_the_right_branch", [(BINDER,
        "            fields.push(Field::with_nullability(\n                l.name(),",
        "            fields.push(Field::with_nullability(\n                r.name(),")], []),
    ("every_operator_folds_from_the_left", [(BINDER,
        "            if operators[at].0.binds_tighter() {", "            if false {")], []),
    ("an_unresolvable_order_key_is_ignored", [(BINDER,
        "        if !select.order_by.is_empty() {\n            plan = self.build_sort(plan, select, order_scope.as_ref(), visible_count)?;\n        }",
        "        if !select.order_by.is_empty() {\n            plan = match self.build_sort(plan.clone(), select, order_scope.as_ref(), visible_count) {\n                Ok(sorted) => sorted,\n                Err(_) => plan,\n            };\n        }")], []),
    ("trailing_clauses_bind_to_the_last_branch", [(PARSER,
        "        let mut stmt = self.parse_select_core()?;\n        while let Some((op, all)) = self.eat_set_operator() {\n            let select = self.parse_select_core()?;\n            stmt.set_ops.push(SetOpBranch { op, all, select });\n        }\n        self.parse_query_tail(&mut stmt)?;",
        "        let mut stmt = self.parse_select_core()?;\n        self.parse_query_tail(&mut stmt)?;\n        while let Some((op, all)) = self.eat_set_operator() {\n            let mut select = self.parse_select_core()?;\n            self.parse_query_tail(&mut select)?;\n            stmt.set_ops.push(SetOpBranch { op, all, select });\n        }")], []),
    ("branches_need_not_line_up", [(BINDER,
        "        if left_schema.len() != right_schema.len() {", "        if false {")], []),
    ("the_bound_is_the_limit_alone", [(LIMIT,
        "                Some(l.saturating_add(offset.unwrap_or(0)))", "                Some(l)")], []),
    ("every_set_operator_is_bounded", [(LIMIT,
        "                Some(l) if all && matches!(op, SetOperator::Union) => {",
        "                Some(l) if true => {")], []),
    ("the_bound_is_reapplied_every_pass", [(LIMIT,
        "    if already_bounded(&plan, bound) {\n        return plan;\n    }", "")], []),
    # Looks through a Sort to bound the concatenation's branches, and leaves
    # every other plan alone: the sort still sees a truncated pair of branches,
    # so only a set operation under an ORDER BY gives it away.
    ("a_sort_no_longer_blocks_the_bound", [(LIMIT,
        "        if let LogicalPlan::SetOp {\n            left,\n            right,\n            op,\n            all,\n            schema,\n        } = *input\n        {",
        "        if let LogicalPlan::Sort { input: inner, keys } = *input {\n"
        "            if let LogicalPlan::SetOp {\n                left,\n                right,\n                op,\n                all,\n                schema,\n            } = *inner\n            {\n"
        "                let bound = match limit {\n                    Some(l) if all && matches!(op, SetOperator::Union) => {\n                        Some(l.saturating_add(offset.unwrap_or(0)))\n                    }\n                    _ => None,\n                };\n"
        "                let (left, right) = match bound {\n                    Some(bound) => (bound_branch(*left, bound), bound_branch(*right, bound)),\n                    None => (*left, *right),\n                };\n"
        "                let combined = LogicalPlan::SetOp {\n                    left: Box::new(left),\n                    right: Box::new(right),\n                    op,\n                    all,\n                    schema,\n                };\n"
        "                return LogicalPlan::Limit {\n                    input: Box::new(LogicalPlan::Sort {\n                        input: Box::new(combined),\n                        keys,\n                    }),\n                    limit,\n                    offset,\n                };\n            }\n"
        "            return LogicalPlan::Limit {\n                input: Box::new(LogicalPlan::Sort { input: inner, keys }),\n                limit,\n                offset,\n            };\n        }\n"
        "        if let LogicalPlan::SetOp {\n            left,\n            right,\n            op,\n            all,\n            schema,\n        } = *input\n        {")], []),
    ("explain_names_the_node_not_the_operator", [(LOGICAL,
        "            LogicalPlan::SetOp { op, all, .. } => {\n                let mut label = op.keyword().to_string();",
        "            LogicalPlan::SetOp { op, all, .. } => {\n                let mut label = \"SetOp\".to_string();\n                let _ = op;")], []),
]

ATTACKS = [
    # A build script runs arbitrary code at compile time, before any binary the
    # verifier is about to trust has been produced.
    ("build_script", [], [("build.rs",
        "fn main() {\n    println!(\"cargo:rerun-if-changed=build.rs\");\n}\n")]),
    # A cargo config that replaces the compiler.
    ("cargo_rustc_wrapper", [], [(".cargo/config.toml",
        "[build]\nrustc-wrapper = \"/bin/true\"\n")]),
    # A test target that prints its own libtest lines and grades itself.
    ("harness_false_manifest", [(MANIFEST,
        "[profile.test]\nopt-level = 0\n",
        "[profile.test]\nopt-level = 0\n\n[[test]]\nname = \"branch_pairing\"\nharness = false\n")], []),
    # A target that claims a graded name and points it at another file.
    ("claims_a_graded_target_name", [(MANIFEST,
        "[profile.test]\nopt-level = 0\n",
        "[profile.test]\nopt-level = 0\n\n[[test]]\nname = \"aggregation\"\npath = \"tests/mine.rs\"\n")], []),
    # A toolchain file chooses the compiler that builds the graded binaries.
    ("toolchain_file", [], [("rust-toolchain.toml",
        "[toolchain]\nchannel = \"stable\"\n")]),
    # The hole quality review named on round 1: the top-level build.rs is
    # refused, so put one in a nested crate and reach it by path. It runs at
    # compile time, and on round 1 it ran as root.
    ("nested_build_script", [(MANIFEST,
        "[profile.test]\nopt-level = 0\n",
        "[profile.test]\nopt-level = 0\n\n[dependencies]\nhelper = { path = \"helper\" }\n")],
     [("helper/Cargo.toml",
       "[package]\nname = \"helper\"\nversion = \"0.1.0\"\nedition = \"2021\"\n"),
      ("helper/build.rs",
       "use std::fs;\n\nfn main() {\n"
       "    for path in [\"/tests/config.json\", \"/tests/grader.py\", \"/tests/test.sh\"] {\n"
       "        if let Ok(text) = fs::read_to_string(path) {\n"
       "            let _ = fs::write(\"/tmp/read-at-build-time\", text);\n"
       "        }\n    }\n}\n"),
      ("helper/src/lib.rs", "pub fn nothing() {}\n")]),
    # Same reach, through a proc macro rather than a build script: its code runs
    # inside the compiler.
    ("proc_macro_crate", [(MANIFEST,
        "[profile.test]\nopt-level = 0\n",
        "[profile.test]\nopt-level = 0\n\n[dependencies]\nsleight = { path = \"sleight\" }\n")],
     [("sleight/Cargo.toml",
       "[package]\nname = \"sleight\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\nproc-macro = true\n"),
      ("sleight/src/lib.rs",
       "use proc_macro::TokenStream;\n\n#[proc_macro]\npub fn nothing(_: TokenStream) -> TokenStream {\n"
       "    let _ = std::fs::read_to_string(\"/tests/config.json\");\n    TokenStream::new()\n}\n")]),
    # The hole quality review named on round 2. No build script, no proc macro,
    # no manifest edit: ordinary library source that reads the held-out patch
    # while it is being compiled. `include_str!` runs inside rustc, so nothing
    # the manifest reader looks at is involved and dropping privilege does not
    # help on its own -- /tests/test.patch was world readable. The whole
    # directory is closed now, so the macro cannot open the file and the crate
    # does not build.
    ("include_str_the_held_out_patch", [(LIB,
        "pub mod api;", "pub mod api;\nmod leak;")],
     [("src/leak.rs",
       "//! Read the graded suite out of the verifier while compiling.\n"
       "pub(crate) const HIDDEN: &str = include_str!(\"/tests/test.patch\");\n\n"
       "pub(crate) fn peek() -> bool {\n"
       "    HIDDEN.contains(\"union_reports_each_row_once\")\n}\n")]),
]

# Rows that must be graded normally. Each is something a solver plainly might
# do, and each would be a zero under a harness that pinned too much.
BENIGN = [
    # Every graded suite is named by test.patch, so prepare resets it from the
    # base commit before grading. Gutting one costs nothing, and the row proves
    # the reset actually happens rather than being argued about.
    ("rewrites_an_inherited_suite", [], [(INHERITED,
        "//! Integration tests for GROUP BY, HAVING, and aggregate functions.\n"
        "mod common;\n\n#[test]\nfn counts_rows() {}\n")]),
    ("rewrites_a_held_out_suite", [], [(HELD_OUT,
        "//! Replaced.\n\n#[test]\nfn union_reports_each_row_once() {}\n")]),
    # A cargo config that says nothing about the compiler or the runner.
    ("harmless_cargo_config", [], [(".cargo/config.toml",
        "[net]\noffline = true\n")]),
    # Coverage of one's own work, which CONTRIBUTING.md asks for, in a file
    # nothing grades.
    ("adds_its_own_test_file", [], [("tests/my_set_ops.rs",
        "//! A solver's own coverage.\n\nuse tanager::Database;\n\n#[test]\nfn union_runs() {\n"
        "    let mut db = Database::new();\n    db.execute(\"CREATE TABLE t (v INTEGER)\").unwrap();\n"
        "    db.execute(\"INSERT INTO t (v) VALUES (1)\").unwrap();\n"
        "    assert_eq!(db.query(\"SELECT v FROM t UNION SELECT v FROM t\").unwrap().row_count(), 1);\n}\n")]),
]


def run(*args, **kw):
    return subprocess.run(args, cwd=BUILD, check=True, capture_output=True, text=True, **kw)


def build(name, edits, added):
    run("git", "checkout", "-q", "-B", "row", "solution")
    for rel, find, replace in edits:
        path = BUILD / rel
        body = path.read_text()
        if find not in body:
            raise SystemExit(f"{name}: nothing to change in {rel}")
        path.write_text(body.replace(find, replace, 1))
    for rel, contents in added:
        path = BUILD / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
    run("git", "add", "-A")
    run("git", "-c", "user.name=row", "-c", "user.email=row@local", "commit", "-q", "-m", name)
    diff = run("git", "diff", "main", "row").stdout
    (ROWS / f"{name}.patch").write_text(diff)
    return len(diff.splitlines())


def main() -> int:
    ROWS.mkdir(exist_ok=True)
    for name, edits, added in MUTANTS:
        print(f"mutant  {name:42s} {build(name, edits, added):5d} diff lines")
    for name, edits, added in ATTACKS:
        print(f"attack  {name:42s} {build(name, edits, added):5d} diff lines")
    for name, edits, added in BENIGN:
        print(f"benign  {name:42s} {build(name, edits, added):5d} diff lines")
    rows = ROWS.parent / "rows.tsv"
    lines = [f"{name}\t<{F2P_COUNT}\t{P2P_COUNT}" for name, _, _ in MUTANTS]
    lines += [f"{name}\t0\t0" for name, _, _ in ATTACKS]
    lines += [f"{name}\t{F2P_COUNT}\t{P2P_COUNT}" for name, _, _ in BENIGN]
    rows.write_text("\n".join(lines) + "\n")
    print(f"wrote {rows.name}: {len(lines)} rows")
    run("git", "checkout", "-q", "heldout")
    run("git", "branch", "-q", "-D", "row")
    return 0


if __name__ == "__main__":
    sys.exit(main())
