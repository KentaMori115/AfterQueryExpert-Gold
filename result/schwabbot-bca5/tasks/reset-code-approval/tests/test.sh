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
# The image ships no pytest, so the two selections are driven through
# Django's own runner by a child that lives outside /app: it reads a
# per-run token on stdin, imports unittest and django.test while /app is
# still off sys.path, snapshots every decision point in both, and streams
# one verdict per case on an inherited descriptor. A root publisher that
# never imports repository code turns that stream into the two reports
# config.json names, and publishes every declared id, failing the ones no
# verdict arrived for. The child runs as nobody wherever this script is
# root, so nothing a suite imports can reach the reports, the checkout it
# is graded against, or the list of ids that are graded.
set +e
unset PYTHONPATH
BASE_SHA="7bc88a1c75c331045b5714ee4a411e0321efc5a1"

# Knowing which ids are graded is the difference between forging a report
# and reproducing a whole run, and no suite needs that list.
chmod -R go-rwx /tests 2>/dev/null || true

VDIR=/verify
if ! mkdir -p "$VDIR" 2>/dev/null; then
  VDIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"
  mkdir -p "$VDIR" 2>/dev/null
fi
log "harness in $VDIR"

# The graded suites come back from the base commit, and stale bytecode
# goes, so nothing a submission left behind decides an outcome.
for _src in "tests/__init__.py" "tests/test_offline.py" "tests/test_schwab_api.py" "tests/test_server_api.py" "tests/test_user_allow.py" "Users/tests.py" "AdminCustom/tests.py" "BotList/tests.py" "Engine/tests.py"; do
  git -C /app checkout -q "$BASE_SHA" -- "$_src" 2>>"$RUN_LOG" || log "could not restore $_src"
done
find /app -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null

cat > "$VDIR/child.py" <<'__CHILD__'
"""Run one selection of Django tests and stream a verdict per case.

The suite imports everything under /app before a single case runs, so the
framework that decides what a case reports must not come from there. The
interpreter starts isolated, imports unittest and django.test while /app is
still off sys.path, takes an identity snapshot of every decision point in
both, and only then makes the project importable. The snapshot is rechecked
at every verdict and once more at the end; a run that moved any of it sends
no END line and the publisher fails every declared id.

django.setup() has to run repository code before any test module can be
imported, so an import hook installed there could rewrite the graded modules
on their way in without touching a single guarded object. The graded sources
are therefore read and compiled up front, while the interpreter is still
clean, and the modules are built from those code objects afterwards. The
loader finds them already in sys.modules and never consults the import
machinery for them at all.

Verdicts leave on an inherited descriptor, never on stdout, so nothing a
suite prints can be mistaken for one, and the token that stamps them is read
from stdin before /app exists on the path.
"""

import os
import sys
import types


APP = "/app"


def decides(value):
    """Whether an attribute can change what the framework does.

    Functions, classes and descriptors decide; plain data does not, and both
    unittest and django.test legitimately write module level data while they
    run. The test reads the value's type rather than the value, because
    django.test holds lazy proxies that would go and import settings the
    moment anything asks them what they are, and settings live under /app.
    """
    try:
        if type(value) in (property, classmethod, staticmethod):
            return True
        return callable(value)
    except Exception:
        return False


def guarded_modules():
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name == "unittest" or name.startswith("unittest."):
            found[name] = mod
        elif name == "django.test" or name.startswith("django.test."):
            found[name] = mod
    return found


def import_machinery():
    """The finders and path hooks in force, in order, held by reference."""
    return tuple(sys.meta_path), tuple(sys.path_hooks)


def snapshot():
    """Every decision point of the loaded framework, held by reference."""
    modules = {}
    classes = {}
    for name, mod in guarded_modules().items():
        attrs = {k: v for k, v in vars(mod).items() if decides(v)}
        modules[name] = (mod, attrs)
        for key, value in attrs.items():
            if isinstance(value, type) and getattr(value, "__module__", None) == name:
                members = {k: v for k, v in vars(value).items() if decides(v)}
                classes[(name, key)] = (value, members)
    return modules, classes, import_machinery()


