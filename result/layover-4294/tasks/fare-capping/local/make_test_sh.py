#!/usr/bin/env python3
"""Generate tests/test.sh for fare-capping from the frozen frame.

Only the block between the RUN TESTS markers belongs to this task. Every byte
above and below it is asserted identical to the frame the draft was created
with, so the frozen-file check cannot be failed by an accidental edit.

The digests pinned into the block are read out of the work repository: the
held-back suites from the ``heldout`` branch, the fixture module the repository
suite draws on from ``main``.
"""

from __future__ import annotations

import hashlib
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
WORK = TASK.parent.parent / "work"
FRAME = HERE / "frame.sh"
OUT = TASK / "tests" / "test.sh"

START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"

HELD = ["tests/test_fare_ceilings.py", "tests/test_travel_charges.py"]

# Not run as a suite, but imported by the repository's own tests: the fixture
# module. It is restored from the base commit and pinned beside the graded
# sources, because the pass-to-pass cases draw their networks from it.
SUPPORT = ["tests/support.py"]


def git_show(ref: str, path: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(WORK), "show", "%s:%s" % (ref, path)],
        check=True,
        capture_output=True,
    ).stdout


def pins() -> dict:
    found = {}
    for path in HELD:
        found[path] = hashlib.sha256(git_show("heldout", path)).hexdigest()
    for path in SUPPORT:
        found[path] = hashlib.sha256(git_show("main", path)).hexdigest()
    return found


