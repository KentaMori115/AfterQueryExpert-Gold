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
# Two selections run: the repository's own Django suite, which backs the
# pass-to-pass ids, and the held-back exit tests, which back the fail-to-pass
# ids.  There is no pytest in this image and none in requirements.txt, so both
# run under the standard library's own runner with Django's test database
# around them, and the JUnit is written here rather than by a framework.
#
# Nothing that runs submitted code ever writes a report.  A root parent that
# never imports /app mints a per-run token, hands it to a child on stdin,
# hears one verdict line per case back on a dedicated descriptor, and writes
# the XML only after the child has exited, so no report file exists while code
# from /app can still run.  The child runs as nobody through setpriv whenever
# this script is root, so nothing it imports can write to /tests, /verify or
# /logs, or signal the parent.  Both interpreters run isolated (-I), and the
# child appends /app to sys.path LAST, so unittest and django always resolve
# from the interpreter's own installation and never from the tree under test.
# Before /app can run anything the child snapshots every decision point of
# every loaded unittest and django.test module and class, assertions and
# runner included, and rechecks it at each verdict and at the end; a run that
# moved the framework sends no END, and the parent then publishes every
# declared id as failed, exactly as it does for an id the run never reported.
#
# The graded pass-to-pass sources are restored to their base-commit content
# and digest-checked, the held-back sources are digest-checked, stale bytecode
# and anything planted to run before collection are removed, /tests is closed
# to everyone but root and restored if it moves, and no process a suite
# started survives into grading.
unset PYTHONPATH

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
mkdir -p "$RPTDIR" 2>/dev/null || true
chmod 0755 "$VDIR" 2>/dev/null || true
chmod 0700 "$RPTDIR" 2>/dev/null || true

# Somewhere the child can write that is not the repository and not /tmp's
# root, so a suite needing a home or a scratch file has one.
SANDBOX="$VDIR/sandbox"
mkdir -p "$SANDBOX" 2>/dev/null || SANDBOX=$(mktemp -d)
chmod 1777 "$SANDBOX" 2>/dev/null || true

# The grader and its configuration are root-owned and read-only from here on,
# and a private copy of each is kept so that, should either move while the
# suites run, the original is put back before grading.
chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
mkdir -p "$VDIR/keep" 2>/dev/null && chmod 0700 "$VDIR/keep" 2>/dev/null || true
cp /tests/grader.py "$VDIR/keep/grader.py" 2>/dev/null || true
cp /tests/config.json "$VDIR/keep/config.json" 2>/dev/null || true
TESTS_SHA=$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)
chmod -R go-rwx /tests 2>/dev/null || true

P2P_FILES="tests/test_offline.py tests/test_schwab_api.py tests/test_server_api.py tests/test_user_allow.py Users/tests.py"
SUPPORT_FILES="tests/__init__.py"
NEW_FILES="tests/test_wind_down.py tests/test_paper_targets.py"

cat > "$VDIR/child.py" <<'PYCHILD'
import os
import sys


def decides(value):
    """Whether an attribute can change what the framework does.

    Everything here is asked of ``type(value)`` rather than of the value.
    Django hands out lazy proxies whose ``__class__`` builds the settings the
    first time anything looks at it, and ``isinstance`` reaches for exactly
    that, which would run configuration code before /app is even importable.
    """
    try:
        if type(value) in (property, classmethod, staticmethod):
            return True
        return callable(value)
    except Exception:
        return False


def framework_modules():
    """Every loaded module of the frameworks the verdicts rest on.

    ``unittest`` runs the cases and owns every assertion the graded suites
    make, and ``django.test`` owns the case classes they are written against.
    """
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name in ("unittest", "django.test") or name.startswith(
                ("unittest.", "django.test.")):
            found[name] = mod
    return found


