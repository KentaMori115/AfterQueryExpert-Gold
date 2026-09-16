#!/usr/bin/env python3
"""Build the attack, benign and shape rows the battery runs.

Every row is a whole submission: the base tree plus something. An attack row is
a foothold the block is supposed to refuse, and has to end with nothing graded.
A benign row is something a solver plainly might do beside a correct change,
and has to grade normally. The shape row is the one thing the mutation battery
cannot say anything about: it is a second implementation of the same request,
written to a different internal shape, and it has to score full marks.
"""

import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"
ROWS = HERE / "rows"
BASE = "origin/main"

config = json.loads((HERE / "tests" / "config.json").read_text())
F2P = len(config["f2p_node_ids"])
P2P = len(config["p2p_node_ids"])

CARGO = "Cargo.toml"


def git(tree, *args, **kw):
    return subprocess.run(["git", "-C", str(tree), *args], capture_output=True, text=True, **kw)


def worktree():
    tmp = pathlib.Path(tempfile.mkdtemp())
    tree = tmp / "app"
    subprocess.run(["git", "clone", "-q", str(BUILD), str(tree)], check=True)
    git(tree, "checkout", "-q", "origin/solution")
    return tree


def emit(name, edit, want_f2p, want_p2p, on_solution=True):
    tree = worktree()
    if not on_solution:
        git(tree, "checkout", "-q", BASE)
    edit(tree)
    git(tree, "add", "-A")
    diff = git(tree, "diff", "--cached", BASE)
    if diff.returncode != 0:
        raise SystemExit(f"{name}: diff failed: {diff.stderr}")
    (ROWS / f"{name}.patch").write_text(diff.stdout)
    shutil.rmtree(tree.parent, ignore_errors=True)
    return f"{name}\t{want_f2p}\t{want_p2p}"


def append(tree, rel, text):
    p = tree / rel
    p.write_text(p.read_text() + text)


def write(tree, rel, text):
    p = tree / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


ATTACKS = [
    # A build script runs arbitrary code while the graded targets compile.
    ("build_script", lambda t: write(t, "build.rs", "fn main() { println!(\"cargo:rerun-if-changed=build.rs\"); }\n")),
    # A cargo config naming a runner replaces the test binary outright.
    ("cargo_runner", lambda t: write(t, ".cargo/config.toml", "[target.'cfg(all())']\nrunner = \"/bin/true\"\n")),
    # harness = false lets a target print its own libtest lines.
    ("harness_false_manifest", lambda t: append(t, CARGO, "\n[[test]]\nname = \"image_faults\"\nharness = false\n")),
    # A manifest naming a build script, which is the same foothold by another route.
    ("named_build_script", lambda t: (write(t, "grow.rs", "fn main() {}\n"),
                                      append(t, CARGO, "\nbuild = \"grow.rs\"\n"))),
    # A proc macro library runs at compile time too.
    ("proc_macro_library", lambda t: append(t, CARGO, "\n[lib]\nproc-macro = true\n")),
    # A workspace pulls in members whose manifests were never read.
    ("workspace_member", lambda t: append(t, CARGO, "\n[workspace]\nmembers = []\n")),
    # A [[test]] claiming a graded name points it at another file.
    ("claims_a_graded_target_name", lambda t: (write(t, "tests/decoy.rs", "#[test]\nfn all_good() {}\n"),
                                               append(t, CARGO, "\n[[test]]\nname = \"stack_shape\"\npath = \"tests/decoy.rs\"\n"))),
]

BENIGN = [
    # A solver writing its own tests beside the change.
    ("adds_its_own_tests", lambda t: write(t, "tests/my_checks.rs",
        "use skald::bytecode::chunk_load;\n\n#[test]\nfn nothing_loads_from_nothing() {\n    assert!(chunk_load(&[]).is_none());\n}\n")),
    # A cargo config that changes nothing about how anything is built or run.
    ("harmless_cargo_config", lambda t: write(t, ".cargo/config.toml", "[net]\noffline = true\n")),
    # A solver editing an inherited suite while working. The file is restored
    # before it is built, so this grades exactly like a clean submission.
    ("rewrites_an_inherited_suite", lambda t: append(t, "tests/vm_execution.rs",
        "\n#[test]\nfn a_solver_left_this_here() {\n    assert_eq!(1 + 1, 2);\n}\n")),
]