BLOCK = r'''# >>> RUN TESTS (task-specific) <<<
# Both suites run under the standard library's own runner. Nothing here needs a
# package the verifier image is not promised: tests/Dockerfile guarantees
# python3 and nothing else, and this repository's suite is unittest.
#
# Reports are not written by the process that runs submitted code. A publisher
# that never imports /app mints a per-run token, hands it to a runner child on
# stdin, hears one verdict line per case back on a dedicated descriptor, and
# writes the XML only after that child has exited, its session has been killed,
# and every process that appeared while it ran has been killed too. The child
# runs as nobody, through setpriv, whenever this script is root, so nothing
# imported from /app can write to /tests or /logs, reach the reports, or signal
# the publisher. Its only channel is the pipe.
#
# The runner takes references to every decision point of unittest before /app is
# importable and rechecks them afterwards, and it derives the set of cases it may
# report by parsing the digest-pinned sources. A run that altered the framework,
# or reported an id those sources do not declare, sends no END, and the publisher
# then publishes every declared id as failed, exactly as it does for an id that
# never reported. Where two lines disagree about one id the worse verdict stands,
# so a forked copy of the runner can only ever make a report worse.
unset PYTHONPATH
unset PYTHONSTARTUP
export PYTHONDONTWRITEBYTECODE=1

require_cmd() {{ command -v "$1" >/dev/null 2>&1 || {{ log "ERROR: missing $1"; exit 127; }}; }}
require_cmd python3

# Reports are built somewhere the code under test is never told about, and never
# inside the sandbox the suites are given for scratch space.
GRADE_ROOT="$(mktemp -d 2>/dev/null || echo /tmp/grade.$$)"
mkdir -p "$GRADE_ROOT" 2>/dev/null || true
chmod 0711 "$GRADE_ROOT" 2>/dev/null || true
GRADE_DIR="$GRADE_ROOT/$(head -c 16 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo reports)"
mkdir -p "$GRADE_DIR" 2>/dev/null || GRADE_DIR="$GRADE_ROOT"
chmod 0700 "$GRADE_DIR" 2>/dev/null || true

# The two scripts live beside the reports, not in them: the runner is read by an
# unprivileged child, while nothing but this script may reach the report itself.
CODE_DIR="$GRADE_ROOT/code"
mkdir -p "$CODE_DIR" 2>/dev/null || CODE_DIR="$GRADE_DIR"
chmod 0555 "$CODE_DIR" 2>/dev/null || true

SANDBOX="$(mktemp -d 2>/dev/null || echo /tmp/sandbox.$$)"
mkdir -p "$SANDBOX" 2>/dev/null || true
chmod 0777 "$SANDBOX" 2>/dev/null || true

BASE_XML="$GRADE_DIR/base.xml"
NEW_XML="$GRADE_DIR/new.xml"

# The grader and its configuration are read only from here on, and a private
# copy of each is kept so that, should either move while the suites run, the
# original is put back before grading.
chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
mkdir -p "$GRADE_DIR/keep" 2>/dev/null && chmod 0700 "$GRADE_DIR/keep" 2>/dev/null || true
cp /tests/grader.py "$GRADE_DIR/keep/grader.py" 2>/dev/null || true
cp /tests/config.json "$GRADE_DIR/keep/config.json" 2>/dev/null || true

HELD_SOURCES="{held_sources}"
SUPPORT_SOURCES="{support_sources}"

# The repository suite is the set of test files that existed at the base commit,
# restored to their base content before anything runs, and so is the fixture
# module they import. Every pass-to-pass id lives in one of those files, and
# nothing else stops a submission from rewriting one: grader.py resets only the
# files the held-back patch names, and that patch names two of twenty three.
#
# Restoring rather than refusing is deliberate. A submission that appends cases
# of its own to an existing test file has done nothing wrong; its work is simply
# not what is graded here. Files that did not exist at the base are left alone
# and not run, so a suite the submission brought with it cannot fail, hang or
# crowd the report either.
BASE_COMMIT="$(python3 -I -c 'import json; print(json.load(open("/tests/config.json"))["base_commit"])' 2>/dev/null || echo "")"
BASE_TESTS=""
if [ -n "$BASE_COMMIT" ] && command -v git >/dev/null 2>&1; then
  BASE_TESTS="$(git -C /app ls-tree -r --name-only "$BASE_COMMIT" -- tests 2>/dev/null | grep -E '^tests/.*[.]py$')"
fi

EXISTING=""
if [ -n "$BASE_TESTS" ]; then
  for _rel in $BASE_TESTS; do
    case " $HELD_SOURCES " in
      *" /app/$_rel "*) continue ;;
    esac
    git -C /app checkout "$BASE_COMMIT" -- "$_rel" 2>/dev/null \
      || log "could not restore $_rel from the base commit"
    case "${{_rel##*/}}" in
      test_*.py) [ -f "/app/$_rel" ] && EXISTING="$EXISTING /app/$_rel" ;;
    esac
  done
else
  # git is not promised in this image. Degrade to what is on disk rather than
  # refusing to run: an honest reference run has to score 1 either way.
  log "WARNING: base tree unreadable; running the repository suite in place"
  for _f in /app/tests/test_*.py; do
    [ -f "$_f" ] || continue
    case " $HELD_SOURCES " in
      *" $_f "*) continue ;;
    esac
    EXISTING="$EXISTING $_f"
  done
fi

# The graded sources, pinned by content. A mismatch does not stop the run: it
# publishes reports in which every declared case failed, which a run audit can
# read, where an empty /logs/verifier cannot be told apart from a verifier that
# fell over on its own.
INTEGRITY=ok
{pins}

check_pin() {{
  actual="$(sha256sum "/app/$1" 2>/dev/null | cut -d' ' -f1)"
  if [ "$actual" != "$2" ]; then
    log "INTEGRITY: /app/$1 does not match its expected content"
    INTEGRITY=bad
  fi
}}
{checks}

# These run before any case does, whatever the runner, and none of them exists
# at the base commit. Nothing else in the tree can reach the report.
for _planted in /app/sitecustomize.py /app/usercustomize.py /app/tests/sitecustomize.py \
                /app/tests/usercustomize.py /app/conftest.py /app/tests/conftest.py; do
  if [ -e "$_planted" ]; then
    log "INTEGRITY: $_planted runs before collection and was not there at the base"
    INTEGRITY=bad
  fi
done
# One glob at a time. ``ls`` over two patterns returns non-zero as soon as either
# of them matches nothing, so a single ``ls`` here reports clean on a tree that
# does hold a .pth, which is a guard that reads as working and is not one.
for _dir in /app /app/tests /app/layover; do
  for _planted in "$_dir"/*.pth; do
    [ -e "$_planted" ] || continue
    log "INTEGRITY: $_planted would run before collection"
    INTEGRITY=bad
  done
done
find /app -name '__pycache__' -type d -prune -exec rm -rf {{}} + 2>/dev/null || true

# The runner: loads the pinned sources, runs them in process, and streams one
# verdict line per case to the publisher. It never learns where the report will
# be written. ``-I`` keeps the working directory and every PYTHON* variable off
# the interpreter path; /app is added explicitly, after everything the runner
# needs is already imported, so a module planted in the tree cannot shadow one
# the runner depends on.
cat > "$CODE_DIR/runner.py" <<'PYRUNNER'
import ast, os, sys, unittest

# Bound before /app is importable, and used in place of every later lookup.
WRITE = os.write
GETPID = os.getpid
EXIT = os._exit
OPEN = open
PARSE = ast.parse
PRINT = print
SORTED = sorted
US = chr(31)
NL = chr(10)

token = sys.stdin.readline().strip()
fd = int(sys.argv[1])
sources = sys.argv[2:]
owner = GETPID()

# Everything below happens BEFORE /app can be imported, so the references taken
# here belong to the framework as it shipped, not as anything in the tree may
# later have rearranged it.
FRAMEWORK = []


def watch(owner_, name):
    fn = getattr(owner_, name, None)
    if fn is not None:
        FRAMEWORK.append((owner_, name, fn, getattr(fn, "__code__", None)))


for _name in dir(unittest.TestCase):
    if _name.startswith("assert") or _name.startswith("fail") or _name in (
            "run", "debug", "subTest", "_callTestMethod", "_callSetUp",
            "_callTearDown", "_outcome", "setUp", "tearDown"):
        watch(unittest.TestCase, _name)
for _name in ("addSuccess", "addFailure", "addError", "addSkip",
              "addExpectedFailure", "addUnexpectedSuccess", "addSubTest",
              "startTest", "stopTest", "wasSuccessful", "_exc_info_to_string"):
    watch(unittest.TestResult, _name)
watch(unittest.TestSuite, "run")
watch(unittest.TestLoader, "loadTestsFromName")
# Attribute lookup itself decides which assertion a case gets to call, so it is
# watched alongside the assertions. A replaced __getattribute__ can hand back a
# harmless callable while every method it shadows is still the one that shipped.
for _name in ("__getattribute__", "__getattr__", "__setattr__", "__delattr__",
              "__init__"):
    watch(unittest.TestCase, _name)
    watch(unittest.TestResult, _name)
watch(unittest.TestCase, "__call__")
UNITTEST_MODULE = sys.modules["unittest"]

# Every member of every framework class, by identity, and the metaclass each one
# is built from. This catches an attribute added, removed or rebound, which the
# named list above cannot see on its own.
CLASSES = (unittest.TestCase, unittest.TestResult, unittest.TestSuite,
           unittest.TestLoader)
MEMBERS = [(cls, type(cls), dict(vars(cls))) for cls in CLASSES]
LOADED = {{name: mod for name, mod in sys.modules.items()
          if name == "unittest" or name.startswith("unittest.")}}
# The helpers those classes reach for live in the modules' own globals, so a
# rebound _AssertRaisesContext is caught here rather than nowhere.
GLOBALS = {{name: dict(vars(mod)) for name, mod in LOADED.items()}}


def framework_intact():
    if sys.modules.get("unittest") is not UNITTEST_MODULE:
        return False
    for name, mod in LOADED.items():
        if sys.modules.get(name) is not mod:
            return False
        current = vars(mod)
        for key, value in GLOBALS[name].items():
            if key not in current or current[key] is not value:
                return False
    for cls, meta, members in MEMBERS:
        if type(cls) is not meta:
            return False
        current = vars(cls)
        if set(current) != set(members):
            return False
        for key, value in members.items():
            if current[key] is not value:
                return False
    for owner_, name, fn, code in FRAMEWORK:
        now = getattr(owner_, name, None)
        if now is not fn or getattr(now, "__code__", None) is not code:
            return False
    return True


# What the graded sources declare. Read from the text, which the calling script
# has already pinned by digest, so a run that reports a different set of cases
# than the files describe is refused rather than believed.
def declared(path):
    found = []
    tree = PARSE(OPEN(path, "rb").read())
    module = "tests." + path.split("/")[-1][:-3]
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if item.name.startswith("test"):
                        found.append(module + "." + node.name + "." + item.name)
    return found


expected = set()
for source in sources:
    expected.update(declared(source))
modules = SORTED({{name.rsplit(".", 2)[0] for name in expected}})


class Recorder(unittest.TestResult):
    """Keeps one verdict per case, in the order the suite produced them."""

    def __init__(self):
        super().__init__()
        self.verdicts = []

    def _record(self, test, state, detail=""):
        self.verdicts.append((test.id(), state, detail))

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record(test, "pass")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record(test, "fail", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self._record(test, "fail", self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record(test, "skip", reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._record(test, "fail", "expected failure")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._record(test, "fail", "unexpected success")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self._record(test, "fail", self._exc_info_to_string(err, test))


RECORDER = [(Recorder, n, getattr(Recorder, n), getattr(getattr(Recorder, n), "__code__", None))
            for n in ("_record", "addSuccess", "addFailure", "addError", "addSkip",
                      "addExpectedFailure", "addUnexpectedSuccess", "addSubTest")]


def recorder_intact():
    for owner_, name, fn, code in RECORDER:
        now = getattr(owner_, name, None)
        if now is not fn or getattr(now, "__code__", None) is not code:
            return False
    return True


sys.path.insert(0, "/app")

loader = unittest.TestLoader()
suite = unittest.TestSuite()
for name in modules:
    try:
        suite.addTests(loader.loadTestsFromName(name))
    except Exception as exc:
        PRINT("could not load %s: %s" % (name, exc), file=sys.stderr)

result = Recorder()
suite.run(result)


def assertions_still_decide(sample):
    """Run cases whose verdicts are known, and check the framework agreed.

    Identity checks answer "was this object replaced". They do not answer "does
    an assertion still fail", which is what a rewritten ``__getattribute__``
    breaks while leaving every method it shadows in place. So the last thing the
    runner does is put cases through the same loader, suite and recorder it has
    just graded with, six that have to fail and one that has to pass. The class
    is built to carry the module and class name of a graded case, so code that
    only neuters assertions for the graded suite is caught by it too.
    """
    module_name, class_name, method_name = sample.rsplit(".", 2)

    def equal(self):
        self.assertEqual(1, 2)

    def not_equal(self):
        self.assertNotEqual(1, 1)

    def true(self):
        self.assertTrue(False)

    def false(self):
        self.assertFalse(True)

    def member(self):
        self.assertIn("a", ("b",))

    def raises(self):
        with self.assertRaises(ValueError):
            pass

    def passes(self):
        self.assertEqual(1, 1)

    wanted = {{}}
    body = {{"__module__": module_name, "__qualname__": class_name}}
    for tag, probe, verdict in (
            ("equal", equal, "fail"), ("not_equal", not_equal, "fail"),
            ("true", true, "fail"), ("false", false, "fail"),
            ("member", member, "fail"), ("raises", raises, "fail"),
            ("passes", passes, "pass")):
        name = method_name + "_" + tag
        body[name] = probe
        wanted[module_name + "." + class_name + "." + name] = verdict
    probe_class = type(class_name, (unittest.TestCase,), body)
    probe_suite = unittest.TestSuite(probe_class(name) for name in SORTED(
        key.rsplit(".", 1)[-1] for key in wanted))
    probe_result = Recorder()
    probe_suite.run(probe_result)
    got = {{}}
    for node_id, state, _ in probe_result.verdicts:
        got[node_id] = state
    return got == wanted


# A forked copy of this process never reports.
if GETPID() != owner:
    EXIT(0)

# Tampering is refused: without END the publisher grades every declared id as
# failed. That is a published verdict, not an empty /logs/verifier.
if not framework_intact() or not recorder_intact():
    PRINT("TAMPER: test machinery was altered during the run", file=sys.stderr)
    EXIT(3)

if expected and not assertions_still_decide(SORTED(expected)[0]):
    PRINT("TAMPER: assertions no longer decide anything", file=sys.stderr)
    EXIT(3)
if not framework_intact() or not recorder_intact():
    PRINT("TAMPER: test machinery was altered during the run", file=sys.stderr)
    EXIT(3)

seen = {{}}
for node_id, state, detail in result.verdicts:
    if node_id in seen and seen[node_id] != state:
        state = "fail"
    seen[node_id] = state
    if detail:
        PRINT("---- " + node_id + NL + detail, file=sys.stderr)

# The loader turns a module it cannot import into a synthetic case named
# unittest.loader._FailedTest.<module>. That is not tampering; it is the
# module's declared cases never reporting, which the publisher grades as failed.
# Anything else the sources do not declare is a run that did not grade what was
# pinned.
undeclared = set()
for node_id in seen:
    if node_id.startswith("unittest.loader._FailedTest."):
        PRINT("could not import " + node_id.rsplit(".", 1)[-1], file=sys.stderr)
    elif node_id not in expected:
        undeclared.add(node_id)
if undeclared:
    PRINT("TAMPER: run reported cases the pinned sources do not declare", file=sys.stderr)
    EXIT(3)

count = 0
for node_id in SORTED(seen):
    if node_id.startswith("unittest.loader._FailedTest."):
        continue
    classname, _, name = node_id.rpartition(".")
    line = "V %s %s %s%s%s%s" % (token, seen[node_id], classname, US, name, NL)
    WRITE(fd, line.encode())
    count += 1
WRITE(fd, ("END %s %d%s" % (token, count, NL)).encode())
EXIT(0)
PYRUNNER

# The publisher: never imports /app code, owns the token and the report.
cat > "$CODE_DIR/publish.py" <<'PYPUB'
import json, os, pwd, shutil, signal, subprocess, sys, time

Q = chr(34)
NL = chr(10)
US = chr(31)


def live_pids():
    try:
        return {{int(name) for name in os.listdir("/proc") if name.isdigit()}}
    except OSError:
        return set()


def ancestors():
    chain = set()
    pid = os.getpid()
    while pid > 1:
        chain.add(pid)
        try:
            with open("/proc/%d/stat" % pid) as fh:
                pid = int(fh.read().rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            break
    return chain


def sweep(before, keep):
    """Kill every process that appeared since the suite started, except ours."""
    killed = 0
    for _ in range(3):
        strays = live_pids() - before - keep
        if not strays:
            break
        for pid in strays:
            try:
                os.kill(pid, signal.SIGKILL)
                killed += 1
            except OSError:
                pass
        time.sleep(0.05)
    return killed


def declared_ids(kind):
    try:
        with open("/tests/config.json") as fh:
            config = json.load(fh)
    except Exception:
        return []
    return [nid for nid in config.get(kind, []) if isinstance(nid, str)]


def escape(text):
    out = str(text)
    out = out.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return out.replace(Q, "&quot;")


def render(order, results, reason):
    rows = []
    failures = 0
    for cls, name in order:
        head = "  <testcase classname=" + Q + escape(cls) + Q + " name=" + Q + escape(name) + Q
        state = results[(cls, name)]
        if state == "pass":
            rows.append(head + " />")
            continue
        failures += 1
        tag = "skipped" if state == "skip" else "failure"
        message = reason or "failed; see the raw suite output in run.log"
        rows.append(head + ">" + NL + "    <" + tag + " message=" + Q + escape(message) + Q + " />"
                    + NL + "  </testcase>")
    return ("<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>" + NL
            + "<testsuite name=" + Q + "layover" + Q + " tests=" + Q + str(len(order)) + Q
            + " failures=" + Q + str(failures) + Q + ">" + NL + NL.join(rows) + NL
            + "</testsuite>" + NL)


def spawn(runner, files, w_fd):
    """Start the runner, unprivileged whenever this publisher is root."""
    command = [sys.executable, "-I", runner, str(w_fd)] + files
    setpriv = shutil.which("setpriv")
    if os.geteuid() == 0 and setpriv:
        try:
            nobody = pwd.getpwnam("nobody")
            command = [setpriv, "--reuid=%d" % nobody.pw_uid,
                       "--regid=%d" % nobody.pw_gid, "--clear-groups",
                       "--inh-caps=-all"] + command
            print("[publish] runner runs as nobody (uid %d)" % nobody.pw_uid, flush=True)
        except KeyError:
            print("[publish] no nobody user; runner runs as root", flush=True)
    else:
        print("[publish] runner runs unprivileged as is (euid %d)" % os.geteuid(), flush=True)
    sandbox = os.environ.get("SANDBOX", "/tmp")
    env = {{"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
           "HOME": sandbox, "TMPDIR": sandbox, "PYTHONDONTWRITEBYTECODE": "1",
           "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}}
    return subprocess.Popen(command, stdin=subprocess.PIPE, pass_fds=(w_fd,),
                            cwd="/app", env=env, start_new_session=True)


def main():
    runner, kind, xml_path = sys.argv[1], sys.argv[2], os.environ["REPORT"]
    files = sys.argv[3:]
    before = live_pids()
    keep = ancestors()
    token = os.urandom(16).hex()
    r_fd, w_fd = os.pipe()
    child = spawn(runner, files, w_fd)
    os.close(w_fd)
    child.stdin.write((token + NL).encode())
    child.stdin.flush()
    child.stdin.close()

    rank = {{"pass": 0, "skip": 1, "fail": 2}}
    results = {{}}
    order = []
    heard = 0
    ended = False
    valid = True
    declared = -1
    with os.fdopen(r_fd, "r", errors="replace") as stream:
        for raw in stream:
            line = raw.rstrip(NL)
            if ended:
                valid = False
                break
            parts = line.split(" ", 3)
            if len(parts) == 3 and parts[0] == "END" and parts[1] == token:
                ended = True
                declared = int(parts[2]) if parts[2].isdigit() else -1
                continue
            if len(parts) == 4 and parts[0] == "V" and parts[1] == token:
                outcome, payload = parts[2], parts[3]
                if outcome not in rank or US not in payload:
                    valid = False
                    break
                cls, _, name = payload.partition(US)
                nid = (cls, name)
                heard += 1
                if nid not in results:
                    order.append(nid)
                    results[nid] = outcome
                elif rank[outcome] > rank[results[nid]]:
                    results[nid] = outcome
    rc = child.wait()
    # Nothing that ran submitted code survives past this point: the runner's
    # whole session first, then anything that escaped it.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except OSError:
        pass
    killed = sweep(before, keep)

    reason = None
    if not (valid and ended and declared == heard):
        reason = ("verdict stream refused (valid=%s ended=%s declared=%d heard=%d)"
                  % (valid, ended, declared, heard))
        results, order = {{}}, []
    reported = {{cls + "." + name for cls, name in results}}
    missing = 0
    for joined in declared_ids(kind):
        if joined in reported:
            continue
        cls, _, name = joined.rpartition(".")
        order.append((cls, name))
        results[(cls, name)] = "fail"
        reported.add(joined)
        missing += 1
    document = render(order, results, reason)
    with open(xml_path, "w", encoding="utf-8") as fh:
        fh.write(document)
    os.chmod(xml_path, 0o444)
    with open(xml_path, "r", encoding="utf-8") as fh:
        written = fh.read()
    sealed = written == document
    print("[publish] %s: %d cases, %d declared ids added as failed, child rc %s, "
          "%d stray process(es) killed, sealed=%s%s"
          % (os.path.basename(xml_path), len(order), missing, rc, killed, sealed,
             ("; " + reason) if reason else ""), flush=True)
    if not sealed:
        sys.exit(9)


main()
PYPUB
chmod 0444 "$CODE_DIR/runner.py" "$CODE_DIR/publish.py" 2>/dev/null || true
RUNNER_SHA="$(sha256sum "$CODE_DIR/runner.py" | cut -d' ' -f1)"
PUBLISH_SHA="$(sha256sum "$CODE_DIR/publish.py" | cut -d' ' -f1)"

proc_list() {{ ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }}
PROC_BEFORE="$(proc_list)"
SELF_CHAIN=" $$ "
_p=$PPID
while [ -n "${{_p:-}}" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ]; do
  SELF_CHAIN="$SELF_CHAIN$_p "
  _p=$(awk '{{print $4}}' "/proc/$_p/stat" 2>/dev/null)
done
sweep_strays() {{
  for _pid in $(proc_list); do
    echo "$PROC_BEFORE" | grep -qx "$_pid" && continue
    case "$SELF_CHAIN" in *" $_pid "*) continue ;; esac
    kill -9 "$_pid" 2>/dev/null || true
  done
}}

run_suite() {{
  _report="$1"; _kind="$2"; shift 2
  # The two scripts are read once each, at spawn; a process a suite left behind
  # has no way to rewrite them for the next suite, because it does not survive,
  # and the digests prove it did not.
  if [ "$(sha256sum "$CODE_DIR/runner.py" | cut -d' ' -f1)" != "$RUNNER_SHA" ] \
     || [ "$(sha256sum "$CODE_DIR/publish.py" | cut -d' ' -f1)" != "$PUBLISH_SHA" ]; then
    log "INTEGRITY: the verifier's own scripts were rewritten"
    INTEGRITY=bad
    return 9
  fi
  echo "+ unittest -> ${{_report##*/}} ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    REPORT="$_report" SANDBOX="$SANDBOX" setsid timeout 1500 python3 -I "$CODE_DIR/publish.py" \
      "$CODE_DIR/runner.py" "$_kind" "$@" >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    REPORT="$_report" SANDBOX="$SANDBOX" timeout 1500 python3 -I "$CODE_DIR/publish.py" \
      "$CODE_DIR/runner.py" "$_kind" "$@" >> "$RUN_LOG" 2>&1
    _rc=$?
  fi
  sweep_strays
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
  return $_rc
}}

set +e
# The suites always run, whatever the pins said. Each selection is its own
# publisher and runner, so nothing one suite does to its own process can reach
# the other. A non-zero status means the publisher could not seal what it wrote,
# which is treated as tamper evidence.
log "running the graded suite"
run_suite "$NEW_XML" f2p_node_ids $HELD_SOURCES
if [ $? -ne 0 ]; then
  log "INTEGRITY: the graded suite did not finish cleanly"
  INTEGRITY=bad
fi
log "running the repository suite"
run_suite "$BASE_XML" p2p_node_ids $EXISTING
if [ $? -ne 0 ]; then
  log "INTEGRITY: the repository suite did not finish cleanly"
  INTEGRITY=bad
fi

# Re-check after the code under test has finished, so a suite that rewrote a
# graded source mid-run is caught as well as one that arrived changed.
{recheck}
if [ -f "$GRADE_DIR/keep/grader.py" ]; then
  cmp -s "$GRADE_DIR/keep/grader.py" /tests/grader.py 2>/dev/null || {{
    log "INTEGRITY: /tests/grader.py moved during the run; putting it back"
    cp "$GRADE_DIR/keep/grader.py" /tests/grader.py 2>/dev/null || INTEGRITY=bad
    INTEGRITY=bad
  }}
fi
if [ -f "$GRADE_DIR/keep/config.json" ]; then
  cmp -s "$GRADE_DIR/keep/config.json" /tests/config.json 2>/dev/null || {{
    log "INTEGRITY: /tests/config.json moved during the run; putting it back"
    cp "$GRADE_DIR/keep/config.json" /tests/config.json 2>/dev/null || INTEGRITY=bad
    INTEGRITY=bad
  }}
fi

if [ "$INTEGRITY" != ok ]; then
  log "integrity check failed; publishing reports with every case failed"
  # Rebuilt from the ids the grading config declares, not from a document the
  # run may have written, and without an XML library to read one.
  chmod 0644 "$BASE_XML" "$NEW_XML" 2>/dev/null || true
  python3 -I - "$BASE_XML" "$NEW_XML" <<'FAILALL'
import sys

Q = chr(34)
NL = chr(10)
REASON = "withheld: the graded inputs changed during the run"


def escape(text):
    out = str(text)
    out = out.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return out.replace(Q, "&quot;")


declared = {{}}
try:
    import json
    with open("/tests/config.json", encoding="utf-8") as handle:
        config = json.loads(handle.read())
    declared[sys.argv[1]] = list(config.get("p2p_node_ids") or [])
    declared[sys.argv[2]] = list(config.get("f2p_node_ids") or [])
except Exception as exc:
    print("[verifier] could not read the declared ids: %s" % exc)

for path in sys.argv[1:]:
    ids = declared.get(path)
    if not ids:
        continue
    rows = []
    for node_id in ids:
        classname, _, name = node_id.rpartition(".")
        rows.append("  <testcase classname=" + Q + escape(classname) + Q
                    + " name=" + Q + escape(name) + Q + ">" + NL
                    + "    <failure message=" + Q + REASON + Q + " />" + NL
                    + "  </testcase>")
    document = ("<?xml version=" + Q + "1.0" + Q + " encoding=" + Q + "utf-8" + Q + "?>" + NL
                + "<testsuite name=" + Q + "layover" + Q
                + " tests=" + Q + str(len(ids)) + Q
                + " failures=" + Q + str(len(ids)) + Q + ">" + NL
                + NL.join(rows) + NL + "</testsuite>" + NL)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(document)
    print("[verifier] rebuilt %s with %d case(s) failed" % (path, len(ids)))
FAILALL
fi

# One more sweep before anything is published, then the copy.
sweep_strays
mkdir -p /logs/verifier 2>/dev/null || true
for _pair in "$BASE_XML:/logs/verifier/base.xml" "$NEW_XML:/logs/verifier/new.xml"; do
  _src="${{_pair%%:*}}"; _dst="${{_pair##*:}}"
  if [ -s "$_src" ]; then
    cp "$_src" "$_dst" 2>/dev/null || log "could not publish $_dst"
    chmod 0444 "$_dst" 2>/dev/null || true
  else
    log "WARNING: $_src is empty; $_dst will not be published"
  fi
done
rm -rf "$GRADE_ROOT" "$SANDBOX" 2>/dev/null || true
{end}'''


