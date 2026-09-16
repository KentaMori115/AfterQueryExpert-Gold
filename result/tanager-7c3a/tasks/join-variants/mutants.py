#!/usr/bin/env python3
"""Build the mutation and attack rows the battery runs.

Every row is a whole submission: base plus something. A mutation row is the
reference solution with one rule broken, and it has to cost at least one graded
case, otherwise that case is asserting nothing. An attack row is the reference
solution plus a foothold the block is supposed to refuse, and it has to end
with nothing graded at all. A benign row is something a solver plainly might
do, and it has to grade exactly like the reference.
"""

import json
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"
ROWS = HERE / "rows"

# Expected counts, read from the generated config so a row list can never drift
# from the id set it is judged against.
_config = json.loads((HERE / "tests" / "config.json").read_text())
F2P_COUNT = len(_config["f2p_node_ids"])
P2P_COUNT = len(_config["p2p_node_ids"])

STATEMENT = "src/ast/statement.rs"
JOIN_EXEC = "src/exec/join_exec.rs"
PUSHDOWN = "src/optimizer/predicate_pushdown.rs"
BINDER = "src/planner/binder.rs"
PARSER = "src/parser/parser.rs"
MANIFEST = "Cargo.toml"
INHERITED = "tests/joins.rs"

# (row, [(file, find, replace)], [(file, new contents)])
MUTANTS = [
    # The crux: the old legality rule, which pushed a left-only conjunct
    # unconditionally and a right-only one only for an inner join.
    ("pushdown_keeps_the_old_legality", [(PUSHDOWN,
        "let takes_left = !join_type.keeps_unmatched_right();\n"
        "            let takes_right = !join_type.keeps_unmatched_left();",
        "let takes_left = true;\n"
        "            let takes_right = matches!(join_type, crate::ast::statement::JoinType::Inner);")], []),
    # The other crux: pushing through a join whose output frame was reordered
    # by a merge, so an index reaches a different column than the one bound.
    ("pushdown_descends_through_a_merge", [(PUSHDOWN,
        "            if !merged.is_empty() {", "            if false {")], []),
    ("unmatched_right_rows_come_first", [(JOIN_EXEC,
        """    if join_type.keeps_unmatched_right() {
        for (j, r) in right_rows.iter().enumerate() {
            if !right_matched[j] {
                out.push(layout.emit(&Row::new(null_left.clone()).concat(r))?);
            }
        }
    }

    Ok(out)""",
        """    if join_type.keeps_unmatched_right() {
        let mut lead = Vec::new();
        for (j, r) in right_rows.iter().enumerate() {
            if !right_matched[j] {
                lead.push(layout.emit(&Row::new(null_left.clone()).concat(r))?);
            }
        }
        lead.extend(out);
        return Ok(lead);
    }

    Ok(out)""")], []),
    ("merged_value_never_falls_back", [(JOIN_EXEC,
        """            let taken = if left.is_null() {
                paired.get(r).cloned().unwrap_or(Value::Null)
            } else {
                left
            };""",
        """            let _ = r;
            let taken = left;""")], []),
    ("merged_value_keeps_its_own_type", [(JOIN_EXEC,
        "            values.push(settle(taken, target)?);",
        "            let _ = target;\n            values.push(taken);")], []),
    ("full_join_drops_unmatched_left_rows", [(STATEMENT,
        "        matches!(self, JoinType::Left | JoinType::Full)",
        "        matches!(self, JoinType::Left)")], []),
    ("full_join_drops_unmatched_right_rows", [(STATEMENT,
        "        matches!(self, JoinType::Right | JoinType::Full)",
        "        matches!(self, JoinType::Right)")], []),
    ("cross_join_accepts_a_constraint", [(STATEMENT,
        "        !matches!(self, JoinType::Cross)", "        true")], []),
    # The gap quality review found on round 1: OUTER is promised optional after
    # all three of LEFT, RIGHT and FULL, and the suite only read two of them,
    # so a build rejecting LEFT OUTER could still score reward 1.
    ("left_outer_is_rejected", [(PARSER,
        "            if self.eat_keyword(word) {\n                self.eat_keyword(Keyword::Outer);",
        "            if self.eat_keyword(word) {\n                if !matches!(join_type, JoinType::Left) {\n                    self.eat_keyword(Keyword::Outer);\n                }")], []),
    ("using_columns_do_not_merge", [(BINDER,
        "                    merged.push((left_index, right_index));", "")], []),
]

