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
# The suites run under the standard library's own runner. Nothing here needs
# a package the verifier image is not guaranteed to have: tests/Dockerfile
# promises python3 and nothing else, and this repository's suite is unittest.
#
# Reports are not written by the process that runs submitted code. A
# publisher that never imports /app mints a per-run token, hands it to a
# runner child on stdin, hears one verdict line per case back on a dedicated
# descriptor, and writes the XML only after the child has exited, its whole
# session has been killed, and every process that appeared during the suite
# has been killed too. No report file exists while /app code can run, and no
# process that ran /app code survives to the moment one does. The runner takes
# references to every decision point of unittest before /app is importable
# and rechecks them afterwards; a run that altered the framework, or reported
# an id the digest-pinned sources do not declare, sends no END, and the
# publisher then publishes every declared id as failed, as it does for any id
# the run never reported. Where two lines disagree about one id the worse
# verdict stands, so a forked copy of the runner can only make a report worse.

require_cmd() { command -v "$1" >/dev/null 2>&1 || { log "ERROR: missing $1"; exit 127; }; }
require_cmd python3

# Reports are built somewhere the code under test is never told about, and
# never inside the suites' own TMPDIR.
GRADE_ROOT="$(mktemp -d 2>/dev/null || echo /tmp/grade.$$)"
mkdir -p "$GRADE_ROOT" 2>/dev/null || true
chmod 0711 "$GRADE_ROOT" 2>/dev/null || true
GRADE_DIR="$GRADE_ROOT/$(head -c 16 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo reports)"
mkdir -p "$GRADE_DIR" 2>/dev/null || GRADE_DIR="$GRADE_ROOT"
chmod 0700 "$GRADE_DIR" 2>/dev/null || true

# The grader and its configuration are read only from here on, and a private
# copy of each is kept so that, should either move while the suites run, the
# original is put back before grading.
chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
KEEP="$GRADE_ROOT/keep"
mkdir -p "$KEEP" 2>/dev/null && chmod 0700 "$KEEP" 2>/dev/null || true
cp /tests/grader.py "$KEEP/grader.py" 2>/dev/null || true
cp /tests/config.json "$KEEP/config.json" 2>/dev/null || true
TESTS_SHA="$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)"

# The runner is read by an unprivileged child, so it sits beside the reports
# rather than inside them: the reports stay root only, the script does not.
RUN_DIR="$GRADE_ROOT/run"
mkdir -p "$RUN_DIR" 2>/dev/null || RUN_DIR="$GRADE_DIR"
chmod 0755 "$RUN_DIR" 2>/dev/null || true

SANDBOX="$(mktemp -d 2>/dev/null || echo /tmp/sandbox.$$)"
mkdir -p "$SANDBOX" 2>/dev/null || true
chmod 0777 "$SANDBOX" 2>/dev/null || true

BASE_XML="$GRADE_DIR/base.xml"
NEW_XML="$GRADE_DIR/new.xml"

# The graded sources, pinned by content.  A mismatch does not stop the run:
# it publishes reports in which every case failed, which a run audit can
# read, where an empty /logs/verifier cannot be told apart from a verifier
# that fell over.
INTEGRITY=ok
PIN_0="424c73b3d6975bc9172b0b205c5ffe8ea2564d6a949330ac84b1bfb6f154dc69"
PIN_1="a9159278920fdd31ec4ccc64e647783b10b691c714c3fe653391166dd103f2e4"
PIN_2="7200f611b2e602f3a242b6bea1d5f6d10e2d311f0f92a1a50b4816ec8b5eb5cd"
PIN_3="1645780504ed66976122d76ce208d2d92dbef6880c8b1530ffad18780e9b6d5d"

check_pin() {
  actual="$(sha256sum "/app/$1" 2>/dev/null | cut -d' ' -f1)"
  if [ "$actual" != "$2" ]; then
    log "INTEGRITY: /app/$1 does not match its expected content"
    INTEGRITY=bad
  fi
}
check_pin "tests/test_plan_backward.py" "$PIN_0"
check_pin "tests/test_arrive_by.py" "$PIN_1"
check_pin "tests/__init__.py" "$PIN_2"
check_pin "tests/support.py" "$PIN_3"

# These run before any test does, whatever the runner, and none exists at
# the base commit.  Nothing else in the tree can reach the report.
for _planted in /app/sitecustomize.py /app/usercustomize.py /app/tests/sitecustomize.py; do
  if [ -e "$_planted" ]; then
    log "INTEGRITY: $_planted runs before collection and was not there at the base"
    INTEGRITY=bad
  fi
