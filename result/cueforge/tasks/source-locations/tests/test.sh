#!/bin/bash
# Verifier entrypoint (canonical frame). Patching and grading live in
# tests/grader.py; this script owns the task-specific part: run the suites,
# write machine-readable reports under /logs/verifier/, and apply any report
# fixups before grading. Edit ONLY between the RUN TESTS markers.
set -uo pipefail
trap 'if [ ! -f /logs/verifier/reward.json ] && [ ! -f /logs/verifier/reward.txt ]; then mkdir -p /logs/verifier; echo -1 > /logs/verifier/reward.txt; fi' EXIT
log() { echo "[verifier] $*"; }
cd /app || { mkdir -p /logs/verifier; exit 6; }

python3 /tests/grader.py prepare || exit $?
[ -f /logs/verifier/reward.json ] && exit 0   # model.patch didn't apply -> graded 0

# Canonical raw-output log: send every suite's combined stdout+stderr here
# (use run_log, or pipe through tee -a "$RUN_LOG" when feeding a reporter) so
# the reason a test failed is never lost. Never silence a test run.
export RUN_LOG=/logs/verifier/run.log
: > "$RUN_LOG" 2>/dev/null || true
run_log() { echo "+ $*" >> "$RUN_LOG" 2>/dev/null; "$@" 2>&1 | tee -a "$RUN_LOG"; return "${PIPESTATUS[0]}"; }

# >>> RUN TESTS (task-specific) <<<
require_cmd() { command -v "$1" >/dev/null 2>&1 || { log "ERROR: missing $1"; exit 127; }; }
require_cmd python3
# `-I` so this answers for the installed pytest and not for one the
# submission put on the path; the suites run the same way, below.
python3 -I -c 'import pytest' >/dev/null 2>&1 || { log "ERROR: pytest is unavailable"; exit 127; }

SCRATCH="$(mktemp -d /tmp/verifier.XXXXXXXX)" || { log "ERROR: no writable temp dir"; exit 6; }
# One word per run.  The runner reads it from stdin before anything under
# /app can be imported and signs its report with it; nothing in argv or the
# environment carries it, so code under test cannot learn it by looking.
TOKEN="$(python3 -I -c 'import secrets; print(secrets.token_hex(24))')"

# Fail closed: whatever refuses a run publishes every declared id as failed,
# so the grader always has a report to read and an empty /logs/verifier can
# never be mistaken for a verifier that fell over.
publish_failed() {  # $1 reason, $2.. report basenames
  python3 -I - "$@" <<'PUBLISH_PY'
import json, os, sys
from xml.sax.saxutils import quoteattr
reason, names = sys.argv[1], sys.argv[2:]
cfg = json.load(open("/tests/config.json", encoding="utf-8"))
ids = {"base.xml": cfg.get("p2p_node_ids", []), "new.xml": cfg.get("f2p_node_ids", [])}
os.makedirs("/logs/verifier", exist_ok=True)
for name in names:
    lines = ['<?xml version="1.0" encoding="utf-8"?>', '<testsuites><testsuite name="verifier">']
    for nid in ids.get(name, []):
        cls, _, case = nid.rpartition(".")
        lines.append("<testcase classname=%s name=%s><failure message=%s /></testcase>"
                     % (quoteattr(cls), quoteattr(case), quoteattr(reason)))
    lines.append("</testsuite></testsuites>")
    path = os.path.join("/logs/verifier", name)
    try:
        os.chmod(path, 0o644)
    except OSError:
        pass
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("[verifier] published %s with every declared id failed: %s" % (name, reason), flush=True)
PUBLISH_PY
}

# What was alive before any suite ran.  Anything else still running after
# the suites is something a test left behind, and the reports it could
# rewrite sit at predictable paths that grading reads once this block ends.
python3 -I - "$SCRATCH" <<'SNAPSHOT_PY'
import os, sys
pids = sorted(int(p) for p in os.listdir("/proc") if p.isdigit())
open(os.path.join(sys.argv[1], "pids.before"), "w").write("\n".join(map(str, pids)))
SNAPSHOT_PY