ATTACKS = [
    ("build_script", [], [("build.rs",
        "fn main() {\n    println!(\"cargo:rerun-if-changed=build.rs\");\n}\n")]),
    ("cargo_runner", [], [(".cargo/config.toml",
        "[build]\nrustc-wrapper = \"/bin/true\"\n")]),
    ("rust_toolchain_file", [], [("rust-toolchain.toml",
        "[toolchain]\nchannel = \"stable\"\n")]),
    # The two holes quality review found on round 2: `build.rs` was refused by
    # filename only, so a manifest key pointing a build script anywhere else
    # walked straight past it, and compilation ran that code as root.
    ("build_script_at_a_custom_path", [(MANIFEST,
        'readme = "README.md"',
        'readme = "README.md"\nbuild = "src/setup.rs"')],
        [("src/setup.rs",
          "use std::fs;\nfn main() {\n"
          "    let _ = fs::write(\"/tests/config.json\", \"{}\");\n"
          "    let _ = fs::write(\"/logs/verifier/base.xml\", \"<testsuite/>\");\n"
          "}\n")]),
    ("build_script_in_a_subdirectory", [(MANIFEST,
        'readme = "README.md"', 'readme = "README.md"\nbuild = "src/build.rs"')],
        [("src/build.rs", "fn main() {}\n")]),
    # A nested crate reached by a path dependency, carrying the build script.
    # This is the shape the fixed REFUSED list never covered.
    ("path_dependency_with_a_build_script", [(MANIFEST,
        "[profile.release]",
        "[dependencies]\nhelper = { path = \"helper\" }\n\n[profile.release]")],
        [("helper/Cargo.toml",
          '[package]\nname = "helper"\nversion = "0.1.0"\nedition = "2021"\nbuild = "build.rs"\n'),
         ("helper/src/lib.rs", "pub fn nothing() {}\n"),
         ("helper/build.rs",
          "use std::fs;\nfn main() {\n"
          "    let _ = fs::read_to_string(\"/tests/config.json\")\n"
          "        .map(|c| fs::write(\"/tmp/leak.json\", c));\n}\n")]),
    # A procedural macro runs inside rustc itself, so it needs no build script.
    ("proc_macro_crate", [(MANIFEST,
        "[profile.release]",
        "[dependencies]\nhelper = { path = \"helper\" }\n\n[profile.release]")],
        [("helper/Cargo.toml",
          '[package]\nname = "helper"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\nproc-macro = true\n'),
         ("helper/src/lib.rs",
          "use std::fs;\nuse proc_macro::TokenStream;\n"
          "#[proc_macro]\npub fn peek(_: TokenStream) -> TokenStream {\n"
          "    let _ = fs::read_to_string(\"/tests/config.json\");\n"
          "    \"\".parse().unwrap()\n}\n")]),
    ("harness_false_manifest", [(MANIFEST,
        "[profile.test]\nopt-level = 0\n",
        "[profile.test]\nopt-level = 0\n\n[[test]]\nname = \"join_forms\"\nharness = false\n")], []),
    ("claims_a_graded_target_name", [(MANIFEST,
        "[profile.test]\nopt-level = 0\n",
        "[profile.test]\nopt-level = 0\n\n[[test]]\nname = \"join_using\"\npath = \"tests/mine.rs\"\n")], []),
]

# Rows that must be graded normally. Each is something a solver plainly does
# while implementing a join feature, and each would be a zero under a verifier
# that reached for a digest where it should have reached for a checkout.
BENIGN = [
    # The one this task's design turns on. Adding cases to tests/joins.rs is
    # the obvious thing to do when the work IS joins, and content-pinning that
    # file would read it as tampering and fail all 131 ids. test.sh restores
    # the file from the base commit instead, so the edit costs nothing and a
    # gutted suite is replaced rather than believed.
    ("rewrites_an_inherited_suite", [], [(INHERITED,
        "//! gutted by the submission\n\n#[test]\nfn inner_join_matches_rows() {}\n")]),
    # A solver writing its own tests alongside the inherited ones.
    ("adds_its_own_test_file", [], [("tests/scratch_joins.rs",
        "#[test]\nfn my_own_check() {\n    assert_eq!(2 + 2, 4);\n}\n")]),
    # A manifest edit that says nothing about how a target is built or named.
    # This repo has no dependencies and the verifier runs offline, so a profile
    # tweak is the realistic shape here rather than a new dev-dependency.
    ("manifest_profile_tweak", [(MANIFEST,
        "[profile.test]\nopt-level = 0\n", "[profile.test]\nopt-level = 1\n")], []),
    # A cargo config that says nothing about the compiler or the runner.
    ("harmless_cargo_config", [], [(".cargo/config.toml", "[net]\noffline = true\n")]),
]


def run(*args):
    return subprocess.run(args, cwd=BUILD, check=True, capture_output=True, text=True)


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
    run("git", "checkout", "-q", "main")
    run("git", "branch", "-q", "-D", "row")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