def main() -> int:
    frame = FRAME.read_text()
    head, rest = frame.split(START, 1)
    _, tail = rest.split(END, 1)

    found = pins()
    pin_lines = "\n".join(
        'PIN_%d="%s"' % (index, digest) for index, digest in enumerate(found.values())
    )
    checks = "\n".join(
        'check_pin "%s" "$PIN_%d"' % (path, index) for index, path in enumerate(found)
    )
    recheck = "\n".join(
        'check_pin "%s" "$PIN_%d"' % (path, index) for index, path in enumerate(found)
    )
    block = BLOCK.format(
        end=END,
        pins=pin_lines,
        checks=checks,
        recheck=recheck,
        held_sources=" ".join("/app/" + path for path in HELD),
        support_sources=" ".join("/app/" + path for path in SUPPORT),
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + block + tail)

    written = OUT.read_text()
    w_head, w_rest = written.split(START, 1)
    _, w_tail = w_rest.split(END, 1)
    assert w_head == head, "the bytes above the RUN TESTS marker changed"
    assert w_tail == tail, "the bytes below the RUN TESTS marker changed"
    print("wrote %s (%d lines)" % (OUT, len(written.splitlines())))
    print("frame sha256", hashlib.sha256((head + tail).encode()).hexdigest()[:16])
    for path, digest in found.items():
        print("  pinned %s %s" % (digest[:12], path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
