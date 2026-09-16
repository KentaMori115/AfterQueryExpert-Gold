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
# Two selections run under Django's own test runner: the repository's suite
# (pass-to-pass) and the held-back risk budget tests (fail-to-pass). There is
# no pytest in this image, so the JUnit XML is written here rather than by a
# reporter. Reports are not written by the process that runs submitted code: a
# parent that never imports /app mints a per-run token, hands it to a child on
# stdin, hears one verdict line per case back on a dedicated descriptor, and
# writes the XML only after the child has exited, so no report file exists
# while /app code can run. Both interpreters run isolated (-I); the child
# appends /app LAST to sys.path, so django, unittest and the standard library
# always resolve from the interpreter's own installation and never from the
# tree under test, and the graded modules are loaded from their exact paths
# because the image's site-packages ships a top level `tests` package of its
# own. The child takes an identity snapshot of every loaded unittest and
# django.test module and class before /app is importable, measures what the
# framework does to itself on a suite holding nothing from /app, and rechecks
# the snapshot after the project loads, at every verdict and at the end; a run
# that altered the framework sends no END and the publisher then publishes
# every declared id as failed, as it does for any id the run never reported.
# The child runs as an unprivileged user (nobody, via setpriv) whenever this
# script is root, so nothing imported from /app can write to /tests, /verify
# or /logs, or signal the root-owned publisher; /tests/grader.py and
# /tests/config.json are made read-only, copied, and restored from the copies
# if their digests moved before grading. The graded pass-to-pass sources are
# restored to their base-commit content and digest-checked, import-time hooks
# a submission could leave behind are removed along with stale bytecode, and
# no process started by a suite survives into grading.
unset PYTHONPATH
unset PYTHONSTARTUP

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
mkdir -p "$RPTDIR" 2>/dev/null || true
chmod 0755 "$VDIR" 2>/dev/null || true
chmod 0700 "$RPTDIR" 2>/dev/null || true

# The grader and its configuration are root-owned and read-only from here on,
# and a private copy of each is kept so that, should either move while the
# suites run, the original is put back before grading.
chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
mkdir -p "$VDIR/keep" 2>/dev/null && chmod 0700 "$VDIR/keep" 2>/dev/null || true
cp /tests/grader.py "$VDIR/keep/grader.py" 2>/dev/null || true
cp /tests/config.json "$VDIR/keep/config.json" 2>/dev/null || true
TESTS_SHA=$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)

P2P_FILES="tests/test_offline.py tests/test_schwab_api.py tests/test_server_api.py tests/test_user_allow.py Users/tests.py"
SUPPORT_FILES="tests/__init__.py"
NEW_FILES="tests/test_risk_budget.py tests/test_risk_budget_admin.py"

cat > "$VDIR/child.py" <<'PYCHILD'
"""Run one Django selection and stream a verdict per case.

Started by publish.py with the report's file descriptor and the dotted module
labels to run. Reads the run token from stdin before /app is importable, takes
an identity snapshot of unittest and django.test while only the interpreter's
own installation is on sys.path, and rechecks it at every verdict and at the
end. A run that altered the framework sends no END, and the publisher then
publishes every declared id as failed.
"""

import os
import sys


def decides(value):
    """Whether an attribute can change what the framework does.

    Read with `type`, never `isinstance`: django hands out lazy proxies whose
    `__class__` builds the settings, which is not something a snapshot may do.
    """
    try:
        return callable(value) or type(value) in (property, classmethod, staticmethod)
    except Exception:
        return False


def framework_modules():
    """Loaded modules whose decisions the verdicts rest on: unittest, whose
    assertions the cases are written against, and the django.test classes the
    cases inherit from."""
    watched = ("django.test", "django.test.testcases", "django.test.client",
               "django.test.runner")
    # unittest.signals only holds the ctrl-c handler the runner installs while
    # a suite runs, which decides nothing about a verdict.
    ignored = ("unittest.signals",)
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None or name in ignored:
            continue
        if name == "unittest" or name.startswith("unittest."):
            found[name] = mod
        elif name in watched:
            found[name] = mod
    return found


def framework_origin():
    """Watched modules that came from the tree under test rather than from the
    interpreter's own installation."""
    strays = []
    for name, mod in framework_modules().items():
        origin = getattr(mod, "__file__", None) or ""
        if origin.startswith("/app"):
            strays.append(name)
    return sorted(strays)