def drift(guard):
    """Decision points that are no longer the objects they were, or are new."""
    modules, classes, machinery = guard
    moved = set()
    if import_machinery() != machinery:
        moved.add(("import-machinery",))
    for name, (mod, attrs) in modules.items():
        if sys.modules.get(name) is not mod:
            moved.add(("swap", name))
        live = vars(mod)
        for key, value in attrs.items():
            if key not in live or live[key] is not value:
                moved.add(("mod", name, key))
        for key, value in live.items():
            if key not in attrs and decides(value):
                moved.add(("mod", name, key))
    for (name, key), (cls, members) in classes.items():
        live = vars(cls)
        for member, value in members.items():
            if member not in live or live[member] is not value:
                moved.add(("cls", name, key, member))
        for member, value in live.items():
            if member not in members and decides(value):
                moved.add(("cls", name, key, member))
    return moved


def import_framework():
    """Load unittest and django.test with /app nowhere on the path."""
    sys.path[:] = [p for p in sys.path if p and not p.startswith(APP)]
    import unittest  # noqa: F401
    import unittest.case  # noqa: F401
    import unittest.loader  # noqa: F401
    import unittest.result  # noqa: F401
    import unittest.runner  # noqa: F401
    import unittest.suite  # noqa: F401
    import django
    import django.test  # noqa: F401
    import django.test.client  # noqa: F401
    import django.test.runner  # noqa: F401
    import django.test.testcases  # noqa: F401
    import django.test.utils  # noqa: F401
    if django.__file__.startswith(APP):
        print("[runner] django resolved from the tree under test", flush=True)
        os._exit(3)
    print("[runner] django %s from %s" % (django.get_version(), django.__file__), flush=True)
    return django


def precompile(labels):
    """Read and compile every graded module before anything from /app runs.

    A code object cannot be rewritten by an import hook that appears later,
    so this is the only moment the graded sources can be taken at their word:
    the interpreter has run nothing from the tree under test yet, builtins are
    the interpreter's own, and sys.meta_path is untouched.
    """
    packages = []
    units = []
    seen = set()
    for dotted in labels:
        package = dotted.rpartition(".")[0]
        if package == "tests" and package not in seen:
            seen.add(package)
            init = os.path.join(APP, "tests", "__init__.py")
            with open(init, "rb") as handle:
                packages.append((package, init, compile(handle.read(), init, "exec")))
        path = os.path.join(APP, dotted.replace(".", "/") + ".py")
        with open(path, "rb") as handle:
            units.append((dotted, path, compile(handle.read(), path, "exec")))
    return packages, units


def install(packages, units):
    """Build the graded modules from the code compiled up front.

    They go straight into sys.modules, so the loader finds them there and the
    import machinery is never asked to produce them. The Users package is the
    real one django.setup() built and is left alone; only its tests module is
    supplied from here.
    """
    for name, path, code in packages:
        module = types.ModuleType(name)
        module.__file__ = path
        module.__path__ = [os.path.dirname(path)]
        module.__package__ = name
        sys.modules[name] = module
        exec(code, module.__dict__)
    for dotted, path, code in units:
        package, _, leaf = dotted.rpartition(".")
        module = types.ModuleType(dotted)
        module.__file__ = path
        module.__package__ = package
        sys.modules[dotted] = module
        exec(code, module.__dict__)
        parent = sys.modules.get(package)
        if parent is not None:
            setattr(parent, leaf, module)


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    labels = sys.argv[2:]
    # Bound before anything under /app can run. Rebinding os.write later
    # changes nothing here, and a forked copy of this process never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()

    django = import_framework()
    import unittest
    from django.test.runner import DiscoverRunner
    from django.test.utils import setup_test_environment, teardown_test_environment

    graded = precompile(labels)
    guard = snapshot()
    baseline = len(guard[0]) + len(guard[1])
    print("[runner] framework guard over %d modules and classes, %d graded "
          "modules compiled up front"
          % (baseline, len(graded[0]) + len(graded[1])), flush=True)

    # Only now is the project importable. It goes on the front, the way
    # manage.py puts it there, because one of the installed dependencies
    # ships a top level "tests" package that would otherwise answer for the
    # repository's own. Nothing the framework needs can be shadowed by that:
    # unittest and django.test are already imported, already in sys.modules,
    # and every decision point in them is under the guard taken above.
    sys.path.insert(0, APP)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "SchwabOptionBot.settings")
    django.setup()
    install(*graded)

    state = {"n": 0, "tampered": False}

    class Streamer(unittest.TestResult):
        """One verdict per case, worst outcome wins within a case."""

        def __init__(self):
            super().__init__()
            self.current = None

        def startTest(self, test):
            super().startTest(test)
            self.current = "passed"

        def addError(self, test, err):
            super().addError(test, err)
            self.current = "failed"

        def addFailure(self, test, err):
            super().addFailure(test, err)
            self.current = "failed"

        def addSubTest(self, test, subtest, err):
            super().addSubTest(test, subtest, err)
            if err is not None:
                self.current = "failed"

        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            if self.current == "passed":
                self.current = "skipped"

        def addExpectedFailure(self, test, err):
            super().addExpectedFailure(test, err)
            self.current = "failed"

        def addUnexpectedSuccess(self, test):
            super().addUnexpectedSuccess(test)
            self.current = "failed"

        def stopTest(self, test):
            super().stopTest(test)
            if getpid() != owner:
                return
            if drift(guard):
                state["tampered"] = True
                self.current = None
                return
            outcome = self.current or "failed"
            self.current = None
            node = test.id()
            head, _, name = node.rpartition(".")
            line = "V %s %s %s\x1f%s\n" % (token, outcome, head, name)
            write(fd, line.encode())
            state["n"] += 1

    runner = DiscoverRunner(verbosity=0, interactive=False, parallel=1, keepdb=False)
    setup_test_environment()
    suite = runner.build_suite(labels)
    old_config = runner.setup_databases()
    result = Streamer()
    try:
        suite.run(result)
    finally:
        runner.teardown_databases(old_config)
        teardown_test_environment()

    if getpid() != owner:
        os._exit(0)
    if state["tampered"] or drift(guard):
        print("[runner] framework was altered during the run", flush=True)
        os._exit(3)
    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    sys.exit(0)


