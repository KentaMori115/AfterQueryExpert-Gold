"""Generate tests/test.sh from the frozen frame.

Only the block between the RUN TESTS markers is ours. This script asserts that
every byte above and below those markers is identical to ``original_test.sh``
before it writes anything, so the frozen-file check cannot be failed by an
accidental edit.

Two facts about cargo decide the shape of the block, both measured on this
repository rather than assumed:

* a test target that does not compile reports **no ids at all**, not failing
  ones, so the graded id set cannot be taken from what a run said;
* ``--tests`` globs every target under ``tests/``, and one target that will not
  build aborts the whole invocation before any other target reports. At the
  base commit that takes the pass-to-pass set from 92 to 0.

So every target is named on its own, and the declared id set comes from
``/tests/config.json``, which lives in the verifier image rather than in
``/app``. tanager is a single crate, not a workspace, so ``--test <name>``
selects on its own and no package needs naming.

The inherited targets that back the pass-to-pass ids are **restored from the
base commit** before anything is compiled, rather than pinned by content. They
live in ``/app`` where a solver works, and adding a case to ``tests/joins.rs``
while implementing a join feature is an ordinary thing to do: a digest over
those files would read that as tampering and publish every id as failed. A
checkout undoes the edit instead of punishing it, and it closes the same hole a
digest would, since a gutted base suite is replaced rather than believed.

The two held-back files are a different matter and stay pinned. The verifier
image puts them on disk, no honest submission writes them, and the canaries are
planted there.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
# The frame pulled from this draft. Its bytes outside the markers are asserted
# identical to the canonical one below; the block between them is ours.
FRAME = HERE / "frame.sh"
CANONICAL = HERE.parents[3] / "original_test.sh"
OUT = HERE / "tests" / "test.sh"
BUILD = HERE / "build"

START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"

# Read rather than repeated, so the sha the block checks out can never drift
# from the one grader.py resets against.
BASE_SHA = json.loads((HERE / "tests" / "config.json").read_text())["base_commit"]

# tanager is a single crate, so a target name selects on its own. Unit tests
# under src/** are deliberately not graded, because they live in the files a
# solution edits and can therefore be neither reset from base nor pinned by
# content. Doctests are not graded either: their ids carry a line number, and
# any edit above one moves it.
P2P_TARGETS = [
    "joins",
    "multi_join",
    "optimizer_effects",
    "explain",
    "select_basic",
    "order_and_limit",
    "aggregation",
    "null_semantics",
    "errors",
    "ddl_and_dml",
]
F2P_TARGETS = ["join_forms", "join_using"]

# The held-back files, pinned by content. The verifier image installs them and
# no submission has ever seen them, so a digest here has no honest way to fire.
PINNED = [
    "tests/join_forms.rs",
    "tests/join_using.rs",
]

# The inherited files, restored from the base commit instead of pinned. See the
# module docstring for why a digest over these is the wrong instrument.
RESTORED = [f"tests/{name}.rs" for name in P2P_TARGETS]

# Paths that hand submitted code a foothold before or around a test binary. A
# build script runs arbitrary code at compile time; `.cargo/config.toml` can
# name a runner that replaces the binary outright or a wrapper that replaces
# the compiler. None of them exist at the base commit, so their presence is
# tampering rather than a build.
REFUSED = [
    "build.rs",
    "rust-toolchain.toml",
    "rust-toolchain",
]


CONVERTER = r'''
"""Turn captured cargo output into the two JUnit reports the grade expects.

Read with `python3 -I` from stdin, so /app is never on sys.path and submitted
code cannot shadow a module this needs.

