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

# Integrity of the graded inputs. grader.py resets and re-applies test.patch,
# so the held-out files are the ones this bundle ships; it does nothing,
# though, about the repository suite that backs the pass-to-pass ids, and a
# committed patch may edit those files or drop a module where Python loads it
# on its own. Both are handled here, before any test runs:
#
#   1. every path in config.json's frozen_files is restored from the base
#      commit, so an edit to the existing suite simply does not survive;
#   2. every name in protected_absent is deleted wherever it sits under /app
#      unless git vouches for it as tracked at the base commit --
#      sitecustomize.py and usercustomize.py matter most, since PYTHONPATH is
#      /app and either would be imported at interpreter start-up, ahead of the
#      suites and again ahead of the grader;
#   3. every top-level module at the repository root that would shadow one the
#      verifier itself imports -- pytest and its own dependencies, or anything
#      in the standard library -- is deleted on the same terms, because /app
#      reaches sys.path three separate ways: PYTHONPATH, the rootdir pytest
#      prepends when it imports a test package, and the directory grader.py
#      runs from;
#   4. every sha256 pin in frozen_files and held_out_files is re-checked, and
#      a mismatch that survived the restore is graded 0 instead of run.
#
# The checker runs as `python3 -I`, which starts with the standard library and
# site-packages on sys.path and nothing else: without it a committed json.py
# would shadow the standard library inside the very script meant to detect it,
# and the set of shadowable names in step 3 could not be read off an
# uncontaminated path. Steps 1 to 3 are best-effort and cannot abort the run;
# only step 4, a genuine grading condition, ends it.
python3 -I - <<'INTEGRITY_PY'
import hashlib, json, os, shutil, subprocess, sys

APP, TESTS, VERIFIER = "/app", "/tests", "/logs/verifier"
log = lambda m: print("[verifier] integrity: %s" % m, flush=True)

try:
    with open(os.path.join(TESTS, "config.json"), encoding="utf-8") as fh:
        cfg = json.load(fh)
except Exception as exc:                       # unreadable config: let the
    log("cannot read config.json (%s); skipping" % exc)   # normal run report it
    sys.exit(0)

base = cfg.get("base_commit") or ""
frozen = cfg.get("frozen_files", {})
held = cfg.get("held_out_files", {})


def git(*args):
    try:
        return subprocess.run(("git", "-C", APP) + args, capture_output=True,
                              timeout=120).returncode
    except Exception:
        return 1


have_git = base and git("cat-file", "-e", base) == 0

# 1. restore the existing suite from the base commit
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

# 3. and any top-level name at the repository root that shadows a module the
#    verifier imports. sys.path here holds the standard library and
#    site-packages only, so listing it names exactly what a file dropped at
#    /app could displace -- pytest, _pytest, pluggy and friends as much as
#    json or re. A name the repository legitimately owns is tracked at the
#    base commit; the framework's own names are not repository names at all,
#    so those go even when git cannot be asked.
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

# what the verifier cannot run without: never a name this repository owns
FRAMEWORK = frozenset({"pytest", "_pytest", "py", "pluggy", "iniconfig",
                       "packaging", "tomli", "exceptiongroup", "pygments",
                       "attr", "attrs", "sitecustomize", "usercustomize"})

for entry in sorted(os.listdir(APP)):
    full = os.path.join(APP, entry)
    if entry.endswith(".py") and os.path.isfile(full):
        name = entry[:-3]
    elif os.path.isdir(full) and os.path.isfile(os.path.join(full, "__init__.py")):
        name = entry
    else:
        continue
    if name not in shadowable and name not in FRAMEWORK:
        continue
    if have_git:
        if git("cat-file", "-e", "%s:%s" % (base, entry)) == 0:
            log("keeping %s (tracked at the base commit)" % entry)
            continue
    elif name not in FRAMEWORK:
        # nothing can vouch for it; only names that could never be the
        # repository's own are worth removing unasked
        log("git unavailable; leaving %s in place" % entry)
        continue
    try:
        if os.path.isdir(full):
            shutil.rmtree(full)
        else:
            os.remove(full)
        log("removed shadowing module: %s" % entry)
    except OSError as exc:
        log("could not remove %s: %s" % (entry, exc))

