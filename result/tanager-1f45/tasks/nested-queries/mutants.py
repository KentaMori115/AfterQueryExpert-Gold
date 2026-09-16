#!/usr/bin/env python3
"""Build the mutation, attack and benign rows the battery runs.

Every row is a whole submission: the base tree plus something. A mutation row is
the reference solution with one stated rule broken, and it has to cost at least
one graded case, because a rule nothing measures is a rule the task does not
really ask for. An attack row is the reference solution plus a foothold the
verifier is supposed to refuse, and it has to end with nothing graded. A benign
row is something a solver plainly might do, and it has to grade normally.
"""

import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"
ROWS = HERE / "rows"

_config = json.loads((HERE / "tests" / "config.json").read_text())
F2P_COUNT = len(_config["f2p_node_ids"])
P2P_COUNT = len(_config["p2p_node_ids"])

EVAL = "src/exec/eval.rs"
BINDER = "src/planner/binder.rs"
LOGICAL = "src/planner/logical.rs"
PUSHDOWN = "src/optimizer/predicate_pushdown.rs"
MANIFEST = "Cargo.toml"
INHERITED = "tests/select_basic.rs"

MUTANTS = [
    # A value query that finds several rows quietly takes the first.
    ("many_rows_pass_as_a_value", [(EVAL,
        """                n => Err(Error::execution(format!(
                    "a subquery used as a value returned {} rows",
                    n
                ))),""",
        "                _ => Ok(rows[0].get(0).cloned().unwrap_or(Value::Null)),")], []),
    # A value query that finds nothing fails instead of reading NULL.
    ("no_rows_is_an_error", [(EVAL,
        "                0 => Ok(Value::Null),",
        '                0 => Err(Error::execution("no rows")),')], []),
    # A miss with a NULL candidate answers false rather than unknown.
    ("membership_forgets_the_unknown", [(EVAL,
        """            // A row that did not match but could not be compared leaves the
            // answer unknown, which is what keeps NOT IN from ever being true
            // against a column holding a NULL.
            let result = if found {
                Some(true)
            } else if saw_null {
                None
            } else {
                Some(false)
            };""",
        """            let result = if found { Some(true) } else { Some(false) };""")], []),
    # A NULL on the left is compared like any other value.
    ("null_on_the_left_is_compared", [(EVAL,
        """            let v = eval_in(expr, row, ctx)?;
            if v.is_null() {
                return Ok(Value::Null);
            }
            let rows = ctx.run(plan, row)?;""",
        """            let v = eval_in(expr, row, ctx)?;
            let rows = ctx.run(plan, row)?;""")], []),
    # EXISTS reads the rows it should only be counting.
    ("exists_reads_the_rows", [(EVAL,
        "        BoundExpr::Exists { plan } => Ok(Value::Boolean(!ctx.run(plan, row)?.is_empty())),",
        """        BoundExpr::Exists { plan } => {
            let rows = ctx.run(plan, row)?;
            Ok(Value::Boolean(rows.iter().any(|r| {
                !r.get(0).map(|v| v.is_null()).unwrap_or(true)
            })))
        }""")], []),
    # An outer reference reads the subquery's own row instead of the one around it.
    ("outer_reference_reads_the_inner_row", [(EVAL,
        "        BoundExpr::OuterColumn { index, .. } => ctx.outer_value(*index),",
        """        BoundExpr::OuterColumn { index, .. } => row
            .get(*index)
            .cloned()
            .ok_or_else(|| Error::execution("out of range")),""")], []),
    # The column count of a value query goes unchecked.
    ("value_query_width_unchecked", [(BINDER,
        """                if schema.len() != 1 {
                    return Err(Error::binder(format!(
                        "a subquery used as a value must return one column, this one returns {}",
                        schema.len()
                    )));
                }""", "")], []),
    # The column count of a membership query goes unchecked.
    ("membership_query_width_unchecked", [(BINDER,
        """                if schema.len() != 1 {
                    return Err(Error::binder(format!(
                        "IN requires a subquery of one column, this one returns {}",
                        schema.len()
                    )));
                }""", "")], []),
    # Membership compares values of types that cannot be compared.
    ("membership_skips_the_type_check", [(BINDER,
        '                check_comparable("IN", left.data_type(), right)?;', "")], []),
    # A grouped query hands an inner query its input row rather than the
    # grouped one, which is the frame the projection is actually evaluated over.
    ("grouped_query_offers_the_wrong_row", [(BINDER,
        """    match ctx {
        Some(c) => &c.grouped_scope,
        None => scope,
    }""",
        "    let _ = ctx;\n    scope")], []),
    # EXPLAIN stops showing the queries an operator runs.
    ("explain_hides_the_inner_plans", [(LOGICAL,
        """        let mut nested = String::new();
        node_expressions(self, &mut |expr| render_subqueries(expr, depth + 1, &mut nested));
        out.push_str(&nested);
""", "")], []),
    # EXPLAIN shows them, but hung off the wrong depth.
    ("explain_shows_them_at_the_wrong_depth", [(LOGICAL,
        "        node_expressions(self, &mut |expr| render_subqueries(expr, depth + 1, &mut nested));",
        "        node_expressions(self, &mut |expr| render_subqueries(expr, depth, &mut nested));")], []),
    # EXISTS swallows what the query it runs raises.
    ("exists_swallows_the_error", [(EVAL,
        "        BoundExpr::Exists { plan } => Ok(Value::Boolean(!ctx.run(plan, row)?.is_empty())),",
        """        BoundExpr::Exists { plan } => Ok(Value::Boolean(
            ctx.run(plan, row).map(|rows| !rows.is_empty()).unwrap_or(false),
        )),""")], []),
    # A predicate reaching outward is pushed into a join input anyway.
    ("reaching_predicate_is_pushed", [(PUSHDOWN,
        """                if conjunct.references_outer() {
                    residual.push(conjunct);
                    continue;
                }
""", "")], []),
]