main()
__CHILD__

cat > "$VDIR/publish.py" <<'__PUBLISH__'
"""Turn one child's verdict stream into the JUnit report grading reads.

This process never imports anything from /app. It owns the token, the pipe
and the file, and it publishes every id config.json declares for the report,
so a refused stream, a crashed child or a case that never ran all land as a
failure with a reason rather than as a missing entry.
"""

import json
import os
import subprocess
import sys
from xml.sax.saxutils import escape, quoteattr


RANK = {"passed": 0, "skipped": 1, "failed": 2}


def declared_ids(xml_path):
    """The ids this report is graded on, read from the verifier's own config."""
    try:
        with open("/tests/config.json") as handle:
            config = json.load(handle)
    except Exception:
        return []
    key = "p2p_node_ids" if os.path.basename(xml_path) == "base.xml" else "f2p_node_ids"
    return [nid for nid in config.get(key, []) if isinstance(nid, str)]


def drop_privileges():
    """Become nobody, for when the shell had no setpriv to do it."""
    try:
        import pwd
        entry = pwd.getpwnam("nobody")
        uid, gid = entry.pw_uid, entry.pw_gid
    except Exception:
        uid, gid = 65534, 65534

    def apply():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        if os.getuid() != uid or os.geteuid() != uid:
            os._exit(97)

    return apply


def start_child(vdir, scratch, labels, write_fd):
    runas = os.environ.get("RUNAS", "").split()
    preexec = None
    if not runas and os.geteuid() == 0:
        preexec = drop_privileges()
        print("[publish] no setpriv; dropping the child to nobody here", flush=True)
    argv = runas + [
        sys.executable, "-I", "-B", os.path.join(vdir, "child.py"), str(write_fd),
    ] + labels
    return subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        pass_fds=(write_fd,),
        preexec_fn=preexec,
        cwd="/app",
        env={
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "TMPDIR": scratch,
            "HOME": scratch,
            "LC_ALL": "C.UTF-8",
            "SBOT_OFFLINE": "1",
            "DJANGO_SETTINGS_MODULE": "SchwabOptionBot.settings",
        },
    )


def read_stream(read_fd, token):
    """Collect verdicts, and say whether the stream may be believed."""
    results = {}
    heard = 0
    ended = False
    valid = True
    counted = -1
    with os.fdopen(read_fd, "r", errors="replace") as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            if ended:
                # Nothing may follow END. A late line poisons the stream.
                valid = False
                break
            parts = line.split(" ", 3)
            if len(parts) == 3 and parts[0] == "END" and parts[1] == token:
                ended = True
                counted = int(parts[2]) if parts[2].isdigit() else -1
                continue
            if len(parts) == 4 and parts[0] == "V" and parts[1] == token:
                outcome, payload = parts[2], parts[3]
                if outcome not in RANK or "\x1f" not in payload:
                    valid = False
                    break
                classname, _, name = payload.partition("\x1f")
                nid = "%s.%s" % (classname, name)
                heard += 1
                if nid not in results or RANK[outcome] > RANK[results[nid]]:
                    results[nid] = outcome
            # Untokenised lines are ignored. Only the child was given a token.
    return results, heard, ended, valid, counted