def snapshot_framework():
    modules = {}
    classes = {}
    for name, mod in framework_modules().items():
        attrs = {k: v for k, v in vars(mod).items() if decides(v)}
        modules[name] = (mod, attrs)
        for key, value in attrs.items():
            if isinstance(value, type) and getattr(value, "__module__", None) == name:
                members = {k: v for k, v in vars(value).items() if decides(v)}
                classes[(name, key)] = (value, members)
    return modules, classes


def framework_drift(guard):
    modules, classes = guard
    drift = set()
    for name, (mod, attrs) in modules.items():
        if sys.modules.get(name) is not mod:
            drift.add(("swap", name))
            continue
        live = vars(mod)
        for key, value in attrs.items():
            if key not in live or live[key] is not value:
                drift.add(("mod", name, key))
        for key, value in live.items():
            if key not in attrs and decides(value):
                drift.add(("mod", name, key))
    for (name, key), (cls, members) in classes.items():
        live = vars(cls)
        for member, value in members.items():
            if member not in live or live[member] is not value:
                drift.add(("cls", name, key, member))
        for member, value in live.items():
            if member not in members and decides(value):
                drift.add(("cls", name, key, member))
    return drift


def bind_repo_tests_package():
    """Make ``tests`` mean the repository's own package and nothing else.

    A dependency in this image ships a top level ``tests`` package of its own,
    and /app is appended to the path rather than prepended, so the dotted name
    would otherwise resolve into site-packages.  Binding the repository's
    package under the name first settles it for every later import, and the
    graded ids keep the ``tests.<module>.<Class>.<method>`` shape the grading
    configuration declares.
    """
    import importlib.util

    path = "/app/tests/__init__.py"
    if not os.path.exists(path):
        return
    spec = importlib.util.spec_from_file_location(
        "tests", path, submodule_search_locations=["/app/tests"])
    module = importlib.util.module_from_spec(spec)
    sys.modules["tests"] = module
    spec.loader.exec_module(module)