# Integrity of the graded inputs. grader.py resets and re-applies test.patch,
# so the held-out files are the ones this bundle ships; it does nothing,
# though, about the repository suite that backs the pass-to-pass ids, or
# about the fixtures that suite reads, and a committed patch may edit any of
# those or drop a module where Python loads it on its own. All of it is
# handled here, before any test runs:
#
#   1. every path in config.json's frozen_files is restored from the base
#      commit, so an edit to the existing suite, its builders or the example
#      productions simply does not survive;
#   2. every name in protected_absent is deleted wherever it sits under /app
#      unless git vouches for it as tracked at the base commit --
#      sitecustomize.py and usercustomize.py matter most, since PYTHONPATH is
#      /app/src and either would be imported at interpreter start-up;
#   3. every top-level module at the repository root, or under src/, that
#      would shadow one the verifier itself imports -- pytest and its own
#      dependencies, or anything in the standard library -- is deleted on
#      the same terms;
#   4. every restored path is compared against the base commit by git
#      itself, every held-out pin is re-checked, and a difference that
#      survived the restore is graded 0 instead of run.  The sha256 pins on
#      frozen_files stand in for git only when git cannot be asked: they
#      were taken from a snapshot export, and the base commit may carry
#      different metadata in a file whose graded content is the same.
#
# The checker runs as `python3 -I`, which starts with the standard library
# and site-packages on sys.path and nothing else.  Steps 1 to 3 are
# best-effort and cannot abort the run; only step 4, a genuine grading
# condition, ends it.
python3 -I - <<'INTEGRITY_PY'
import hashlib, json, os, shutil, subprocess, sys

APP, TESTS, VERIFIER = "/app", "/tests", "/logs/verifier"
log = lambda m: print("[verifier] integrity: %s" % m, flush=True)

try:
    with open(os.path.join(TESTS, "config.json"), encoding="utf-8") as fh:
        cfg = json.load(fh)
except Exception as exc:
    log("cannot read config.json (%s); skipping" % exc)
    sys.exit(0)

base = cfg.get("base_commit") or ""
frozen = cfg.get("frozen_files", {})
held = cfg.get("held_out_files", {})


# `safe.directory=*` so a verifier that runs as another user than the one
# who owns /app is still answered by git rather than refused; nothing the
# submission ships can reach the repository objects behind it.
GIT = ("git", "-C", APP, "-c", "safe.directory=*")


def git(*args):
    try:
        return subprocess.run(GIT + args, capture_output=True, timeout=120).returncode
    except Exception:
        return 1


have_git = base and git("cat-file", "-e", base) == 0

# 1. restore the existing suite and its inputs from the base commit
if have_git and frozen:
    paths = sorted(frozen)
    if git("checkout", base, "--", *paths) == 0:
        log("restored %d frozen files from %s" % (len(paths), base[:12]))
    else:
        for rel in paths:
            git("checkout", base, "--", rel)
        log("restored frozen files individually from %s" % base[:12])
elif frozen:
    log("git unavailable; frozen files verified by digest only")

# 2. drop anything Python or pytest would load of its own accord
for name in cfg.get("protected_absent", []):
    for dirpath, _dirs, files in os.walk(APP):
        if os.path.basename(name) not in files:
            continue
        full = os.path.join(dirpath, os.path.basename(name))
        rel = os.path.relpath(full, APP)
        if have_git and git("cat-file", "-e", "%s:%s" % (base, rel)) == 0:
            log("keeping %s (tracked at the base commit)" % rel)
            continue
        try:
            os.remove(full)
            log("removed foreign import hook: %s" % rel)
        except OSError as exc:
            log("could not remove %s: %s" % (rel, exc))

# 3. and any top-level name that shadows a module the verifier imports.
#    sys.path here holds the standard library and site-packages only, so
#    listing it names exactly what a file dropped at /app or /app/src could
#    displace.  A name the repository legitimately owns is tracked at the
#    base commit; the framework's own names are not repository names at
#    all, so those go even when git cannot be asked.
shadowable = set(getattr(sys, "stdlib_module_names", ())) | set(sys.builtin_module_names)
for directory in sys.path:
    try:
        entries = os.listdir(directory)
    except OSError:
        continue
    for entry in entries:
        if entry.endswith((".py", ".so", ".pyd")):
            shadowable.add(entry.split(".", 1)[0])
        elif os.path.isfile(os.path.join(directory, entry, "__init__.py")):
            shadowable.add(entry)

FRAMEWORK = frozenset({"pytest", "_pytest", "py", "pluggy", "iniconfig",
                       "packaging", "tomli", "exceptiongroup", "pygments",
                       "attr", "attrs", "hypothesis", "sitecustomize", "usercustomize"})