def write_report(path, rows):
    failures = sum(1 for _, status, _ in rows if status != "passed")
    out = ['<?xml version="1.0" encoding="utf-8"?>']
    out.append(
        '<testsuite name=%s tests="%d" failures="%d" errors="0" skipped="0">'
        % (quoteattr(os.path.basename(path)), len(rows), failures)
    )
    for nid, status, note in rows:
        classname, _, name = nid.rpartition(".")
        out.append(
            "  <testcase classname=%s name=%s>" % (quoteattr(classname), quoteattr(name))
        )
        if status != "passed":
            out.append(
                '    <failure message=%s>%s</failure>'
                % (quoteattr(note or status), escape(note or status))
            )
        out.append("  </testcase>")
    out.append("</testsuite>")
    with open(path, "w") as handle:
        handle.write("\n".join(out) + "\n")


def main():
    vdir, scratch, xml_path = sys.argv[1], sys.argv[2], sys.argv[3]
    labels = sys.argv[4:]
    token = os.urandom(16).hex()
    read_fd, write_fd = os.pipe()
    try:
        child = start_child(vdir, scratch, labels, write_fd)
    except Exception as exc:
        print("[publish] could not start the child (%s)" % exc, flush=True)
        child = None
    os.close(write_fd)
    if child is not None:
        child.stdin.write((token + "\n").encode())
        child.stdin.flush()
        child.stdin.close()
        results, heard, ended, valid, counted = read_stream(read_fd, token)
        rc = child.wait()
    else:
        os.close(read_fd)
        results, heard, ended, valid, counted, rc = {}, 0, False, False, -1, 98

    reason = None
    if not (valid and ended and counted == heard):
        reason = (
            "verdict stream refused (valid=%s ended=%s counted=%d heard=%d rc=%s)"
            % (valid, ended, counted, heard, rc)
        )
        print("[publish] %s" % reason, flush=True)
        results = {}

    rows = []
    passed = 0
    for nid in declared_ids(xml_path):
        status = results.get(nid)
        if status == "passed":
            rows.append((nid, "passed", ""))
            passed += 1
        elif status is None:
            rows.append((nid, "failed", reason or "the run reported no result for this test"))
        else:
            rows.append((nid, "failed", "reported %s" % status))
    write_report(xml_path, rows)
    print(
        "[publish] %s: %d of %d declared passed (%d verdicts heard)"
        % (os.path.basename(xml_path), passed, len(rows), heard),
        flush=True,
    )


main()
__PUBLISH__

SCRATCH="$VDIR/tmp"
mkdir -p "$SCRATCH" 2>/dev/null
chown -R root:root "$VDIR" 2>/dev/null
chmod 0444 "$VDIR"/*.py 2>/dev/null
chmod 0555 "$VDIR" 2>/dev/null
chmod 1777 "$SCRATCH" 2>/dev/null

# Drop the child. Submitted code runs inside it, so it must not reach the
# verifier's files. With no setpriv the publisher drops it instead, and
# either way the block runs rather than refusing to run.
RUNAS=""
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  _uid=$(id -u nobody 2>/dev/null || echo 65534)
  _gid=$(id -g nogroup 2>/dev/null || id -g nobody 2>/dev/null || echo 65534)
  if setpriv --reuid="$_uid" --regid="$_gid" --clear-groups true >/dev/null 2>&1; then
    RUNAS="setpriv --reuid=$_uid --regid=$_gid --clear-groups"
    log "suite child runs as uid $_uid gid $_gid"
  fi
fi
export RUNAS

run_selection() {
  _out="$1"; shift
  echo "+ selection $_out: $*" >> "$RUN_LOG" 2>/dev/null
  timeout 700 python3 -I "$VDIR/publish.py" "$VDIR" "$SCRATCH" "$_out" "$@" 2>&1 | tee -a "$RUN_LOG"
}

cd /app || exit 6
run_selection /logs/verifier/base.xml tests.test_offline tests.test_schwab_api tests.test_server_api tests.test_user_allow Users.tests AdminCustom.tests BotList.tests Engine.tests
run_selection /logs/verifier/new.xml tests.test_reset_gate tests.test_reset_clock
set -e
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