def snapshot_framework():
    """Every decision point of every watched module, and of every class they
    define, held by reference so identity can be rechecked."""
    modules = {}
    classes = {}
    for name, mod in framework_modules().items():
        attrs = {k: v for k, v in vars(mod).items() if decides(v)}
        modules[name] = (mod, attrs)
        for key, value in attrs.items():
            if type(value) is not type:
                continue
            if getattr(value, "__module__", None) != name:
                continue
            members = {k: v for k, v in vars(value).items() if decides(v)}
            classes[(name, key)] = (value, members)
    return modules, classes


def framework_drift(guard):
    """Every decision point that is not the object it was, or was added."""
    modules, classes = guard
    drift = set()
    for name, (mod, attrs) in modules.items():
        if sys.modules.get(name) is not mod:
            drift.add(("swap", name))
        live = vars(mod)
        for key, value in attrs.items():
            if key not in live or live[key] is not value:
                drift.add(("mod", name, key, type(live.get(key)).__name__))
        for key, value in live.items():
            if key not in attrs and decides(value):
                drift.add(("mod", name, key, type(value).__name__))
    for (name, key), (cls, members) in classes.items():
        live = vars(cls)
        for member, value in members.items():
            if member not in live or live[member] is not value:
                drift.add(("cls", name, key, member, type(live.get(member)).__name__))
        for member, value in live.items():
            if member not in members and decides(value):
                drift.add(("cls", name, key, member, type(value).__name__))
    return drift