for top in (APP, os.path.join(APP, "src")):
    try:
        listing = sorted(os.listdir(top))
    except OSError:
        continue
    for entry in listing:
        full = os.path.join(top, entry)
        if entry.endswith(".py") and os.path.isfile(full):
            name = entry[:-3]
        elif os.path.isdir(full) and os.path.isfile(os.path.join(full, "__init__.py")):
            name = entry
        else:
            continue
        if name not in shadowable and name not in FRAMEWORK:
            continue
        rel = os.path.relpath(full, APP)
        if have_git:
            if git("cat-file", "-e", "%s:%s" % (base, rel)) == 0:
                log("keeping %s (tracked at the base commit)" % rel)
                continue
        elif name not in FRAMEWORK:
            log("git unavailable; leaving %s in place" % rel)
            continue
        try:
            if os.path.isdir(full):
                shutil.rmtree(full)
            else:
                os.remove(full)
            log("removed shadowing module: %s" % rel)
        except OSError as exc:
            log("could not remove %s: %s" % (rel, exc))

# 4. git decides for what it restored; the pins decide for the rest
def digest(rel):
    try:
        with open(os.path.join(APP, rel), "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None


def differs_from_base(paths):
    try:
        run = subprocess.run(GIT + ("diff", "--name-only", base, "--", *paths),
                             capture_output=True, text=True, timeout=120)
    except Exception:
        return None
    if run.returncode != 0:
        return None
    return sorted(set(run.stdout.split()))


bad = []
frozen_by_git = differs_from_base(sorted(frozen)) if have_git and frozen else None
if frozen_by_git is None:
    bad += [rel for rel, want in sorted(frozen.items()) if digest(rel) != want]
else:
    bad += frozen_by_git
bad += [rel for rel, want in sorted(held.items()) if digest(rel) != want]
if bad:
    log("ALTERED: %s" % ", ".join(bad[:10]))
    sys.exit(9)
how = "by git against %s" % base[:12] if frozen_by_git is not None else "by digest"
log("%d frozen files verified %s; %d held-out files verified by digest" % (len(frozen), how, len(held)))
INTEGRITY_PY
INTEGRITY_STATUS=$?
if [ "$INTEGRITY_STATUS" = 9 ]; then
  publish_failed "graded inputs were altered after the base commit" base.xml new.xml
fi

# Each suite runs in its own `python3 -I` process: isolated mode leaves the
# standard library and site-packages on sys.path and nothing else -- not the
# working directory, not the script's directory, not PYTHONPATH -- so pytest
# is the one the image installed.  /app/src and /app are put in front only
# afterwards, which is what `import cueforge` and `import test_lab` need
# and leaves nothing the submission ships in front of the framework.  The
# runner does not take that on trust: it checks where pytest actually came
# from, and it writes the graded report itself from the run's own outcomes.
cat > "$SCRATCH/run_suite.py" <<'RUN_SUITE_PY'
"""Run one graded suite under the installed pytest, never a submitted one.

argv: <scratch-dir> <report-name> <test-file>...
stdin: the run's token, one line, read before anything under /app can load.

The report is written to the scratch directory only, and signed with the
token; the shell copies it to /logs/verifier once the signature checks.  A
module under test that writes a report of its own and leaves early has no
token to sign it with, and the shell then publishes every id as failed.
"""

import hashlib
import importlib.util
import os
import sys

APP = "/app"
sys.dont_write_bytecode = True


def refuse(message):
    print("[verifier] runner: %s" % message, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(9)


def main(token):
    scratch, name = sys.argv[1], sys.argv[2]
    test_files = sys.argv[3:]
    if not token:
        refuse("no token on stdin")
    import pytest
    import _pytest
    import pluggy

    for module in (pytest, _pytest, pluggy):
        origin = os.path.realpath(getattr(module, "__file__", "") or "")
        if not origin or origin == APP or origin.startswith(APP + os.sep):
            refuse("%s resolved to %s" % (module.__name__, origin or "<unknown>"))
    print("[verifier] runner: pytest %s from %s" % (pytest.__version__,
                                                    os.path.dirname(pytest.__file__)),
          flush=True)

    # The suites are the runner's own session: anything they fork inherits this
    # group and is ended with it once the reports are written.
    try:
        os.setsid()
        with open(os.path.join(scratch, name + ".pgid"), "w") as handle:
            handle.write(str(os.getpgid(0)))
    except OSError:
        pass


    class Tally:
        """Count outcomes inside the process that actually ran the tests."""

        def __init__(self):
            self.ids = set()
            self.collect_failures = 0

        def pytest_runtest_logreport(self, report):
            if report.when == "call" or report.outcome != "passed":
                self.ids.add(report.nodeid)

        def pytest_collectreport(self, report):
            if report.failed:
                self.collect_failures += 1


    tally = Tally()
    raw = os.path.join(scratch, "raw-" + name)

    # Bind the report writer's own parser before /app goes on the path.
    import xml.etree.ElementTree  # noqa: F401
    import _pytest.junitxml  # noqa: F401

    # Now the repository, and at the front: the tests grade the package the
    # agent worked on.  The framework is already imported and bound.
    sys.path[:0] = [os.path.join(APP, "src"), APP]
    os.chdir(APP)

    spec = importlib.util.find_spec("cueforge")
    where = os.path.realpath(getattr(spec, "origin", "") or "") if spec else ""
    if not where.startswith(APP + os.sep):
        print("[verifier] runner: WARNING cueforge resolves to %s" % (where or "<nothing>"),
              flush=True)

    code = pytest.main(
        ["-p", "no:cacheprovider", "-o", "addopts=", "--noconftest", "-q",
         "--junitxml", raw] + test_files,
        plugins=[tally],
    )

    try:
        with open(raw, "rb") as handle:
            written = handle.read()
    except OSError as exc:
        refuse("no report at %s (%s)" % (raw, exc))

    cases = written.count(b"<testcase ")
    expected = len(tally.ids) + tally.collect_failures
    print("[verifier] runner: %s -- %d cases run, %d in the report"
          % (name, expected, cases), flush=True)
    if cases != expected:
        refuse("report does not describe this run")

    with open(os.path.join(scratch, name + ".sig"), "w", encoding="utf-8") as handle:
        handle.write("%s %s" % (token, hashlib.sha256(written).hexdigest()))

    # _exit, not exit: interpreter shutdown runs atexit handlers and thread
    # finalizers, and a submitted test is free to register one.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(int(code))


if __name__ == "__main__":
    main(sys.stdin.readline().strip())
RUN_SUITE_PY

# Two fixed selections: the repository suite backs the pass-to-pass ids,
# the new tests back the fail-to-pass ids.  Explicit file lists mean a
# stray file under tests/ can never join or displace a graded run, and
# no fail-fast flag is ever passed, so every id reaches its report.
P2P_FILES="
tests/cli/test_cli.py
tests/contract/test_public_api.py
tests/end_to_end/test_import.py
tests/integration/test_compile_examples.py
tests/integration/test_invalid_fixtures.py
tests/integration/test_rehearse.py
tests/integration/test_split_show.py
tests/integration/test_store.py
tests/integration/test_unknown_intervention.py
tests/integration/test_workspace.py
tests/property/test_invariants.py
tests/unit/test_assertions.py
tests/unit/test_builders.py
tests/unit/test_canonical.py
tests/unit/test_clock.py
tests/unit/test_compiler_errors.py
tests/unit/test_events.py
tests/unit/test_evidence.py
tests/unit/test_findings.py
tests/unit/test_geometry.py
tests/unit/test_graph.py
tests/unit/test_identifiers.py
tests/unit/test_loaders.py
tests/unit/test_presentation.py
tests/unit/test_reservations.py
tests/unit/test_result.py
tests/unit/test_schedule.py
tests/unit/test_sheets.py
tests/unit/test_state.py
tests/unit/test_time.py
tests/unit/test_trace.py
tests/unit/test_yaml_on_key.py
"
F2P_FILES="
tests/locations/test_json_locations.py
tests/locations/test_workspace_and_cli.py
tests/locations/test_yaml_aliases.py
tests/locations/test_yaml_locations.py
"

# End whatever a suite left running: first its own session, then anything
# on the box that was not there before the suites and is not an ancestor
# of this script.  Both run before the reports are read back.
sweep() {
  python3 -I - "$SCRATCH" "$1" <<'SWEEP_PY'
import os, signal, sys, time
scratch, name = sys.argv[1], sys.argv[2]
try:
    pgid = int(open(os.path.join(scratch, name + ".pgid")).read().strip())
    if pgid != os.getpgid(0):
        os.killpg(pgid, signal.SIGKILL)
except (OSError, ValueError):
    pass
try:
    before = set(int(p) for p in open(os.path.join(scratch, "pids.before")).read().split())
except OSError:
    before = set()
ancestors, pid = set(), os.getpid()
while pid > 1:
    ancestors.add(pid)
    try:
        with open("/proc/%d/stat" % pid) as fh:
            pid = int(fh.read().rsplit(")", 1)[1].split()[1])
    except (OSError, ValueError, IndexError):
        break
for _ in range(3):
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        candidate = int(entry)
        if candidate in before or candidate in ancestors or candidate == os.getpid():
            continue
        try:
            os.kill(candidate, signal.SIGKILL)
            print("[verifier] sweep: ended straggler pid %d" % candidate, flush=True)
        except OSError:
            pass
    time.sleep(0.05)
SWEEP_PY
}

set +e
P2P_STATUS=9; F2P_STATUS=9
if [ "$INTEGRITY_STATUS" != 9 ]; then
  printf '%s\n' "$TOKEN" | run_log python3 -I "$SCRATCH/run_suite.py" "$SCRATCH" base.xml $P2P_FILES
  P2P_STATUS=$?
  sweep base.xml
  log "existing-suite run exited $P2P_STATUS"
  printf '%s\n' "$TOKEN" | run_log python3 -I "$SCRATCH/run_suite.py" "$SCRATCH" new.xml $F2P_FILES
  F2P_STATUS=$?
  sweep new.xml
  log "new-test run exited $F2P_STATUS"
fi

# Publish: a report reaches /logs/verifier only if the runner signed it with
# this run's token and the bytes still match.  Anything else -- a runner
# that refused (exit 9), a report written by something other than the
# runner, a run that ended before signing -- publishes every id as failed.
# Nothing committed is running by now: the sweep ended it.
python3 -I - "$SCRATCH" "$TOKEN" "$P2P_STATUS" "$F2P_STATUS" <<'FINALIZE_PY'
import hashlib, os, sys
scratch, token = sys.argv[1], sys.argv[2]
status = {"base.xml": sys.argv[3], "new.xml": sys.argv[4]}
verifier = "/logs/verifier"
log = lambda m: print("[verifier] reports: %s" % m, flush=True)
os.makedirs(verifier, exist_ok=True)
bad = []
for name in ("base.xml", "new.xml"):
    raw = os.path.join(scratch, "raw-" + name)
    sig = os.path.join(scratch, name + ".sig")
    reason = None
    if status[name] == "9":
        reason = "the runner refused this suite"
    else:
        try:
            with open(raw, "rb") as fh:
                data = fh.read()
            with open(sig, encoding="utf-8") as fh:
                want_token, want_digest = fh.read().split()
        except (OSError, ValueError):
            reason = "the run ended before its report was signed"
        else:
            if want_token != token or want_digest != hashlib.sha256(data).hexdigest():
                reason = "the report was not the one this run signed"
    target = os.path.join(verifier, name)
    try:
        os.chmod(target, 0o644)
    except OSError:
        pass
    if reason is None:
        with open(target, "wb") as fh:
            fh.write(data)
        os.chmod(target, 0o444)
        log("%s signed by this run, published" % name)
    else:
        log("ALTERED: %s -- %s" % (name, reason))
        bad.append((name, reason))
if bad:
    sys.exit(9)
FINALIZE_PY
FINAL_STATUS=$?
if [ "$FINAL_STATUS" = 9 ]; then
  publish_failed "the report was not the one this run signed" base.xml new.xml
fi
chmod 0444 /logs/verifier/base.xml /logs/verifier/new.xml 2>/dev/null || true
# >>> END RUN TESTS <<<

# Surface raw suite output into stdout (the harness captures it) so failures
# stay debuggable even when a framework report omits the reason.
_seen=""
for _rl in "$RUN_LOG" /logs/verifier/*_run.log /logs/verifier/*-run.log /logs/verifier/*.log /logs/verifier/*.out; do
  [ -f "$_rl" ] && [ -s "$_rl" ] || continue
  case " $_seen " in *" $_rl "*) continue ;; esac
  case "${_rl##*/}" in *convert*.log|ctrf*.log|junit*.log) continue ;; esac
  _seen="$_seen $_rl"
  echo "===== raw suite output: ${_rl##*/} ====="
  cat "$_rl"
done 2>/dev/null
echo "===== grade ====="

python3 /tests/grader.py grade
log "reward.json=$(cat /logs/verifier/reward.json 2>/dev/null)"

# Uniform top level: keep only the canonical artifacts in /logs/verifier and
# move every framework-native report/log under reports/.
mkdir -p /logs/verifier/reports 2>/dev/null
for _f in /logs/verifier/*; do
  case "${_f##*/}" in
    reward.json|reward.txt|ctrf.json|run.log|test-stdout.txt|reports) continue ;;
  esac
  [ -f "$_f" ] && mv -f "$_f" /logs/verifier/reports/ 2>/dev/null
done