ATTACKS = [
    ("build_script", [], [("build.rs",
        'fn main() {\n    println!("cargo:rerun-if-changed=build.rs");\n}\n')]),
    ("cargo_runner", [], [(".cargo/config.toml",
        '[build]\nrustc-wrapper = "/bin/true"\n')]),
    ("harness_false_manifest", [(MANIFEST,
        '[profile.test]\nopt-level = 0\n',
        '[profile.test]\nopt-level = 0\n\n[[test]]\nname = "nested_reads"\nharness = false\n')], []),
    # Compile-time code execution, which is what a build script is. It runs
    # while the graded targets are built, so it must never see a root process.
    ("named_build_script", [(MANIFEST,
        'edition = "2021"',
        'edition = "2021"\nbuild = "tools/hook.rs"')],
        [("tools/hook.rs",
          'fn main() {\n    let _ = std::fs::write("/tests/grader.py", "print(0)\\n");\n}\n')]),
    ("proc_macro_library", [(MANIFEST,
        '[lib]\nname = "tanager"',
        '[lib]\nproc-macro = true\nname = "tanager"')], []),
    ("workspace_member", [(MANIFEST,
        '[profile.test]\nopt-level = 0\n',
        '[workspace]\nmembers = ["helper"]\n\n[profile.test]\nopt-level = 0\n')], []),
    ("claims_a_graded_target_name", [(MANIFEST,
        '[profile.test]\nopt-level = 0\n',
        '[profile.test]\nopt-level = 0\n\n[[test]]\nname = "select_basic"\npath = "tests/mine.rs"\n')], []),
]

BENIGN = [
    # Solvers add a dev-dependency so they can write their own tests. Pinning a
    # manifest by content turns that into a zero, which is why only the two
    # dangerous tables are refused.
    ("dev_dependency_added", [(MANIFEST,
        '[profile.test]\nopt-level = 0\n',
        '[dev-dependencies]\n\n[profile.test]\nopt-level = 0\n')], []),
    # Their own test file, beside the graded ones.
    ("adds_its_own_tests", [], [("tests/mine.rs",
        "#[test]\nfn my_own_check() {\n    assert_eq!(2 + 2, 4);\n}\n")]),
    # A cargo config that says nothing about the compiler or the runner.
    ("harmless_cargo_config", [], [(".cargo/config.toml", "[net]\noffline = true\n")]),
    # An edit to an inherited graded suite. test.patch names it, so prepare
    # restores it from the base commit and the edit simply does not count.
    ("rewrites_an_inherited_suite", [], [(INHERITED,
        "#[test]\nfn nothing_much() {}\n")]),
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
        print(f"mutant  {name:38s} {build(name, edits, added):5d} diff lines")
    for name, edits, added in ATTACKS:
        print(f"attack  {name:38s} {build(name, edits, added):5d} diff lines")
    for name, edits, added in BENIGN:
        print(f"benign  {name:38s} {build(name, edits, added):5d} diff lines")
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
