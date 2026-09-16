#!/usr/bin/env python3
"""Build the mutation and attack rows the battery runs.

Every row is a whole submission: base plus something. A mutation row is the
reference solution with one rule broken, and it has to cost at least one graded
case, otherwise that case is asserting nothing. An attack row is the reference
solution plus a foothold the block is supposed to refuse, and it has to end
with nothing graded at all.
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"
ROWS = HERE / "rows"

# Expected counts, read from the generated config so a row list can never drift
# from the id set it is judged against.
_config = __import__("json").loads((HERE / "tests" / "config.json").read_text())
F2P_COUNT = len(_config["f2p_node_ids"])
P2P_COUNT = len(_config["p2p_node_ids"])

API = "src/api.rs"
DML = "src/planner/dml.rs"
COLUMN = "src/storage/column.rs"
TABLE = "src/storage/table.rs"
MANIFEST = "Cargo.toml"
INHERITED = "tests/aggregation.rs"

# (row, [(file, find, replace)], [(file, new contents)])
MUTANTS = [
    # Counts every matched row instead of the rows whose values moved.
    ("counts_matched_rows_not_changed_ones", [(API,
        "            if candidate != stored {", "            if true {")], []),
    # Assignments read the row being built, so the second one sees the first.
    ("assignments_see_each_other", [(API,
        "                values[assignment.column] = crate::exec::eval::eval(&assignment.value, &stored)?;",
        "                let so_far = Row::new(values.clone());\n"
        "                values[assignment.column] = crate::exec::eval::eval(&assignment.value, &so_far)?;")], []),
    # An unknown predicate matches, so NULL rows are touched.
    ("an_unknown_predicate_matches", [(DML,
        "        Some(expr) => Ok(crate::exec::eval(expr, row)?.is_truthy()),",
        "        Some(expr) => Ok(!matches!(\n"
        "            crate::exec::eval(expr, row)?,\n"
        "            crate::types::Value::Boolean(false)\n"
        "        )),")], []),
    # Rows are written without being validated first.
    ("writes_rows_without_checking_them", [(API,
        "            let candidate = table.coerce_row(Row::new(values))?;",
        "            let candidate = Row::new(values);")], []),
    # A DELETE reports its count but removes nothing.
    ("delete_removes_nothing", [(COLUMN,
        "            !drop", "            let _ = drop;\n            true")], []),
    # Neither guard alone can show a loss, because the bind-time check and the
    # storage coercion each reject a bad assignment on their own. Removing both
    # is what the graded cases have to answer for.
    ("nothing_checks_an_assigned_type", [(DML,
        "    let ok = actual == expected", "    let ok = true\n        || actual == expected"),
        (TABLE,
        "        (actual, expected) => Err(Error::type_error(format!(\n"
        "            \"column '{}' expects {}, got {}\",\n"
        "            field.name(),\n"
        "            expected,\n"
        "            actual\n"
        "        ))),",
        "        (_, _) => Ok(value),")], []),
    # A column may be assigned twice, last one winning.
    ("a_column_may_be_assigned_twice", [(DML,
        "        if assignments.iter().any(|a| a.column == column) {\n"
        "            return Err(Error::binder(format!(\n"
        "                \"column '{}' is assigned more than once\",\n"
        "                assignment.column\n"
        "            )));\n"
        "        }\n", "")], []),
    # A WHERE of any type is accepted.
    ("a_where_need_not_be_boolean", [(DML,
        "            require_predicate(\"WHERE\", &bound)?;", "")], []),
    # The alias is ignored, so qualified columns do not resolve.
    ("the_alias_is_ignored", [(DML,
        "    let scope = Scope::from_table(stmt.target.binding_name(), &schema, 0);\n"
        "    let binder = Binder::new(catalog);\n"
        "\n"
        "    let mut assignments",
        "    let scope = Scope::from_table(&stmt.target.name, &schema, 0);\n"
        "    let binder = Binder::new(catalog);\n"
        "\n"
        "    let mut assignments")], []),
    # Every row is deleted whatever the predicate says.
    ("delete_ignores_its_predicate", [(API,
        "            doomed.push(row_matches(bound.predicate.as_ref(), &stored)?);",
        "            let _ = &stored;\n            doomed.push(true);")], []),
    # Survivors are compacted in reverse, so stored order is lost.
    ("survivors_come_back_reversed", [(API,
        "        let removed = self.catalog.table_mut(&bound.table)?.remove_rows(&doomed);",
        "        let table = self.catalog.table_mut(&bound.table)?;\n"
        "        let removed = table.remove_rows(&doomed);\n"
        "        let kept: Vec<Row> = table.to_rows().into_iter().rev().collect();\n"
        "        let all: Vec<bool> = (0..table.row_count()).map(|_| true).collect();\n"
        "        table.remove_rows(&all);\n"
        "        for row in kept {\n"
        "            table.insert_row(row)?;\n"
        "        }")], []),
    # An UPDATE writes matched rows to the end of the table.
    ("updated_rows_move_to_the_end", [(API,
        "        self.catalog.table_mut(&bound.table)?.replace_rows(pending)?;",
        "        let table = self.catalog.table_mut(&bound.table)?;\n"
        "        let doomed: Vec<bool> = (0..table.row_count())\n"
        "            .map(|i| pending.iter().any(|(p, _)| *p == i))\n"
        "            .collect();\n"
        "        table.remove_rows(&doomed);\n"
        "        for (_, row) in pending {\n"
        "            table.insert_row(row)?;\n"
        "        }")], []),
]

ATTACKS = [
    ("build_script", [], [("build.rs",
        "fn main() {\n    println!(\"cargo:rerun-if-changed=build.rs\");\n}\n")]),
    ("cargo_runner", [], [(".cargo/config.toml",
        "[build]\nrustc-wrapper = \"/bin/true\"\n")]),
    ("harness_false_manifest", [(MANIFEST,
        "[lib]\n", "[[test]]\nname = \"set_assignments\"\nharness = false\n\n[lib]\n")], []),
    ("claims_a_graded_target_name", [(MANIFEST,
        "[lib]\n", "[[test]]\nname = \"aggregation\"\npath = \"tests/mine.rs\"\n\n[lib]\n")], []),
]

# Rows that must be graded normally: things a solver plainly does.
BENIGN = [
    # A manifest edit that says nothing about targets or the compiler. Pinning a
    # manifest by content turned exactly this into a zero on another task.
    ("profile_added_to_the_manifest", [(MANIFEST,
        "[lib]\n", "[profile.dev]\ndebug = 1\n\n[lib]\n")], []),
    # An inherited suite is named by test.patch, so prepare resets it from the
    # base commit before grading. Gutting it costs nothing.
    ("rewrites_an_inherited_suite", [], [(INHERITED,
        "#[test]\nfn gutted() {}\n")]),
    # A cargo config that says nothing about the compiler or the runner.
    ("harmless_cargo_config", [], [(".cargo/config.toml",
        "[net]\noffline = true\n")]),
    # Dropping the bind-time assignment check. Storage coerces on the way in and
    # raises the same Type error, so behaviour does not move and every graded
    # case still passes. Measured, not assumed: this row scored 53 of 53.
    ("the_bind_time_type_check_is_dropped", [(DML,
        "    let ok = actual == expected", "    let ok = true\n        || actual == expected")], []),
    # Storage alone, with the bind-time check still standing in front of it:
    # measured 53 of 53, so the two guards are redundant with each other.
    ("storage_takes_any_value", [(TABLE,
        "        (actual, expected) => Err(Error::type_error(format!(\n"
        "            \"column '{}' expects {}, got {}\",\n"
        "            field.name(),\n"
        "            expected,\n"
        "            actual\n"
        "        ))),",
        "        (_, _) => Ok(value),")], []),
    # A solver writing its own tests beside the ones it was given.
    ("adds_its_own_tests", [], [("tests/my_own_checks.rs",
        "use tanager::{Database, Outcome};\n"
        "\n"
        "#[test]\n"
        "fn update_reports_a_count() {\n"
        "    let mut db = Database::new();\n"
        "    db.execute(\"CREATE TABLE t (id INTEGER)\").unwrap();\n"
        "    db.execute(\"INSERT INTO t VALUES (1)\").unwrap();\n"
        "    assert_eq!(db.execute(\"UPDATE t SET id = 2\").unwrap(), Outcome::Updated(1));\n"
        "}\n")]),
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
    run("git", "checkout", "-q", "tests")
    run("git", "branch", "-q", "-D", "row")
    return 0


if __name__ == "__main__":
    sys.exit(main())