def load_package(name, folder):
    """Import a package from an exact folder under /app.

    Not by name: the interpreter's own site-packages ships a top level
    `tests` package, and /app is deliberately last on sys.path, so a plain
    import would load that one instead of the repository's.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        name,
        os.path.join(folder, "__init__.py"),
        submodule_search_locations=[folder],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_module(rel_path):
    """Import /app/<rel_path> under the dotted name its path spells."""
    import importlib
    import importlib.util

    name = rel_path[:-3].replace("/", ".") if rel_path.endswith(".py") else rel_path
    if name in sys.modules:
        # Nothing has loaded a graded module yet, so something under /app put
        # this here during startup, hoping to be graded in its place.
        print("[runner] %s was registered before it was loaded" % name, flush=True)
        os._exit(3)
    package, _, _leaf = name.rpartition(".")
    if package and package not in sys.modules:
        folder = os.path.join("/app", package.replace(".", "/"))
        if os.path.exists(os.path.join(folder, "__init__.py")):
            load_package(package, folder)
        else:
            importlib.import_module(package)
    spec = importlib.util.spec_from_file_location(name, os.path.join("/app", rel_path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    rel_paths = sys.argv[2:]
    # Bound now, before anything under /app can run: rebinding os.write or
    # os.getpid later changes nothing here, and a forked copy never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()

    import unittest  # noqa: F401
    import unittest.case  # noqa: F401
    import unittest.loader  # noqa: F401
    import unittest.result  # noqa: F401
    import unittest.runner  # noqa: F401
    import unittest.suite  # noqa: F401
    import unittest.util  # noqa: F401
    import django  # noqa: F401
    import django.test  # noqa: F401
    import django.test.client  # noqa: F401
    import django.test.runner  # noqa: F401
    import django.test.testcases  # noqa: F401
    from django.test.runner import DiscoverRunner

    print("[runner] django resolved from", django.__file__, flush=True)
    if framework_origin():
        print("[runner] framework loaded from /app: %s" % framework_origin(), flush=True)
        os._exit(3)
    guard = snapshot_framework()

    state = {"n": 0, "tampered": False, "live": False, "allowed": set()}

    class Recorder(unittest.TextTestResult):
        """A verdict per finished case, on the descriptor the publisher owns."""

        def report(self, test, outcome):
            if getpid() != owner or not state["live"]:
                return
            if framework_drift(guard) - state["allowed"]:
                state["tampered"] = True
                return
            case_id = test.id()
            cls, _, name = case_id.rpartition(".")
            line = "V %s %s %s\x1f%s\n" % (token, outcome, cls, name)
            write(fd, line.encode())
            state["n"] += 1

        def addSuccess(self, test):
            super().addSuccess(test)
            self.report(test, "passed")

        def addError(self, test, err):
            super().addError(test, err)
            self.report(test, "failed")

        def addFailure(self, test, err):
            super().addFailure(test, err)
            self.report(test, "failed")

        def addSubTest(self, test, subtest, err):
            super().addSubTest(test, subtest, err)
            if err is not None:
                self.report(test, "failed")

        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            self.report(test, "skipped")

        def addExpectedFailure(self, test, err):
            super().addExpectedFailure(test, err)
            self.report(test, "failed")

        def addUnexpectedSuccess(self, test):
            super().addUnexpectedSuccess(test)
            self.report(test, "failed")

    class Runner(DiscoverRunner):
        def get_resultclass(self):
            return Recorder

    # What the framework does to itself during a run, measured on a suite that
    # holds nothing from /app. Only drift beyond this is treated as tampering.
    calibration = Runner(verbosity=0, interactive=False, keepdb=False, parallel=1)

    class Calibration(unittest.TestCase):
        def test_passes(self):
            self.assertEqual(1, 1)

        def test_fails(self):
            self.assertEqual([1], [2])

        def test_raises(self):
            with self.assertRaises(ValueError):
                int("x")

    calibration.run_suite(unittest.TestLoader().loadTestsFromTestCase(Calibration))
    state["allowed"] = framework_drift(guard)
    print("[runner] framework guard: %d self-changes allowed" % len(state["allowed"]), flush=True)

    # /app goes on last, so django, unittest and the standard library always
    # resolve from the interpreter's own installation.
    sys.path.append("/app")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "SchwabOptionBot.settings")
    django.setup()
    drift = framework_drift(guard) - state["allowed"]
    if drift:
        print("[runner] framework altered while the project loaded: %s" % sorted(drift)[:8], flush=True)
        print("[runner] no END will be sent", flush=True)
        os._exit(3)

    runner = Runner(verbosity=1, interactive=False, keepdb=False, parallel=1)
    runner.setup_test_environment()
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    graded_paths = set()
    for rel_path in rel_paths:
        graded_paths.add(os.path.join("/app", rel_path))
        suite.addTests(loader.loadTestsFromModule(load_module(rel_path)))

    # Every case that will run has to be code from the pinned files themselves,
    # not something of the same name assembled elsewhere.
    for case in suite:
        for test in case if isinstance(case, unittest.TestSuite) else [case]:
            method = getattr(test, getattr(test, "_testMethodName", ""), None)
            origin = getattr(getattr(method, "__code__", None), "co_filename", None)
            if origin not in graded_paths:
                print("[runner] %s comes from %s, not from a graded file"
                      % (test.id(), origin), flush=True)
                os._exit(3)
    old_config = runner.setup_databases()
    state["live"] = True
    try:
        runner.run_suite(suite)
    finally:
        try:
            runner.teardown_databases(old_config)
            runner.teardown_test_environment()
        except Exception:
            pass

    if getpid() != owner:
        os._exit(0)
    drift = framework_drift(guard) - state["allowed"]
    if framework_origin():
        print("[runner] framework replaced from /app: %s" % framework_origin(), flush=True)
        os._exit(3)
    if state["tampered"] or drift:
        print("[runner] framework tampered with: %s" % sorted(drift)[:8], flush=True)
        print("[runner] no END will be sent", flush=True)
        os._exit(3)
    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    sys.exit(0)


main()
PYCHILD

cat > "$VDIR/publish.py" <<'PYPUBLISH'
import json
import os
import pwd
import shutil
import subprocess
import sys
import xml.sax.saxutils


def declared_ids(xml_path):
    """The ids /tests/config.json declares for this report, so a refused or
    incomplete run still publishes every one of them as failed."""
    try:
        with open("/tests/config.json") as fh:
            config = json.load(fh)
    except Exception:
        return []
    key = "p2p_node_ids" if os.path.basename(xml_path) == "base.xml" else "f2p_node_ids"
    return [nid for nid in config.get(key, []) if isinstance(nid, str)]


def main():
    vdir, xml_path = sys.argv[1], sys.argv[2]
    labels = sys.argv[3:]
    token = os.urandom(16).hex()
    r_fd, w_fd = os.pipe()
    command = [sys.executable, "-I", os.path.join(vdir, "child.py"),
               str(w_fd)] + labels
    # The child runs code from /app, so it runs as nobody whenever this
    # publisher is root: it can then neither write to /tests, /verify or
    # /logs nor signal this process, and its only channel is the pipe.
    setpriv = shutil.which("setpriv")
    if os.geteuid() == 0 and setpriv:
        try:
            nobody = pwd.getpwnam("nobody")
            command = [setpriv, "--reuid=%d" % nobody.pw_uid,
                       "--regid=%d" % nobody.pw_gid, "--clear-groups",
                       "--inh-caps=-all"] + command
            print("[publish] child runs as nobody (uid %d)" % nobody.pw_uid,
                  flush=True)
        except KeyError:
            print("[publish] no nobody user; child runs as root", flush=True)
    else:
        print("[publish] child runs unprivileged-as-is (euid %d)"
              % os.geteuid(), flush=True)
    child = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        pass_fds=(w_fd,),
    )
    os.close(w_fd)
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
    with os.fdopen(r_fd, "r", errors="replace") as stream:
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
                cls, _, name = payload.partition("\x1f")
                nid = (cls, name)
                heard += 1
                if nid not in results:
                    order.append(nid)
                    results[nid] = outcome
                elif rank[outcome] > rank[results[nid]]:
                    results[nid] = outcome
            # Lines without the token are ignored: only the two interpreters
            # share the pipe, and only the child was handed the token.
    rc = child.wait()

    expected = declared_ids(xml_path)
    reason = None
    if not (valid and ended and declared == heard):
        reason = (
            "verdict stream refused (valid=%s ended=%s declared=%d heard=%d)"
            % (valid, ended, declared, heard)
        )
        print("[publish] %s; publishing every declared id as failed" % reason, flush=True)
        results, order = {}, []
    # Every declared id the run did not report is published as failed too, so
    # the report is always complete and a missing case cannot be told apart
    # from a failing one by anything but its message.
    # Ids are matched as the grader matches them, classname and name joined
    # by a dot, because a test name may itself carry dots.
    reported = {cls + "." + name for cls, name in results}
    missing = 0
    for joined in expected:
        if joined in reported:
            continue
        cls, _, name = joined.rpartition(".")
        nid = (cls, name)
        order.append(nid)
        results[nid] = "failed"
        reported.add(joined)
        missing += 1

    esc = xml.sax.saxutils.quoteattr
    rows = []
    for nid in order:
        cls, name = nid
        status = results[nid]
        body = ""
        if status == "failed":
            message = reason or "failed; see the raw suite output in run.log"
            body = "<failure message=%s/>" % esc(message)
        elif status == "skipped":
            body = "<skipped/>"
        rows.append(
            "<testcase classname=%s name=%s>%s</testcase>"
            % (esc(cls), esc(name), body)
        )
    doc = (
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
        "<testsuite tests=\"%d\">%s</testsuite>" % (len(rows), "".join(rows))
    )
    with open(xml_path, "w") as fh:
        fh.write(doc)
    print(
        "[publish] wrote %s: %d cases (%d declared ids added as failed), child rc %s"
        % (xml_path, len(rows), missing, rc),
        flush=True,
    )


main()
PYPUBLISH
chmod 0444 "$VDIR/child.py" "$VDIR/publish.py" 2>/dev/null || true

# Anything that runs at import time and is not part of the repository's own
# test surface goes, along with stale bytecode: the child starts from /verify,
# never from /app, but a submission is not the place these belong either.
find /app -maxdepth 2 -name 'conftest.py' -delete 2>/dev/null || true
find /app -maxdepth 2 -name 'sitecustomize.py' -delete 2>/dev/null || true
find /app -maxdepth 2 -name 'usercustomize.py' -delete 2>/dev/null || true
find /app -maxdepth 2 -name '*.pth' -delete 2>/dev/null || true
find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Restore every graded pass-to-pass source to its base-commit content, then
# digest-check. HEAD in this container is the base commit; model.patch and
# test.patch touch the working tree only.
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
f60a6b770ae21fb3a9d25f8a5b4ce1fd613f4ee15541ecb7ab25ce3c51207be2  tests/test_risk_budget.py
269032d0a809ca7541f10811d010f5288a779416d44ceb6050ba8f3c9b994ef1  tests/test_risk_budget_admin.py
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

# Process snapshot before the suites, for the post-suite sweep.
proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE=$(proc_list)

run_suite() {
  _xml="$1"; shift
  echo "+ django test -> $_xml ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    setsid timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" "$@" >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" "$@" >> "$RUN_LOG" 2>&1
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

# Sweep: end anything that appeared during the suites and is still running, so
# no process spawned by code under test survives into grading. The chain of
# this script's own ancestors is exempt.
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

# The grader and its configuration must be the bytes this script started with;
# anything else is put back from the private copies before grading.
if [ -n "$TESTS_SHA" ] && [ "$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)" != "$TESTS_SHA" ]; then
  log "ERROR: /tests/grader.py or /tests/config.json changed while the suites ran; restoring the originals"
  chmod 0644 /tests/grader.py /tests/config.json 2>/dev/null || true
  cp "$VDIR/keep/grader.py" /tests/grader.py 2>/dev/null || true
  cp "$VDIR/keep/config.json" /tests/config.json 2>/dev/null || true
  chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
fi

# Publish the reports read-only, only after the sweep.
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