def module_name(path):
    relative = path[len("/app/"):] if path.startswith("/app/") else path
    if relative.endswith(".py"):
        relative = relative[:-3]
    return relative.replace("/", ".")


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    sources = sys.argv[2:]

    # Bound before anything under /app can run.  Rebinding os.write later
    # changes nothing here, and a forked copy of this process never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()

    # /app goes on the path LAST, so the interpreter's own unittest and the
    # installed django always win over anything committed in the tree.
    sys.path.append("/app")

    import unittest
    import unittest.case  # noqa: F401
    import unittest.loader  # noqa: F401
    import unittest.mock  # noqa: F401
    import unittest.result  # noqa: F401
    import unittest.runner  # noqa: F401
    import unittest.suite  # noqa: F401
    import unittest.util  # noqa: F401
    import django
    import django.test  # noqa: F401
    import django.test.runner  # noqa: F401
    import django.test.testcases  # noqa: F401
    import django.test.utils  # noqa: F401

    print("[runner] unittest from", unittest.__file__, flush=True)
    print("[runner] django", django.get_version(), "from", django.__file__, flush=True)

    # Appending rather than inserting is what keeps the tree from shadowing
    # the framework, so it is worth proving rather than assuming: nothing the
    # verdicts rest on may have been loaded out of /app.
    for name, mod in sorted(framework_modules().items()):
        origin = getattr(mod, "__file__", "") or ""
        if origin.startswith("/app"):
            print("[runner] %s resolved from the tree under test (%s)"
                  % (name, origin), flush=True)
            os._exit(3)

    guard = snapshot_framework()
    points = (sum(len(a) for _, a in guard[0].values())
              + sum(len(m) for _, m in guard[1].values()))
    if framework_drift(guard):
        print("[runner] framework did not settle before the run", flush=True)
        os._exit(3)
    print("[runner] framework guard: %d decision points" % points, flush=True)

    # Everything below imports and runs code from /app.
    django.setup()
    from django.test.runner import DiscoverRunner
    from django.test.utils import setup_test_environment, teardown_test_environment

    setup_test_environment()
    runner = DiscoverRunner(verbosity=0, interactive=False)
    old_config = runner.setup_databases()

    bind_repo_tests_package()

    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for source in sources:
        name = module_name(source)
        try:
            suite.addTests(loader.loadTestsFromName(name))
        except Exception as exc:
            print("[runner] could not load %s: %s" % (name, exc), flush=True)

    state = {"n": 0, "tampered": False}

    def report(test, outcome):
        if getpid() != owner:
            return
        if framework_drift(guard):
            state["tampered"] = True
            return
        node_id = test.id()
        classname, _, name = node_id.rpartition(".")
        line = "V %s %s %s\x1f%s\n" % (token, outcome, classname, name)
        write(fd, line.encode())
        state["n"] += 1

    class Recorder(unittest.TestResult):
        def addSuccess(self, test):
            unittest.TestResult.addSuccess(self, test)
            report(test, "passed")

        def addFailure(self, test, err):
            unittest.TestResult.addFailure(self, test, err)
            report(test, "failed")

        def addError(self, test, err):
            unittest.TestResult.addError(self, test, err)
            report(test, "failed")

        def addSkip(self, test, reason):
            unittest.TestResult.addSkip(self, test, reason)
            report(test, "skipped")

        def addExpectedFailure(self, test, err):
            unittest.TestResult.addExpectedFailure(self, test, err)
            report(test, "failed")

        def addUnexpectedSuccess(self, test):
            unittest.TestResult.addUnexpectedSuccess(self, test)
            report(test, "failed")

        def addSubTest(self, test, subtest, err):
            unittest.TestResult.addSubTest(self, test, subtest, err)
            if err is not None:
                report(test, "failed")

    result = Recorder()
    suite.run(result)

    for failed, trace in list(result.failures) + list(result.errors):
        print("[runner] %s\n%s" % (failed, trace), flush=True)

    try:
        runner.teardown_databases(old_config)
        teardown_test_environment()
    except Exception:
        pass

    if getpid() != owner:
        os._exit(0)
    if state["tampered"] or framework_drift(guard):
        print("[runner] framework moved during the run; no END will be sent", flush=True)
        os._exit(3)

    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    print("[runner] emitted %d verdict(s)" % state["n"], flush=True)


main()
PYCHILD

cat > "$VDIR/publish.py" <<'PYPUB'
import json
import os
import pwd
import shutil
import subprocess
import sys
import xml.sax.saxutils


def declared_ids(xml_path):
    """The ids the grading configuration declares for this report.

    A refused or incomplete run still publishes every one of them, failed, so
    an empty report can never be mistaken for a verifier that fell over.
    """
    try:
        with open("/tests/config.json") as handle:
            config = json.load(handle)
    except Exception:
        return []
    key = "p2p_node_ids" if os.path.basename(xml_path) == "base.xml" else "f2p_node_ids"
    return [nid for nid in config.get(key, []) if isinstance(nid, str)]


def child_command(vdir, write_fd, sources):
    command = [sys.executable, "-I", os.path.join(vdir, "child.py"),
               str(write_fd)] + sources
    setpriv = shutil.which("setpriv")
    if os.geteuid() == 0 and setpriv:
        try:
            nobody = pwd.getpwnam("nobody")
        except KeyError:
            print("[publish] no nobody user; child runs as root", flush=True)
            return command
        print("[publish] child runs as nobody (uid %d)" % nobody.pw_uid, flush=True)
        return [setpriv, "--reuid=%d" % nobody.pw_uid,
                "--regid=%d" % nobody.pw_gid, "--clear-groups",
                "--inh-caps=-all"] + command
    print("[publish] child runs unprivileged-as-is (euid %d)" % os.geteuid(),
          flush=True)
    return command