The declared id set is the authority. A declared id that no run reported is
written as a failure, which is what keeps a target that would not compile from
reading as an empty report rather than a failed submission.
"""

import json
import re
import sys
import xml.etree.ElementTree as ET

config_path, base_xml, new_xml, integrity, canaries, *captures = sys.argv[1:]
config = json.load(open(config_path))
declared = {"base": list(config["p2p_node_ids"]), "new": list(config["f2p_node_ids"])}

# `#[should_panic]` prints `test <name> - should panic ... ok`, so the suffix
# has to be optional or those ids never report and publish as failed while
# passing perfectly well.
RESULT = re.compile(r"^test (\S+)(?: - should panic)? \.\.\. (ok|FAILED|ignored)", re.M)
# libtest's own closing line, which a run that exited early never reaches.
TRAILER = re.compile(r"^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored", re.M)
# `--list` output. Listing runs no test, so no code from the submission has
# executed when it is produced: this is the honest set of names in the binary.
LISTED = re.compile(r"^(\S+): test$", re.M)
# libtest's own logfile, one line per case.
LOGGED = re.compile(r"^(ok|failed|ignored) (\S+)$", re.M)

def slurp(path):
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""

seen = {}
for capture in captures:
    which, target, path, list_path, log_path = capture.split(":", 4)
    text = slurp(path)
    results = RESULT.findall(text)
    listed = set(LISTED.findall(slurp(list_path)))

    # A test binary runs code from the submission in its own process, so three
    # things have to agree before any verdict from it is believed: the names it
    # reported are exactly the names the binary declares, libtest's own trailer
    # is present, and that trailer's counts match the lines actually read. Any
    # disagreement and the whole target is disbelieved, which publishes every id
    # it owns as failed.
    trusted = True
    reason = ""
    if listed and {name for name, _ in results} != listed:
        trusted, reason = False, "reported names do not match the binary's own listing"
    trailer = TRAILER.search(text)
    if trusted and results and not trailer:
        trusted, reason = False, "no closing result line: the run did not finish"
    if trusted and trailer:
        passed, failed, ignored = (int(g) for g in trailer.groups())
        counts = {}
        for _, verdict in results:
            counts[verdict] = counts.get(verdict, 0) + 1
        if (passed, failed, ignored) != (
            counts.get("ok", 0), counts.get("FAILED", 0), counts.get("ignored", 0)
        ):
            trusted, reason = False, "the closing counts disagree with the lines reported"
    # The second channel, when there is one. libtest writes it itself, so a
    # submission that printed its own verdicts to stdout and stopped has
    # nothing here to match.
    log_text = slurp(log_path)
    if trusted and log_text.strip():
        logged = {name: ("ok" if verdict == "ok" else verdict)
                  for verdict, name in LOGGED.findall(log_text)}
        stdout_verdicts = dict(results)
        if logged != {k: ("ok" if v == "ok" else "failed" if v == "FAILED" else v)
                      for k, v in stdout_verdicts.items()}:
            trusted, reason = False, "stdout and the harness log do not agree"

    if not trusted:
        print("[verifier] DISBELIEVED %s: %s" % (target, reason))
        continue

    for name, verdict in results:
        seen[target + "." + name] = verdict

def write(path, ids, label):
    suite = ET.Element("testsuite", name=label, tests=str(len(ids)))
    failures = 0
    for node in ids:
        classname, _, name = node.rpartition(".")
        case = ET.SubElement(suite, "testcase", classname=classname, name=name)
        verdict = "FAILED" if integrity == "tampered" else seen.get(node)
        if verdict != "ok":
            failures += 1
            reason = {
                None: "not reported by any run",
                "FAILED": "failed",
                "ignored": "ignored",
            }.get(verdict, str(verdict))
            if integrity == "tampered":
                reason = "graded inputs were modified"
            ET.SubElement(case, "failure", message=reason).text = reason
    suite.set("failures", str(failures))
    ET.ElementTree(suite).write(path, encoding="utf-8", xml_declaration=True)
    # Read it back before trusting it. The document is assembled through
    # ElementTree rather than by pasting tags, so this should never fire; it is
    # here so that a report which cannot be parsed says so in the log instead of
    # being discovered by whatever tries to grade it.
    try:
        ET.parse(path)
    except Exception as exc:
        print("[verifier] BUG: %s did not parse back: %s" % (path, exc))
    print("[verifier] %s: %d ids, %d failed" % (label, len(ids), failures))

# The planted cases decide whether any of this is believable. Their names and
# outcomes were settled in this container before anything was compiled, and a
# run is believed only where it reports each of them as chosen.
planted = [c for c in canaries.split() if c.count(":") == 2]
missed = []
for entry in planted:
    filename, name, want = entry.split(":")
    target = filename[:-3] if filename.endswith(".rs") else filename
    # A target that reported nothing did not build, which is the ordinary state
    # at the base commit. Its planted checks cannot speak, and silence there is
    # not evidence of a forgery: every id that target owns already fails for
    # want of a report. Only a target that did report has to account for them.
    if not any(k.startswith(target + ".") for k in seen):
        continue
    got = seen.get(target + "." + name)
    if got != want:
        missed.append("%s expected %s, run said %s" % (name, want, got))
if missed:
    print("[verifier] DISBELIEVED every target: planted checks disagree")
    for m in missed:
        print("[verifier]   " + m)
    integrity = "tampered"
elif planted:
    print("[verifier] %d planted checks all reported as chosen" % len(planted))

write(base_xml, declared["base"], "p2p")
write(new_xml, declared["new"], "f2p")
'''


ARTIFACTS = r'''
"""Read cargo's JSON artifact stream and print `target<TAB>executable`.

Run with `python3 -I`, like the converter, so /app is never on sys.path.
"""

import json
import sys

for path in sys.argv[1:]:
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        continue
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        target = message.get("target") or {}
        executable = message.get("executable")
        if executable and target.get("name") and "test" in (target.get("kind") or []):
            print(target["name"] + "\t" + executable)
'''


MANIFESTS = r'''
"""Refuse the manifest and cargo-config edits that would let a run grade itself.

Read with `python3 -I` so /app is never on sys.path. Three things are refused,
because everything else an author might change in a manifest is something a
solver legitimately does:

* anything that runs submitted code inside the compiler. A `build` key under
  `[package]`, `[lib]` or `[[bin]]`, because cargo runs a build script at
  compile time and the key points it at any path, so refusing the conventional
  `build.rs` filename alone refuses nothing: `build = "src/anything.rs"` is the
  same code by another name. `proc-macro = true`, because a procedural macro is
  executed by rustc itself. And the two ways a nested crate carrying either one
  gets reached, a dependency with a `path` and a `[workspace]` members list.
  None of these exists at the base commit, and none is part of implementing a
  query feature; `[dev-dependencies]` stays allowed, since writing your own
  tests is ordinary work.
* a `[[test]]` or `[[bench]]` table that sets `harness = false` or that names one
  of the graded targets. Either one lets a target print its own libtest lines, or
  points a graded name at a different file.