# 4. the pins decide
def digest(rel):
    try:
        with open(os.path.join(APP, rel), "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None


bad = [rel for label, pins in (("frozen", frozen), ("held-out", held))
       for rel, want in sorted(pins.items()) if digest(rel) != want]
if bad:
    log("ALTERED: %s" % ", ".join(bad[:10]))
    os.makedirs(VERIFIER, exist_ok=True)
    with open(os.path.join(VERIFIER, "reward.json"), "w", encoding="utf-8") as fh:
        json.dump({"reward": 0, "f2p_passed": 0, "p2p_passed": 0,
                   "integrity": "graded test files altered: %s" % ", ".join(bad)},
                  fh)
    sys.exit(9)
log("%d frozen + %d held-out files verified" % (len(frozen), len(held)))
INTEGRITY_PY
[ -f /logs/verifier/reward.json ] && exit 0   # tampered inputs -> graded 0

# Each suite runs in its own `python3 -I` process: isolated mode leaves the
# standard library and site-packages on sys.path and nothing else -- not the
# working directory, not the script's directory, not PYTHONPATH -- so pytest
# is the one the image installed. /app is appended afterwards, behind
# site-packages, which is enough for `import configlayer` and for the test
# packages while leaving nothing the submission ships in front of the
# framework. The runner does not take that on trust: it checks where pytest
# actually came from, and it writes the graded report itself from the run's
# own outcomes.
cat > "$SCRATCH/run_suite.py" <<'RUN_SUITE_PY'
"""Run one graded suite under the installed pytest, never a submitted one.

`python3 -I` starts with only the standard library and site-packages on
sys.path: not the current directory, not this script's directory and not
PYTHONPATH.  The framework therefore comes from the image, and /app --
everything the submission controls -- is appended only afterwards, behind
site-packages.  A committed pytest.py, pytest/ package or json.py cannot
displace it.  The checks below state that as a fact instead of trusting
the ordering, and the report is written by this process from what the
run actually reported.

argv: <scratch-dir> <report-path> <test-file>...
"""

import hashlib
import importlib.util
import os
import sys

APP = "/app"
sys.dont_write_bytecode = True

scratch, report = sys.argv[1], sys.argv[2]
test_files = sys.argv[3:]
name = os.path.basename(report)


def refuse(message):
    # _exit, like the successful path below: importing the framework has
    # already run whatever module-level code shipped with it, and a normal
    # exit would run its atexit handlers on the way out.
    print("[verifier] runner: %s" % message, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(9)


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


class Tally:
    """Count outcomes inside the process that actually ran the tests.

    One entry per test that reached its call phase or failed before it,
    plus one per collector that failed -- exactly the cases pytest's own
    JUnit report contains.  The count is compared with the report below,
    so a report holding entries this run never produced is caught even
    though nothing could have written one.
    """

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

# Bind the report writer's own parser before /app goes on the path, so the
# module that turns the run into XML is settled while nothing the submission
# ships can be reached.
import xml.etree.ElementTree  # noqa: F401
import _pytest.junitxml  # noqa: F401

# Now the repository, and at the front: the tests grade the package the agent
# worked on, which has to outrank a copy the image may have installed. The
# framework is already imported and bound, so this cannot reach it.
sys.path.insert(0, APP)
os.chdir(APP)

spec = importlib.util.find_spec("configlayer")
where = os.path.realpath(getattr(spec, "origin", "") or "") if spec else ""
if not where.startswith(APP + os.sep):
    print("[verifier] runner: WARNING configlayer resolves to %s" % (where or "<nothing>"),
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

with open(report, "wb") as handle:
    handle.write(written)
with open(os.path.join(scratch, name + ".sha256"), "w", encoding="utf-8") as handle:
    handle.write(hashlib.sha256(written).hexdigest())

# _exit, not exit: interpreter shutdown runs atexit handlers and thread
# finalizers, and a submitted test is free to register one.  The graded
# report is on disk and digested; nothing committed gets to run again.
sys.stdout.flush()
sys.stderr.flush()
os._exit(int(code))
RUN_SUITE_PY

# Two fixed selections: the repository suite backs the pass-to-pass ids,
# the new tests back the fail-to-pass ids.  Explicit file lists mean a
# stray file under tests/ can never join or displace a graded run, and
# no fail-fast flag is ever passed, so every id reaches its report.
P2P_FILES="
tests/access/test_deep_delete.py
tests/access/test_deep_get.py
tests/access/test_deep_has.py
tests/access/test_deep_keys.py
tests/access/test_deep_pop.py
tests/access/test_deep_set.py
tests/access/test_deep_update.py
tests/access/test_flatten.py
tests/access/test_unflatten.py
tests/cache/test_cache.py
tests/cache/test_fingerprint.py
tests/cache/test_store.py
tests/contract/test_contract.py
tests/contract/test_report.py
tests/contract/test_violation.py
tests/diff/test_change.py
tests/diff/test_diff.py
tests/diff/test_format.py
tests/env/test_env_source.py
tests/env/test_parser.py
tests/interpolator/test_interpolator.py
tests/interpolator/test_resolver.py
tests/layers/test_config.py
tests/layers/test_layer.py
tests/layers/test_resolution.py
tests/layers/test_stack.py
tests/loader/test_base.py
tests/loader/test_env_loader.py
tests/loader/test_ini_loader.py
tests/loader/test_json_loader.py
tests/loader/test_registry.py
tests/loader/test_toml_loader.py
tests/merger/test_merged_accumulated.py
tests/merger/test_merger.py
tests/merger/test_provenance.py
tests/merger/test_strategy.py
tests/merger/test_subset.py
tests/policy/test_pattern.py
tests/policy/test_policy.py
tests/policy/test_report.py
tests/policy/test_rule.py
tests/schema/test_field.py
tests/schema/test_schema.py
tests/schema/test_validator.py
tests/secrets/test_redactor.py
tests/secrets/test_resolver.py
tests/source/test_base.py
tests/source/test_dict_source.py
tests/source/test_env_source.py
tests/source/test_file_source.py
tests/source/test_schema_env_source.py
tests/test_diffing.py
tests/test_package.py
tests/test_scenarios.py
tests/watcher/test_change.py
tests/watcher/test_listener.py
tests/watcher/test_watcher.py
"
F2P_FILES="
tests/export/test_dotenv_export.py
tests/export/test_export_config.py
tests/export/test_export_scenarios.py
tests/export/test_ini_export.py
"
set +e
rm -f /logs/verifier/p2p.xml /logs/verifier/f2p.xml
run_log python3 -I "$SCRATCH/run_suite.py" "$SCRATCH" /logs/verifier/p2p.xml $P2P_FILES
P2P_STATUS=$?
log "existing-suite run exited $P2P_STATUS"
run_log python3 -I "$SCRATCH/run_suite.py" "$SCRATCH" /logs/verifier/f2p.xml $F2P_FILES
F2P_STATUS=$?
log "new-test run exited $F2P_STATUS"

# Exit 9 is the runner's one refusal: the framework did not come from the
# image, or the report it produced did not describe the run. Either way the
# reports cannot be graded, and a submission that arranges it is not owed a
# rerun.
if [ "$P2P_STATUS" = 9 ] || [ "$F2P_STATUS" = 9 ]; then
  log "ALTERED: the test framework or its report was not the verifier's"
  printf '%s' '{"reward": 0, "f2p_passed": 0, "p2p_passed": 0, "integrity": "the test framework or its report was not the verifiers"}' \
    > /logs/verifier/reward.json
fi

# And the reports still have to be the bytes the runner signed off. Nothing
# committed is running by now -- the runner leaves through os._exit, which
# skips the atexit handlers and thread finalizers a test could have left
# behind -- so this reads them once more from a clean process.
python3 -I - "$SCRATCH" <<'REPORT_CHECK_PY'
import hashlib, json, os, sys

scratch, verifier = sys.argv[1], "/logs/verifier"
log = lambda m: print("[verifier] reports: %s" % m, flush=True)

if os.path.exists(os.path.join(verifier, "reward.json")):
    sys.exit(0)                       # already graded; nothing left to check

for name in ("p2p.xml", "f2p.xml"):
    signature = os.path.join(scratch, name + ".sha256")
    report = os.path.join(verifier, name)
    if not os.path.exists(signature) or not os.path.exists(report):
        log("%s: no run to compare against" % name)
        continue
    with open(signature, encoding="utf-8") as fh:
        want = fh.read().strip()
    with open(report, "rb") as fh:
        got = hashlib.sha256(fh.read()).hexdigest()
    if got != want:
        log("ALTERED: %s changed after the run that produced it" % name)
        with open(os.path.join(verifier, "reward.json"), "w", encoding="utf-8") as fh:
            json.dump({"reward": 0, "f2p_passed": 0, "p2p_passed": 0,
                       "integrity": "%s was rewritten after its run" % name}, fh)
        sys.exit(0)
    log("%s matches the run that produced it" % name)
REPORT_CHECK_PY
[ -f /logs/verifier/reward.json ] && exit 0   # tampered framework or report -> graded 0
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