def wider_fields(tree):
    """The same implementation with `usize` where the reference used `u16`.

    The request names the fields a flaw carries and not the width they are
    stored in, so a case that cannot read a `usize` offset is grading a type
    the task never asked for. One calibration trial was lost to exactly this:
    its `image_faults` scored 33 of 35 while every id in `stack_shape` failed,
    because that target would not compile.
    """
    p = tree / "src/verify/mod.rs"
    s = p.read_text()
    s = s.replace("    pub func: u16,", "    pub func: usize,")
    s = s.replace("    pub offset: u16,", "    pub offset: usize,")
    s = s.replace("func: func as u16,", "func,")
    # every site that hands a Flaw a u16, wherever the reference builds one
    s = re.sub(r"(Flaw \{[^}]*?)\boffset: insn\.offset,", r"\1offset: insn.offset as usize,", s, flags=re.S)
    s = re.sub(r"(Flaw \{[^}]*?)\boffset,", r"\1offset: offset as usize,", s, flags=re.S)
    s = s.replace("|f| f.offset == offset)", "|f| f.offset == offset as usize)")
    p.write_text(s)


def bare_types(tree):
    """The same implementation whose two public types derive nothing.

    Reading a kind with `==` or lifting a flaw out of the vector would ask for
    `PartialEq`, `Debug` or `Copy`, none of which the request states.
    """
    p = tree / "src/verify/mod.rs"
    s = p.read_text()
    s = s.replace("#[derive(Clone, Copy, Debug, PartialEq, Eq)]\npub enum FlawKind {", "pub enum FlawKind {")
    s = s.replace("#[derive(Clone, Copy, Debug, PartialEq, Eq)]\npub struct Flaw {", "pub struct Flaw {")
    p.write_text(s)


def shape_row(tree):
    """The same request, implemented from a different shape."""
    for rel in ("src/verify/mod.rs", "src/verify/decode.rs", "src/verify/depth.rs"):
        (tree / rel).unlink()
    (tree / "src/verify").rmdir()
    shutil.copy(HERE / "alt/verify.rs", tree / "src/verify.rs")
    # The CLI reaches for two helpers this shape does not carry.
    p = tree / "src/bin/skald.rs"
    text = p.read_text()
    text = text.replace("""            let flaws = skald::verify::chunk_verify(&chunk);
            if flaws.is_empty() {
                println!("skald: audit clean");
                return ExitCode::SUCCESS;
            }
            print!("{}", skald::verify::render(&flaws));
            println!("skald: {} flaws", flaws.len());
            ExitCode::FAILURE""",
    """            let flaws = skald::verify::chunk_verify(&chunk);
            if flaws.is_empty() {
                println!("skald: audit clean");
                return ExitCode::SUCCESS;
            }
            for flaw in &flaws {
                println!("{} {} {:?}", flaw.func, flaw.offset, flaw.kind);
            }
            println!("skald: {} flaws", flaws.len());
            ExitCode::FAILURE""")
    p.write_text(text)


def main() -> int:
    ROWS.mkdir(exist_ok=True)
    lines = []
    for name, edit in ATTACKS:
        lines.append(emit(name, edit, 0, 0))
    for name, edit in BENIGN:
        lines.append(emit(name, edit, F2P, P2P))
    lines.append(emit("another_shape", shape_row, F2P, P2P))
    lines.append(emit("wider_field_types", wider_fields, F2P, P2P))
    lines.append(emit("types_deriving_nothing", bare_types, F2P, P2P))
    (HERE / "rows.tsv").write_text("\n".join(lines) + "\n")
    print(f"wrote {len(lines)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