* a cargo config naming a `rustc-wrapper`, `runner`, `rustc` or `linker`. Those
  replace the compiler or the binary; a `[net]` or `[source]` section does not
  and is left alone, since the image itself ships one.
"""

import os
import re
import sys

root, graded = sys.argv[1], set(sys.argv[2].split())
problems = []

HEADER = re.compile(r"^\s*\[\[(test|bench)\]\]")
# Every table that may legally carry a `build` key.
BUILDABLE = re.compile(r"^\s*\[(package|lib|\[bin\])\]")
# `proc-macro = true` may appear under [lib]; a path dependency under any of the
# dependency tables except dev-dependencies, which stays allowed.
LIBTABLE = re.compile(r"^\s*\[lib\]")
DEPTABLE = re.compile(r"^\s*\[(?:target\.[^\]]+\.)?(dependencies|build-dependencies)\]")
DEPENTRY = re.compile(r"^\s*\[(?:target\.[^\]]+\.)?(?:dependencies|build-dependencies)\.[^\]]+\]")
WORKSPACE = re.compile(r"^\s*\[workspace\]")
PATHDEP = re.compile(r'path\s*=\s*"')
TABLE = re.compile(r"^\s*\[")
KEY = re.compile(r"^\s*([A-Za-z_-]+)\s*=\s*(.+?)\s*$")
REDIRECT = re.compile(r"^\s*(rustc-wrapper|rustc_wrapper|rustc-workspace-wrapper|runner|rustc|linker)\s*=")

for base, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d not in ("target", ".git")]
    for name in files:
        path = os.path.join(base, name)
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if name == "Cargo.toml":
            block = None
            buildable = False
            in_lib = False
            in_deps = False
            for line in text.splitlines():
                if HEADER.match(line):
                    block, buildable, in_lib, in_deps = {}, False, False, False
                    continue
                if WORKSPACE.match(line):
                    problems.append("%s declares a workspace" % path)
                    block, buildable, in_lib, in_deps = None, False, False, False
                    continue
                if DEPTABLE.match(line) or DEPENTRY.match(line):
                    block, buildable, in_lib, in_deps = None, False, False, True
                    continue
                if BUILDABLE.match(line):
                    block, buildable = None, True
                    in_lib = bool(LIBTABLE.match(line))
                    in_deps = False
                    continue
                if TABLE.match(line):
                    block, buildable, in_lib, in_deps = None, False, False, False
                    continue
                if in_deps and PATHDEP.search(line):
                    problems.append(
                        "%s depends on a crate by path: %s" % (path, line.strip()))
                if in_lib and re.match(r"^\s*proc-macro\s*=\s*true", line):
                    problems.append("%s declares a procedural macro" % path)
                found = KEY.match(line)
                if not found:
                    continue
                key, value = found.group(1), found.group(2).strip().strip('"')
                if buildable and key == "build" and not value.startswith("false"):
                    problems.append(
                        "%s points a build script at %s" % (path, value))
                if block is None:
                    continue
                if key == "harness" and value.startswith("false"):
                    problems.append("%s declares a test target with harness = false" % path)
                if key == "name" and value in graded:
                    problems.append("%s declares a target named %s" % (path, value))
        elif name.startswith("config") and os.path.basename(base) == ".cargo":
            for line in text.splitlines():
                if REDIRECT.match(line):
                    problems.append("%s redirects the compiler or the test runner" % path)

for problem in problems:
    print(problem)
'''


BLOCK = """{start}
{defs}# Rust, and the two facts below decide everything about this block. Both were
# measured on this repository at its base commit, not assumed.
#
# A test target that does not compile reports NO ids at all, rather than
# failing ones. So the graded id set cannot come from what a run said: it comes
# from /tests/config.json, which lives in the verifier image rather than in
# /app, and any declared id that did not report is published as failed.
#
# And `--tests` globs every target under tests/. One target that will not build
# aborts the whole invocation before any other target reports, which at the
# base commit takes the pass-to-pass set from 102 ids to 0. Every target below
# is therefore named on its own.

require_cmd() {{ command -v "$1" >/dev/null 2>&1 || {{ log "ERROR: missing $1"; exit 127; }}; }}
require_cmd python3

# tests/Dockerfile installs python3 when the environment image lacks it, and
# says nothing about a Rust toolchain, so cargo is looked for rather than
# assumed. Rust images commonly put it somewhere PATH does not reach in a
# non-login shell, so the usual homes are tried before giving up.
CARGO=""
for _c in cargo /usr/local/cargo/bin/cargo "$HOME/.cargo/bin/cargo" \
          /root/.cargo/bin/cargo /usr/local/bin/cargo /usr/bin/cargo; do
  if command -v "$_c" >/dev/null 2>&1; then CARGO="$_c"; break; fi
done
TOOLCHAIN=present
if [ -z "$CARGO" ]; then
  # Exiting here would write no report at all, which reads as a broken
  # verifier rather than a failed run. Publish every declared id as failed and
  # say plainly why, so the cause is in the log instead of inferred from a
  # silence.
  log "ERROR: no cargo on PATH or in any usual location; nothing can be built"
  TOOLCHAIN=missing
else
  log "cargo: $CARGO"
fi

