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

ENGINE = "crates/fwctl-core/src/update/engine.rs"
JOURNAL = "crates/fwctl-core/src/update/journal.rs"
SIM_MANIFEST = "crates/fwctl-sim/Cargo.toml"
INHERITED = "crates/fwctl-sim/tests/update_engine.rs"

# (row, kind, [(file, find, replace)], [(file, new contents)])
MUTANTS = [
    ("stage_writes_nothing", [(ENGINE,
        "        journal.record(&staged)?;\n", "")], []),
    ("stage_goes_on_to_boot", [(ENGINE,
        "        let staged = StagedUpdate::from_plan(&plan, update_id, policy.allow_downgrade);",
        "        self.set_candidate_and_confirm(device_id, update_id, &plan, observe)?;\n"
        "        let staged = StagedUpdate::from_plan(&plan, update_id, policy.allow_downgrade);")], []),
    ("stage_settles_on_the_wrong_state", [(ENGINE,
        "            UpdateState::Staged,\n            plan.image_size,",
        "            UpdateState::Verifying,\n            plan.image_size,")], []),
    ("activate_keeps_the_record", [(ENGINE,
        "        journal.discard(device_id)?;\n        let mut leaving",
        "        let mut leaving")], []),
    ("activate_ignores_the_counter", [(ENGINE,
        " || staged.rollback_counter < info.rollback_counter {", " {")], []),
    ("activate_ignores_the_running_version", [(ENGINE,
        "            if waiting < running {", "            if false {")], []),
    ("activate_ignores_the_downgrade_permission", [(ENGINE,
        "        if !staged.allow_downgrade {", "        if true {")], []),
    ("stage_always_opens_a_new_transfer", [(ENGINE,
        "            Some(held) if held.image_digest == plan.image_digest => held.update_id,\n", "")], []),
    ("report_names_the_staged_starting_version", [(ENGINE,
        "        leaving.clone_from(&info.firmware_version);\n", "")], []),
    ("activate_ignores_the_transfer_id", [(ENGINE,
        "        if status.update_id != Some(staged.update_id) || status.accepted_offset < staged.image_size",
        "        if status.accepted_offset < staged.image_size")], []),
    ("activate_ignores_the_accepted_bytes", [(ENGINE,
        "        if status.update_id != Some(staged.update_id) || status.accepted_offset < staged.image_size",
        "        if status.update_id != Some(staged.update_id)")], []),
    ("activate_skips_the_digest", [(ENGINE,
        "        self.verify_image(staged.update_id, &plan, observe)?;\n"
        "        self.set_candidate_and_confirm(device_id, staged.update_id, &plan, observe)",
        "        self.set_candidate_and_confirm(device_id, staged.update_id, &plan, observe)")], []),
    ("journal_keeps_every_record", [(JOURNAL,
        "        kept.retain(|held| held.device_id != record.device_id);\n", "")], []),
]

ATTACKS = [
    ("build_script", [], [("crates/fwctl-sim/build.rs",
        "fn main() {\n    println!(\"cargo:rerun-if-changed=build.rs\");\n}\n")]),
    ("cargo_runner", [], [(".cargo/config.toml",
        "[build]\nrustc-wrapper = \"/bin/true\"\n")]),
    ("harness_false_manifest", [(SIM_MANIFEST,
        "[lints]\nworkspace = true\n",
        "[lints]\nworkspace = true\n\n[[test]]\nname = \"deferred_boot\"\nharness = false\n")], []),
    ("claims_a_graded_target_name", [(SIM_MANIFEST,
        "[lints]\nworkspace = true\n",
        "[lints]\nworkspace = true\n\n[[test]]\nname = \"host_update_contract\"\npath = \"tests/mine.rs\"\n")], []),
]

# Rows that must be graded normally. Every one of them is something a solver
# actually did on a calibration trial, or something one plainly might do, and
# each was a zero at some point in this task's history.
BENIGN = [
    # All eight difficulty-probe trials added exactly this line so they could
    # write their own tests. Pinning the manifest by content scored every one of
    # them 0 of 84.
    ("dev_dependency_added", [(SIM_MANIFEST,
        "[dev-dependencies]\nsha2.workspace = true\n",
        "[dev-dependencies]\nsha2.workspace = true\ntempfile.workspace = true\n")], []),
    # An inherited graded suite is named by test.patch, so prepare resets it
    # from the base commit before grading. Gutting it costs nothing.
    ("rewrites_an_inherited_suite", [], [(INHERITED,
        "#[test]\nfn completes_full_host_to_device_update() {}\n")]),
    # A cargo config that says nothing about the compiler or the runner.
    ("harmless_cargo_config", [], [(".cargo/config.toml",
        "[net]\noffline = true\n")]),
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