done
# One glob at a time. ``ls`` over two patterns returns non-zero as soon as
# either of them matches nothing, so a single ``ls`` here reports clean on a
# tree that does hold a .pth, which is a guard that reads as working and is
# not one.
for _dir in /app /app/tests; do
  for _planted in "$_dir"/*.pth; do
    [ -e "$_planted" ] || continue
    log "INTEGRITY: $_planted would run before collection"
    INTEGRITY=bad
  done
done

HELD_SOURCES="/app/tests/test_plan_backward.py /app/tests/test_arrive_by.py"
SUPPORT_SOURCES="/app/tests/__init__.py /app/tests/support.py"

# The repository suite is the set of test files that existed at the base
# commit, restored to their base content before anything runs. Every
# pass-to-pass id lives in one of these, and nothing else stops a submission
# from rewriting one: grader.py resets only the files the held-out patch
# names, and this patch names two of nineteen.
#
# Restoring rather than refusing is deliberate. A submission that appends its
# own cases to an existing test file has done nothing wrong; its work is
# simply not what gets graded. Files that did not exist at the base are left
# alone and not run, so a suite the submission brought with it cannot fail,
# hang or crowd the report either.
BASE_COMMIT="$(python3 -I -c 'import json; print(json.load(open("/tests/config.json"))["base_commit"])' 2>/dev/null || echo "")"
BASE_TESTS=""
if [ -n "$BASE_COMMIT" ] && command -v git >/dev/null 2>&1; then
  BASE_TESTS="$(git -C /app ls-tree -r --name-only "$BASE_COMMIT" -- tests 2>/dev/null | grep -E '^tests/test_.*[.]py$')"
fi

EXISTING=""
if [ -n "$BASE_TESTS" ]; then
  for _rel in tests/__init__.py tests/support.py; do
    git -C /app checkout "$BASE_COMMIT" -- "$_rel" 2>/dev/null \
      || log "could not restore $_rel from the base commit"
  done
  for _rel in $BASE_TESTS; do
    case " $HELD_SOURCES " in
      *" /app/$_rel "*) continue ;;
    esac
    git -C /app checkout "$BASE_COMMIT" -- "$_rel" 2>/dev/null \
      || log "could not restore $_rel from the base commit"
    [ -f "/app/$_rel" ] && EXISTING="$EXISTING /app/$_rel"
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
find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# The runner: loads the pinned sources, runs them in-process, and streams one
# verdict line per case to the publisher. It never learns where the report
# will be written. ``-I`` keeps the working directory and every PYTHON*
# variable off the interpreter path; /app is added explicitly, after
# everything the runner needs is already imported, so a module planted in the
# tree cannot shadow one the runner depends on.
cat > "$RUN_DIR/runner.py" <<'PYRUNNER'
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

# Everything below happens BEFORE /app can be imported, so the references
# taken here belong to the framework as it shipped, not as anything in the
# tree may later have rearranged it.
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
UNITTEST_MODULE = sys.modules["unittest"]

def framework_intact():
    if sys.modules.get("unittest") is not UNITTEST_MODULE:
        return False
    for owner_, name, fn, code in FRAMEWORK:
        now = getattr(owner_, name, None)
        if now is not fn or getattr(now, "__code__", None) is not code:
            return False
    return True

# What the graded sources declare. Read from the text, which the calling
# script has already pinned by digest, so a run that reports a different set
# of cases than the files describe is refused rather than believed.
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
modules = SORTED({name.rsplit(".", 2)[0] for name in expected})

class Recorder(unittest.TestResult):
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

RECORDER = [(Recorder, n, getattr(Recorder, n), getattr(getattr(Recorder, n), "__code__", None))
            for n in ("_record", "addSuccess", "addFailure", "addError", "addSkip",
                      "addExpectedFailure", "addUnexpectedSuccess")]

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

# A forked copy of this process never reports.
if GETPID() != owner:
    EXIT(0)

# Tampering is refused: without END the publisher grades every declared id
# as failed. That is a published verdict, not an empty /logs/verifier.
if not framework_intact() or not recorder_intact():
    PRINT("TAMPER: test machinery was altered during the run", file=sys.stderr)
    EXIT(3)

seen = {}
for node_id, state, detail in result.verdicts:
    if node_id in seen and seen[node_id] != state:
        state = "fail"
    seen[node_id] = state
    if detail:
        PRINT("---- " + node_id + NL + detail, file=sys.stderr)

# The loader turns a module it cannot import into a synthetic case named
# unittest.loader._FailedTest.<module>. That is not tampering; it is the
# module's declared cases never reporting, which the publisher grades as
# failed. Anything else the sources do not declare is a run that did not
# grade what was pinned.
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
cat > "$GRADE_DIR/publish.py" <<'PYPUB'
import json, os, pwd, shutil, signal, subprocess, sys, time

Q = chr(34)
NL = chr(10)
US = chr(31)


def live_pids():
    try:
        return {int(name) for name in os.listdir("/proc") if name.isdigit()}
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
    # Kill every process that appeared since ``before``, except ours.
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


def main():
    runner, kind, xml_path = sys.argv[1], sys.argv[2], os.environ["REPORT"]
    files = sys.argv[3:]
    before = live_pids()
    keep = ancestors()
    token = os.urandom(16).hex()
    r_fd, w_fd = os.pipe()
    env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
           "HOME": os.environ.get("SANDBOX", "/tmp"), "TMPDIR": os.environ.get("SANDBOX", "/tmp"),
           "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    command = [sys.executable, "-I", runner, str(w_fd)] + files
    # The child runs code from /app, so it runs as nobody whenever this
    # publisher is root: it can then neither write to /tests or /logs, nor
    # signal this process, and its only channel out is the pipe.
    setpriv = shutil.which("setpriv")
    if os.geteuid() == 0 and setpriv:
        try:
            nobody = pwd.getpwnam("nobody")
            command = [setpriv, "--reuid=%d" % nobody.pw_uid,
                       "--regid=%d" % nobody.pw_gid, "--clear-groups",
                       "--inh-caps=-all"] + command
            print("[publish] child runs as nobody (uid %d)" % nobody.pw_uid, flush=True)
        except KeyError:
            print("[publish] no nobody user; child runs as root", flush=True)
    else:
        print("[publish] child runs unprivileged-as-is (euid %d)" % os.geteuid(), flush=True)
    child = subprocess.Popen(
        command,
        stdin=subprocess.PIPE, pass_fds=(w_fd,), cwd="/app", env=env,
        start_new_session=True)
    os.close(w_fd)
    child.stdin.write((token + NL).encode())
    child.stdin.flush()
    child.stdin.close()

    rank = {"pass": 0, "skip": 1, "fail": 2}
    results = {}
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
        results, order = {}, []
    reported = {cls + "." + name for cls, name in results}
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
chmod 0444 "$RUN_DIR/runner.py" "$GRADE_DIR/publish.py" 2>/dev/null || true
RUNNER_SHA="$(sha256sum "$RUN_DIR/runner.py" | cut -d' ' -f1)"
PUBLISH_SHA="$(sha256sum "$GRADE_DIR/publish.py" | cut -d' ' -f1)"

proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE="$(proc_list)"
SELF_CHAIN=" $$ "
_p=$PPID
while [ -n "${_p:-}" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ]; do
  SELF_CHAIN="$SELF_CHAIN$_p "
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null)
done
sweep_strays() {
  for _pid in $(proc_list); do
    echo "$PROC_BEFORE" | grep -qx "$_pid" && continue
    case "$SELF_CHAIN" in *" $_pid "*) continue ;; esac
    kill -9 "$_pid" 2>/dev/null || true
  done
}

run_suite() {
  _report="$1"; _kind="$2"; shift 2
  # The two scripts are read once each, at spawn; a process a suite left
  # behind has no way to rewrite them for the next suite, because it does
  # not survive, and the digests prove it did not.
  if [ "$(sha256sum "$RUN_DIR/runner.py" | cut -d' ' -f1)" != "$RUNNER_SHA" ] \
     || [ "$(sha256sum "$GRADE_DIR/publish.py" | cut -d' ' -f1)" != "$PUBLISH_SHA" ]; then
    log "INTEGRITY: the verifier's own scripts were rewritten"
    INTEGRITY=bad
    return 9
  fi
  echo "+ unittest -> ${_report##*/} ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    REPORT="$_report" SANDBOX="$SANDBOX" setsid timeout 1500 python3 -I "$GRADE_DIR/publish.py" \
      "$RUN_DIR/runner.py" "$_kind" "$@" >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    REPORT="$_report" SANDBOX="$SANDBOX" timeout 1500 python3 -I "$GRADE_DIR/publish.py" \
      "$RUN_DIR/runner.py" "$_kind" "$@" >> "$RUN_LOG" 2>&1
    _rc=$?
  fi
  sweep_strays
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
  return $_rc
}