# Captured output lands somewhere the code under test is never told about.
GRADE_ROOT="$(mktemp -d 2>/dev/null || echo /tmp/grade.$$)"
mkdir -p "$GRADE_ROOT" 2>/dev/null || true
# 0711, not 0700: the unprivileged user has to be able to traverse into the
# run directory below, while still being unable to list this one or read the
# private copy of the declared ids, which stays 0600 and root-owned.
chmod 0711 "$GRADE_ROOT" 2>/dev/null || true

# Build artifacts stay outside /app so a read-only checkout still runs, and so
# nothing a build writes lands beside the sources being graded.
CARGO_TARGET_DIR="$(mktemp -d 2>/dev/null || echo /tmp/target.$$)"
export CARGO_TARGET_DIR
export CARGO_TERM_COLOR=never
export RUST_BACKTRACE=0
# A submitted `.cargo/config.toml` or an inherited wrapper variable would let
# the tree under test choose the compiler that builds the harness grading it.
# The config file is refused below; the variables are dropped here. Dropped,
# never set empty: cargo would then try to exec an empty path.
unset RUSTC_WRAPPER RUSTC_WORKSPACE_WRAPPER CARGO_BUILD_RUSTC \
      CARGO_BUILD_RUSTC_WRAPPER CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER 2>/dev/null || true

# The declared id set is copied out of /tests before a single line of the
# submission runs, and every later read is of the copy. tests/config.json is
# root-owned and writable, and the code under test runs in this container too,
# so leaving the authority on grading in a file it could rewrite would let a
# submission edit its own whitelist. The copy sits under a directory it is not
# told about and cannot traverse.
# Cargo writes Cargo.lock beside the manifest, and /app is not always writable:
# the frame allows this block to run as a user that does not own it. Building
# from a private copy fixes that, and pays twice over -- the sources a compiler
# reads are then somewhere the submission cannot reach at all, so a library that
# rewrites its own test files at run time is not merely detected, it is writing
# to a copy no compiler will ever open.
BUILD_DIR="$GRADE_ROOT/app"
if cp -a /app "$BUILD_DIR" 2>/dev/null; then
  log "building from a private copy"
else
  BUILD_DIR=/app
  log "note: could not copy /app; building in place"
fi

CONFIG="$GRADE_ROOT/declared.json"
cp /tests/config.json "$CONFIG" 2>/dev/null || CONFIG=/tests/config.json
chmod 0600 "$CONFIG" 2>/dev/null || true

# Test binaries are executed from here, not from $GRADE_ROOT, because they run
# as an unprivileged user that must be able to reach them.
RUN_DIR="$GRADE_ROOT/run"
mkdir -p "$RUN_DIR" 2>/dev/null || RUN_DIR="$GRADE_ROOT"
chmod 0777 "$RUN_DIR" 2>/dev/null || true

# Compiling is NOT safe as root. cargo runs a build script at compile time, and
# a manifest can point one at any path, so a compile carries submitted code as
# surely as a run does. Both are therefore dropped to an unprivileged user,
# which is what keeps /tests (root-owned, 0600) out of reach of anything the
# submission can arrange to execute. Build scripts are refused outright above;
# this is the second lock on the same door. If no way to drop privilege exists
# in this image, the run still happens and says so, because refusing outright
# would score an honest reference solution zero.
# Compiling and running are given DIFFERENT unprivileged identities, and that
# separation is what keeps the graded sources out of reach. The compiler must
# read them; the test binaries must not, because their names are what a run has
# to account for. One shared `nobody` would hand the runner everything the
# compiler can see. So the private tree belongs to the compile user and is
# closed to everyone else, and the run user gets executables and nothing else.
DROP=""
DROP_UID=65534
COMPILE_DROP=""
COMPILE_UID=65533
if command -v setpriv >/dev/null 2>&1 &&
   setpriv --reuid=$DROP_UID --regid=$DROP_UID --clear-groups true 2>/dev/null; then
  DROP="setpriv --reuid=$DROP_UID --regid=$DROP_UID --clear-groups"
  if setpriv --reuid=$COMPILE_UID --regid=$COMPILE_UID --clear-groups true 2>/dev/null; then
    COMPILE_DROP="setpriv --reuid=$COMPILE_UID --regid=$COMPILE_UID --clear-groups"
  fi
elif command -v runuser >/dev/null 2>&1 && runuser -u nobody -- true 2>/dev/null; then
  DROP="runuser -u nobody --"
fi
# Without a second identity the compile still drops, to the same user as the
# run. That is weaker and says so, rather than silently compiling as root.
if [ -z "$COMPILE_DROP" ]; then
  COMPILE_DROP="$DROP"
  COMPILE_UID="$DROP_UID"
fi
if [ -n "$DROP" ]; then
  log "test binaries run as uid $DROP_UID; compiles run as uid $COMPILE_UID"
else
  log "note: no way to drop privilege here; both run as the current user"
fi

# cargo insists on a home it can write, even offline and with no dependencies
# to fetch. It belongs to the compile user and never sits under /app.
CARGO_SCRATCH="$GRADE_ROOT/cargo"
mkdir -p "$CARGO_SCRATCH/home" 2>/dev/null || CARGO_SCRATCH="$GRADE_ROOT"
chown -R "$COMPILE_UID" "$CARGO_SCRATCH" 2>/dev/null || chmod -R 0777 "$CARGO_SCRATCH" 2>/dev/null || true
chmod -R go-rwx "$CARGO_SCRATCH" 2>/dev/null || true
chmod u+rwX "$CARGO_SCRATCH" 2>/dev/null || true