def main():
    vdir, xml_path = sys.argv[1], sys.argv[2]
    sources = sys.argv[3:]
    token = os.urandom(16).hex()
    read_fd, write_fd = os.pipe()

    child = subprocess.Popen(
        child_command(vdir, write_fd, sources),
        stdin=subprocess.PIPE,
        pass_fds=(write_fd,),
    )
    os.close(write_fd)
    child.stdin.write((token + "\n").encode())
    child.stdin.flush()
    child.stdin.close()

    rank = {"passed": 0, "skipped": 1, "failed": 2}
    results = {}
    order = []
    heard = 0
    ended = False
    valid = True
    declared = -1
    with os.fdopen(read_fd, "r", errors="replace") as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            if ended:
                # Nothing may follow END; a late line poisons the stream.
                valid = False
                break
            parts = line.split(" ", 3)
            if len(parts) == 3 and parts[0] == "END" and parts[1] == token:
                ended = True
                declared = int(parts[2]) if parts[2].isdigit() else -1
                continue
            if len(parts) == 4 and parts[0] == "V" and parts[1] == token:
                outcome, payload = parts[2], parts[3]
                if outcome not in rank or "\x1f" not in payload:
                    valid = False
                    break
                classname, _, name = payload.partition("\x1f")
                nid = (classname, name)
                heard += 1
                if nid not in results:
                    order.append(nid)
                    results[nid] = outcome
                elif rank[outcome] > rank[results[nid]]:
                    results[nid] = outcome
            # A line without the token is not a verdict.  Only the child was
            # handed the token, and only these two processes share the pipe.
    rc = child.wait()

    expected = declared_ids(xml_path)
    reason = None
    if not (valid and ended and declared == heard):
        reason = ("verdict stream refused (valid=%s ended=%s declared=%d heard=%d)"
                  % (valid, ended, declared, heard))
        print("[publish] %s; publishing every declared id as failed" % reason,
              flush=True)
        results, order = {}, []

    reported = {classname + "." + name for classname, name in results}
    missing = 0
    for joined in expected:
        if joined in reported:
            continue
        classname, _, name = joined.rpartition(".")
        nid = (classname, name)
        order.append(nid)
        results[nid] = "failed"
        reported.add(joined)
        missing += 1

    esc = xml.sax.saxutils.quoteattr
    rows = []
    for nid in order:
        classname, name = nid
        status = results[nid]
        body = ""
        if status == "failed":
            message = reason or "failed; see the raw suite output in run.log"
            body = "<failure message=%s/>" % esc(message)
        elif status == "skipped":
            body = "<skipped/>"
        rows.append("<testcase classname=%s name=%s>%s</testcase>"
                    % (esc(classname), esc(name), body))
    document = ('<?xml version="1.0" encoding="utf-8"?>'
                '<testsuite tests="%d">%s</testsuite>' % (len(rows), "".join(rows)))
    with open(xml_path, "w") as handle:
        handle.write(document)
    print("[publish] wrote %s: %d case(s), %d declared id(s) added as failed, "
          "child rc %s" % (xml_path, len(rows), missing, rc), flush=True)


main()
PYPUB
chmod 0444 "$VDIR/child.py" "$VDIR/publish.py" 2>/dev/null || true

# These run before any test does, whatever the runner, and none of them exists
# at the base commit.
for _planted in /app/sitecustomize.py /app/usercustomize.py \
                /app/tests/sitecustomize.py /app/tests/usercustomize.py; do
  if [ -e "$_planted" ]; then
    log "removing $_planted, which runs before collection and was not there at the base"
    rm -f "$_planted" 2>/dev/null || true
  fi