set +e
# The suites always run, whatever the pins said. Each selection is its own
# publisher and runner, so nothing one suite does to its own process can
# reach the other. A non-zero status means the publisher could not seal
# what it wrote, which is treated as tamper evidence.
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
# Re-check after the code under test has finished, so a suite that rewrote
# a graded source mid-run is caught as well as one that arrived changed.
  check_pin "tests/test_plan_backward.py" "$PIN_0"
  check_pin "tests/test_arrive_by.py" "$PIN_1"
  check_pin "tests/__init__.py" "$PIN_2"
  check_pin "tests/support.py" "$PIN_3"

# The grader and its configuration must be the bytes this block started with;
# anything else is put back from the private copies before grading.
if [ -n "$TESTS_SHA" ]    && [ "$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)" != "$TESTS_SHA" ]; then
  log "INTEGRITY: /tests/grader.py or /tests/config.json changed while the suites ran; restoring"
  chmod 0644 /tests/grader.py /tests/config.json 2>/dev/null || true
  cp "$KEEP/grader.py" /tests/grader.py 2>/dev/null || true
  cp "$KEEP/config.json" /tests/config.json 2>/dev/null || true
  chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
fi

if [ "$INTEGRITY" != ok ]; then
  log "integrity check failed; publishing reports with every case failed"
  # Rebuilt from the ids the grading config declares, not from a document
  # the run may have written, and without an XML library to read one.
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


declared = {}
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
  _src="${_pair%%:*}"; _dst="${_pair##*:}"
  if [ -s "$_src" ]; then
    cp "$_src" "$_dst" 2>/dev/null || log "could not publish $_dst"
    chmod 0444 "$_dst" 2>/dev/null || true
  else
    log "WARNING: $_src is empty; $_dst will not be published"
  fi
done
rm -rf "$GRADE_ROOT" "$SANDBOX" 2>/dev/null || true
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