# Compiled binaries are copied here to be executed. Root owns it and only root
# may write, so a process left behind by an earlier target cannot swap a later
# target's executable for one that prints whatever transcript it likes.
BIN_DIR="$GRADE_ROOT/bin"
mkdir -p "$BIN_DIR" 2>/dev/null || BIN_DIR="$RUN_DIR"
chmod 0755 "$BIN_DIR" 2>/dev/null || true

BASE_XML=/logs/verifier/base.xml
NEW_XML=/logs/verifier/new.xml
mkdir -p /logs/verifier 2>/dev/null || true
# The reports are written here by this block, running as root, and read by the
# grader. Nothing the submission can arrange to execute runs as root any more,
# so denying write to everyone else is what stops a straggler replacing a
# report between the last check and the grade. Ownership is not assumed: if the
# image handed this directory over world-writable, it does not stay that way.
chmod 0755 /logs/verifier 2>/dev/null || true
# A file already sitting at a report path is harmless, since the converter runs
# as root and overwrites it. A DIRECTORY there is not: the write throws, no
# report exists, and the log says nothing about why. Clearing both paths first
# costs nothing and keeps the failure legible.
rm -rf "$BASE_XML" "$NEW_XML" 2>/dev/null || true

INTEGRITY=intact

# /tests holds the declared id list and the grader. This block reads both as
# root and nothing else needs them, while the code under test runs in this same
# container, so they are closed to everyone else before a line of it runs.
chmod 0600 /tests/config.json /tests/grader.py 2>/dev/null || true

# The verifier's own files are verifier-side mutable state too. Grading must not
# depend on anything the submission could have changed, and /tests is writable by
# a root process. Nothing here is hardcoded: the digests are taken now, before a
# line of the submission has run, so a platform-side change to grader.py cannot
# make this misfire. Dropping privilege below is the real defence; this is what
# still speaks if no way to drop it exists in this image.
digest_of() {{
  python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1" 2>/dev/null
}}
TESTS_GRADER="$(digest_of /tests/grader.py)"
TESTS_CONFIG="$(digest_of /tests/config.json)"
TESTS_SCRIPT="$(digest_of /tests/test.sh)"
verify_tests_dir() {{
  for _pair in "grader.py:$TESTS_GRADER" "config.json:$TESTS_CONFIG" "test.sh:$TESTS_SCRIPT"; do
    _f="/tests/${{_pair%%:*}}"; _want="${{_pair##*:}}"
    [ -n "$_want" ] || continue
    if [ "$(digest_of "$_f")" != "$_want" ]; then
      log "INTEGRITY[$1]: $_f changed under the verifier"
      INTEGRITY=tampered
    fi
  done
}}