done
rm -f /app/*.pth /app/tests/*.pth 2>/dev/null || true
find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Restore every graded pass-to-pass source to its base-commit content, then
# digest-check.  HEAD in this container is the base commit, and model.patch
# and test.patch touch the working tree only.
for f in $P2P_FILES $SUPPORT_FILES; do
  git -C /app checkout HEAD -- "$f" 2>/dev/null || true
done
cat > "$VDIR/p2p.sha256" <<'SHA_P2P'
cd221916d41cd3aba275786aacc0811b93904a994385a073e48fed1b57389b27  tests/test_offline.py
af001606361d29b7592b83fe43ea405310b704c36026fbb667856da67d3dd3bc  tests/test_schwab_api.py
4d9881f175a528831ffd4f3f3ceb9c036de1059c2e17afb318fd39937ff9413d  tests/test_server_api.py
52eb2f4040ca2af1f5b793b4e1c882cf39576df24c268843b10e7d94b17aaf5a  tests/test_user_allow.py
4b4d23fb36650e52cdbfae096a7b706b692eb63516b4820ffabbbd313cb7675d  Users/tests.py
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  tests/__init__.py
SHA_P2P
cat > "$VDIR/new.sha256" <<'SHA_NEW'
0d9b9e64a8f797b9450a710433c1da1684a14ab2f4073a6c6fd64dd90e105900  tests/test_wind_down.py
35b9b1c55c1522f07f1be90c4d0e4df9c27a8e1a0978f2d5607396321a979b1b  tests/test_paper_targets.py
SHA_NEW

P2P_OK=1
if ! (cd /app && sha256sum -c "$VDIR/p2p.sha256" >/dev/null 2>&1); then
  P2P_OK=0
  log "ERROR: pass-to-pass sources do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
  (cd /app && sha256sum -c "$VDIR/p2p.sha256" 2>&1 | grep -v ': OK$' | head -20) >> "$RUN_LOG" 2>/dev/null || true
fi
NEW_OK=1
if ! (cd /app && sha256sum -c "$VDIR/new.sha256" >/dev/null 2>&1); then
  NEW_OK=0
  log "ERROR: held-back test sources are not the ones shipped; their suite will not run and every fail-to-pass id will be published as failed"
fi

proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE=$(proc_list)

run_suite() {
  _xml="$1"; shift
  _paths=""
  for _f in "$@"; do _paths="$_paths /app/$_f"; done
  echo "+ suite -> $_xml ($# file(s))" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    setsid env HOME="$SANDBOX" TMPDIR="$SANDBOX" timeout 700 \
      python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" $_paths >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    env HOME="$SANDBOX" TMPDIR="$SANDBOX" timeout 700 \
      python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" $_paths >> "$RUN_LOG" 2>&1
    _rc=$?
  fi
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
}

set +e
if [ "$P2P_OK" = 1 ]; then
  run_suite "$RPTDIR/base.xml" $P2P_FILES
fi
if [ "$NEW_OK" = 1 ]; then
  run_suite "$RPTDIR/new.xml" $NEW_FILES
fi

# End anything that appeared while the suites ran and is still running, so
# nothing code under test started survives into grading.  This script's own
# ancestry is exempt.
SELF_CHAIN=" $$ "
_p=$PPID
while [ -n "${_p:-}" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ]; do
  SELF_CHAIN="$SELF_CHAIN$_p "
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null)
done
for _pid in $(proc_list); do
  echo "$PROC_BEFORE" | grep -qx "$_pid" && continue
  case "$SELF_CHAIN" in *" $_pid "*) continue ;; esac
  kill -9 "$_pid" 2>/dev/null || true
done

# The grader and its configuration must be the bytes this script started with.
if [ -n "$TESTS_SHA" ] && [ "$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)" != "$TESTS_SHA" ]; then
  log "ERROR: /tests/grader.py or /tests/config.json changed while the suites ran; restoring the originals"
  chmod 0644 /tests/grader.py /tests/config.json 2>/dev/null || true
  cp "$VDIR/keep/grader.py" /tests/grader.py 2>/dev/null || true
  cp "$VDIR/keep/config.json" /tests/config.json 2>/dev/null || true
  chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
fi

# Publish read-only, and only after the sweep.
[ -f "$RPTDIR/base.xml" ] && cp "$RPTDIR/base.xml" /logs/verifier/base.xml
[ -f "$RPTDIR/new.xml" ] && cp "$RPTDIR/new.xml" /logs/verifier/new.xml
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