# The graded inputs, pinned by content. Cargo.toml is among them because a
# [[test]] entry carrying `harness = false` would let a target print its own
# "test ... ok" lines and grade itself.
check_pin() {{
  actual="$(python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1" 2>/dev/null)"
  if [ "$actual" != "$2" ]; then
    log "INTEGRITY[$3]: $1 does not match its pinned digest"
    INTEGRITY=tampered
  fi
}}
verify_pins() {{
{pins}
}}
# Digests for the two graded files, taken after the canaries are planted, and
# for the copies once they are moved out of /app.
GRADED_PINS=""
regrade() {{
  GRADED_PINS=""
  for _f in {f2p_files}; do
    GRADED_PINS="$GRADED_PINS $_f:$(digest_of "$BUILD_DIR/$_f")"
  done
}}
verify_graded() {{
  for _pair in $GRADED_PINS; do
    _f="${{_pair%%:*}}"; _want="${{_pair##*:}}"
    if [ "$(digest_of "$BUILD_DIR/$_f")" != "$_want" ]; then
      log "INTEGRITY[$1]: $_f changed after it was pinned"
      INTEGRITY=tampered
    fi
  done
}}
verify_moved() {{
  if [ "${{SOURCES_MOVED:-no}}" != yes ]; then
    verify_graded "$1"
    return
  fi
  for _pair in $GRADED_PINS; do
    _f="${{_pair%%:*}}"; _want="${{_pair##*:}}"
    if [ "$(digest_of "$SRC_KEEP/${{_f##*/}}")" != "$_want" ]; then
      log "INTEGRITY[$1]: ${{_f##*/}} changed while held aside"
      INTEGRITY=tampered
    fi
  done
  # And nothing may have put a graded source back where a compiler would look.
  for _f in {f2p_files}; do
    if [ -e "$BUILD_DIR/$_f" ]; then
      log "INTEGRITY[$1]: $_f reappeared after it was moved"
      INTEGRITY=tampered
    fi
  done
}}
# The inherited targets are put back exactly as the base commit has them,
# before a single one is compiled. A solver adding a case to tests/joins.rs
# while implementing joins is ordinary work, so a digest over these files would
# fire on honest submissions; a checkout undoes the edit instead. It closes the
# same hole from the other side too, since a base suite that was gutted to hide
# a regression is replaced rather than believed.
BASE_SHA={base_sha}
BASE_REF=""
if command -v git >/dev/null 2>&1; then
  git config --global --add safe.directory "$BUILD_DIR" 2>/dev/null || true
  if git -C "$BUILD_DIR" rev-parse --verify -q "$BASE_SHA^{{commit}}" >/dev/null 2>&1; then
    BASE_REF="$BASE_SHA"
  else
    # The task's own base commit is what /app is checked out at, so this is the
    # ordinary path. A tree that does not carry that commit is a local harness
    # rather than the platform, and its first commit is the base tree; falling
    # back to it keeps this code exercised where it can be tested.
    BASE_REF="$(git -C "$BUILD_DIR" rev-list --max-parents=0 HEAD 2>/dev/null | tail -1)"
    [ -n "$BASE_REF" ] && log "note: $BASE_SHA is not in this checkout; restoring from root commit $BASE_REF"
  fi
fi
if [ -n "$BASE_REF" ]; then
  for _f in {restored_files}; do
    git -C "$BUILD_DIR" checkout "$BASE_REF" -- "$_f" 2>/dev/null \
      || log "note: could not restore $_f; grading it as the submission left it"
  done
  log "inherited suites restored from $BASE_REF"
else
  log "note: no usable git base here; inherited suites are graded as the submission left them"
fi

verify_pins before
verify_tests_dir before

# Before anything is compiled, a handful of extra cases are appended to each
# graded file. Their names are drawn here, and whether each one passes is
# decided here. A run is believed only when it accounts for every one of them
# with the outcome that was chosen, so a transcript has to come from the cases
# that were actually built.
CANARIES=""
plant_canaries() {{
  for _f in {f2p_files}; do
    _i=0
    while [ "$_i" -lt 3 ]; do
      _nm="verifies_$(head -c 6 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo 0000)$_i"
      if [ "$(( $(head -c 1 /dev/urandom 2>/dev/null | od -An -tu1 | tr -d ' ' || echo 0) % 2 ))" -eq 0 ]; then
        _want=ok; _body=true
      else
        _want=FAILED; _body=false
      fi
      printf '\n#[test]\nfn %s() {{ assert!(%s); }}\n' "$_nm" "$_body" >> "$BUILD_DIR/$_f" 2>/dev/null || true
      if grep -q "fn $_nm()" "$BUILD_DIR/$_f" 2>/dev/null; then
        CANARIES="$CANARIES ${{_f##*/}}:$_nm:$_want"
      fi
      _i=$((_i + 1))
    done
  done
}}
plant_canaries
if [ -z "$CANARIES" ]; then
  log "note: could not plant checks in /app; falling back to pinned sources alone"
fi

# The graded files have legitimately changed now, so their pins are retaken
# here and every later check is against these.
{regraded}

# Footholds that do not exist at the base commit, so their presence is
# tampering rather than a build. A build script runs arbitrary code at compile
# time, and a toolchain file chooses the compiler.
for _p in {refused}; do
  if [ -e "/app/$_p" ]; then
    log "INTEGRITY: /app/$_p is present and is not part of this repository"
    INTEGRITY=tampered
  fi
done

# A build script does not have to sit at the package root or be called
# build.rs, so the name is refused wherever it appears and the manifest key
# that would point one somewhere else is refused below. This repository ships
# no build script at all, so any hit here is an addition.
_stray="$(find /app -name build.rs -not -path '*/target/*' -not -path '*/.git/*' 2>/dev/null)"
if [ -n "$_stray" ]; then
  printf '%s\n' "$_stray" | while IFS= read -r _line; do
    [ -n "$_line" ] && log "INTEGRITY: $_line is a build script and is not part of this repository"
  done
  INTEGRITY=tampered
fi

# Manifests and cargo configs are read rather than pinned, because adding a
# dev-dependency is a normal thing to do and content-pinning a manifest turns
# that into a zero. Only the parts that would let a run grade itself are
# refused: a test target declaring its own harness or claiming a graded name,
# and a cargo config that replaces the compiler or the test runner.
_manifest_report="$(printf '%s' "$MANIFESTS_SRC" | python3 -I - "/app" "{graded_names}" 2>/dev/null)"
if [ -n "$_manifest_report" ]; then
  printf '%s\n' "$_manifest_report" | while IFS= read -r _line; do
    [ -n "$_line" ] && log "INTEGRITY: $_line"
  done
  INTEGRITY=tampered
fi

# Compiling and running are separate phases, and the order is load bearing.
#
# `cargo test --test X` compiles X and then runs it, and running it executes
# code from the submission. Every graded binary is therefore built first, while
# nothing from the submission has run, and the binaries are then executed
# DIRECTLY. cargo is never invoked again, so the bytes each graded binary was
# compiled from are the bytes pinned above.
compile_set() {{
  # $1 = label, $2 = space-separated target names. One cargo call per target:
  # a target that will not build must not take the others down with it, which
  # is what `--tests` would do. Every call is dropped to the unprivileged user,
  # so a build script that got past the refusals above still cannot read or
  # write anything the grading depends on.
  : > "$GRADE_ROOT/$1.json"
  [ "$INTEGRITY" = intact ] && [ "$TOOLCHAIN" = present ] || return 0
  for _target in $2; do
    $COMPILE_DROP env HOME="$CARGO_SCRATCH" CARGO_HOME="$CARGO_SCRATCH/home" \
      CARGO_TARGET_DIR="$CARGO_TARGET_DIR" CARGO_TERM_COLOR=never RUST_BACKTRACE=0 \
      "$CARGO" test --manifest-path "$BUILD_DIR/Cargo.toml" --offline --no-run \
      --message-format=json --test "$_target" \
      >> "$GRADE_ROOT/$1.json" 2>> "$RUN_LOG" || true
  done
}}

CAPTURES=""
run_target() {{
  # $1 = which report, $2 = target name
  _out="$GRADE_ROOT/$1.$2.txt"
  _lst="$GRADE_ROOT/$1.$2.list"
  _log="$RUN_DIR/$(head -c 12 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo log).log"
  : > "$_out"; : > "$_lst"
  _exe=""
  while IFS="$(printf '\t')" read -r _name _path; do
    if [ "$_name" = "$2" ]; then _exe="$_path"; break; fi
  done < "$GRADE_ROOT/exes.txt"
  if [ -n "$_exe" ] && [ -x "$_exe" ]; then
    # The binary is copied to a name that says nothing about which target it
    # is, and run from there, so nothing in the run identifies the selection
    # except the cases the binary itself owns. What is left
    # is disagreeing with the listing below, which is checked.
    _run="$BIN_DIR/$(head -c 12 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo bin)$1"
    cp "$_exe" "$_run" 2>/dev/null && chmod 0755 "$_run" 2>/dev/null || _run="$_exe"
    # Listing first. It executes no test, so nothing from the submission has
    # run when this is written, and it is what the reported names are held to.
    $DROP "$_run" --list > "$_lst" 2>/dev/null || true
    # libtest writes its own verdict file when the toolchain still offers one.
    # It is a second channel, and a run is believed only where it agrees with
    # stdout case for case.
    if "$_run" --help 2>/dev/null | grep -q -- --logfile; then
      $DROP "$_run" --test-threads=1 --logfile "$_log" > "$_out" 2>&1 || true
    else
      log "note: this libtest has no --logfile; stdout is the only channel"
      $DROP "$_run" --test-threads=1 > "$_out" 2>&1 || true
    fi
  else
    log "target $2 produced no test binary"
  fi
  # Whatever this target left running goes before the next one starts, so a
  # surviving process cannot touch a later target or the reports.
  if [ -n "$DROP" ]; then
    pkill -9 -u "$DROP_UID" 2>/dev/null || true
  fi
  CAPTURES="$CAPTURES $1:$2:$_out:$_lst:$_log"
}}

# The held-out targets are compiled and run BEFORE anything else. Compiling a
# target executes no code from /app -- there is no build.rs and no proc macro
# here, and both are refused above -- so at this point nothing of the
# submission has run yet and the sources cargo reads are the pinned ones.
set +e
# The private tree is handed to the compile user and closed to everyone else.
# Ownership rather than a mode bit: `a+rwX` would have made the planted sources
# and the canary names in them readable by the user the test binaries run as,
# which is precisely what they must not be.
chown -R "$COMPILE_UID" "$BUILD_DIR" "$CARGO_TARGET_DIR" 2>/dev/null \
  || chmod -R a+rwX "$BUILD_DIR" "$CARGO_TARGET_DIR" 2>/dev/null || true
chmod -R go-rwx "$BUILD_DIR" 2>/dev/null || true
chmod -R go-rwx "$CARGO_TARGET_DIR" 2>/dev/null || true
# Even the compile user has no business writing the graded sources: it has to
# read them to compile them and nothing more.
chmod -R a-w "$BUILD_DIR/tests" 2>/dev/null || true

# The held-out pair is built first, on its own, so a target that will not
# compile cannot take the existing targets down with it.
compile_set graded "{f2p_names}"
verify_graded compiled
compile_set existing "{p2p_names}"
# Compilation is over, so the tree goes back to root and the binaries stop
# being writable by anyone but root. Read and execute is all the run user ever
# needs, and it is all it gets: a writable executable between here and
# run_target is a transcript waiting to be rewritten.
chown -R 0:0 "$BUILD_DIR" "$CARGO_TARGET_DIR" 2>/dev/null || true
chmod -R go-w "$CARGO_TARGET_DIR" 2>/dev/null || true
chmod -R a+rX "$CARGO_TARGET_DIR" 2>/dev/null || true
chmod -R go-w "$CARGO_TARGET_DIR" 2>/dev/null || true
# Anything the compile user left running goes now, before a single test binary
# is executed, so it cannot be the thing that swaps one.
if [ -n "$COMPILE_DROP" ] && [ "$COMPILE_UID" != "$DROP_UID" ]; then
  pkill -9 -u "$COMPILE_UID" 2>/dev/null || true
fi

# Every target is built now, so the sources have no further use in /app.
# Holding them where only root can reach them removes the route that reads the
# case names straight off disk, and nothing a binary needs goes with them.
SRC_KEEP="$GRADE_ROOT/sources"
SOURCES_MOVED=no
mkdir -p "$SRC_KEEP" 2>/dev/null && chmod 0700 "$SRC_KEEP" 2>/dev/null || true
for _f in {all_test_files}; do
  mv "$BUILD_DIR/$_f" "$SRC_KEEP/${{_f##*/}}" 2>/dev/null && SOURCES_MOVED=yes
done
[ "$SOURCES_MOVED" = yes ] || log "note: graded sources could not be moved aside"
printf '%s' "$ARTIFACTS_SRC" | python3 -I - "$GRADE_ROOT/graded.json" "$GRADE_ROOT/existing.json" \
  > "$GRADE_ROOT/exes.txt" 2>/dev/null || : > "$GRADE_ROOT/exes.txt"

{runs}
set -e

# Read a third time, after everything has run. The binaries are already fixed
# by this point, so this no longer guards the graded set; it records a tree
# that rewrote its own sources during the run, which is worth failing on its
# own account.
# A test can leave a child behind to rewrite a report after this block has
# written it. Everything the submission ran was unprivileged, so everything it
# left behind is owned by that user and goes now, before any report exists.
if [ -n "$DROP" ]; then
  pkill -9 -u "$DROP_UID" 2>/dev/null || true
  sleep 1
fi

verify_moved after
verify_tests_dir after

# The converter is fed on stdin so it never touches disk, and read with -I so
# /app cannot shadow a module it imports.
printf '%s' "$CONVERTER_SRC" | python3 -I - "$CONFIG" "$BASE_XML" "$NEW_XML" "$INTEGRITY" "$CANARIES" $CAPTURES

# Raw output belongs in the canonical log whatever happened above.
for _c in $CAPTURES; do
  _f="${{_c##*:}}"
  [ -s "$_f" ] || continue
  echo "===== cargo: ${{_c%%:*}} ${{_f##*/}} =====" >> "$RUN_LOG" 2>/dev/null
  cat "$_f" >> "$RUN_LOG" 2>/dev/null
done
{end}"""


def main() -> int:
    frame = FRAME.read_text()
    if START not in frame or END not in frame:
        print("frame is missing its markers")
        return 1
    head, rest = frame.split(START, 1)
    _, tail = rest.split(END, 1)

    # The draft's frame and the canonical one must agree everywhere we are not
    # allowed to write. If they ever stop agreeing, that is the platform
    # changing the frame and it has to be looked at rather than papered over.
    canon = CANONICAL.read_text()
    c_head, c_rest = canon.split(START, 1)
    _, c_tail = c_rest.split(END, 1)
    if (head, tail) != (c_head, c_tail):
        print("the draft frame differs from original_test.sh outside the markers")
        return 1

    # The pinned bytes are read out of the `tests` branch, which is the branch
    # test.patch is generated from. Hashing a working-tree copy instead would
    # let the two drift, and a pin that disagrees with what the patch installs
    # reads as tampering at run time and fails every id.
    pins = []
    for rel in PINNED:
        blob = subprocess.run(
            ["git", "-C", str(BUILD), "show", f"tests:{rel}"],
            capture_output=True,
        )
        if blob.returncode != 0 or not blob.stdout:
            print(f"pinned file missing from the tests branch: {rel}")
            return 1
        digest = hashlib.sha256(blob.stdout).hexdigest()
        pins.append(f'  check_pin "/app/{rel}" {digest} "$1"')

    runs = []
    for target in F2P_TARGETS:
        runs.append(f'run_target new {target}')
    for target in P2P_TARGETS:
        runs.append(f'run_target base {target}')

    # Held-back files: the ones the verifier image puts on disk. Canaries are
    # planted in these and only these, because they are the files the run has
    # to account for and the only ones no honest submission wrote.
    held_out = list(PINNED)
    if len(held_out) != len(F2P_TARGETS):
        print("every held-back target needs exactly one pinned file")
        return 1

    definitions = (
        "CONVERTER_SRC=$(cat <<'PYEOF'\n" + CONVERTER.strip("\n") + "\nPYEOF\n)\n"
        "ARTIFACTS_SRC=$(cat <<'ARTEOF'\n" + ARTIFACTS.strip("\n") + "\nARTEOF\n)\n"
        "MANIFESTS_SRC=$(cat <<'MANEOF'\n" + MANIFESTS.strip("\n") + "\nMANEOF\n)\n"
    )
    block = BLOCK.format(
        defs=definitions,
        start=START,
        end=END,
        pins="\n".join(pins),
        refused=" ".join(REFUSED),
        runs="\n".join(runs),
        f2p_names=" ".join(F2P_TARGETS),
        p2p_names=" ".join(P2P_TARGETS),
        f2p_files=" ".join(held_out),
        all_test_files=" ".join(held_out + RESTORED),
        regraded="regrade",
        graded_names=" ".join(F2P_TARGETS + P2P_TARGETS),
        base_sha=BASE_SHA,
        restored_files=" ".join(RESTORED),
    )

    # Everything outside the markers is the frame, byte for byte. The inline
    # programs live inside the block, the only region an author may write:
    # "tests/test.sh must begin with the canonical frame" is a blocking check,
    # and a shell variable defined above the marker fails it.
    body = head + block + tail

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(body)

    # The frame outside the markers must be byte-identical.
    written = OUT.read_text()
    w_head, w_rest = written.split(START, 1)
    _, w_tail = w_rest.split(END, 1)
    assert w_head == head, "bytes above the marker moved"
    assert w_tail == tail, "bytes below the marker moved"
    assert written.startswith(head), "test.sh no longer begins with the frame"

    print(f"wrote {OUT.relative_to(HERE)} ({len(body)} bytes)")
    print(f"  pinned {len(PINNED)} files")
    print(f"  {len(P2P_TARGETS)} p2p targets, {len(F2P_TARGETS)} f2p targets")
    print(f"  canaries planted in {len(held_out)} held-back files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
