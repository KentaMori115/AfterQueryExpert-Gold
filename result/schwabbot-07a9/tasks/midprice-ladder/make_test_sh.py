#!/usr/bin/env python3
"""Generate tests/test.sh from the frozen frame.

Only the block between the RUN TESTS markers is ours. Every byte above and
below the markers is asserted identical to the platform frame before this
writes anything, so the frozen-frame check cannot be failed by accident.

The image carries no pytest, so the suites run under the standard library's
own runner with Django bootstrapped by hand, and the JUnit XML the grader
reads is assembled here as text.
"""

from __future__ import annotations

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FRAME = HERE / "frame_test.sh"
OUT = HERE / "tests" / "test.sh"
CONFIG = json.loads((HERE / "tests" / "config.json").read_text())
PINS = json.loads((HERE / "pins.json").read_text())

START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"

HELD = ["tests/test_working_orders.py", "tests/test_order_concession.py"]
P2P_FILES = sorted({nid.rsplit(".", 2)[0].replace(".", "/") + ".py"
                    for nid in CONFIG["p2p_node_ids"]})

BLOCK = r'''{start}
# There is no pytest in this image: the environment build installs the
# eleven pinned requirements and nothing else, and both containers run with
# allow_internet = false. So the suites run under the standard library's own
# runner, with Django brought up by hand, and the JUnit the grader reads is
# written as text by a second interpreter.
#
# Grading is split across two processes and the split is the point. The
# first imports /app and runs the cases but cannot write a report: all it
# can do is emit verdict lines on an inherited descriptor, each carrying a
# nonce it read before /app was importable. The second never puts /app on
# its path and is the only thing that writes XML. At no moment does a report
# exist while code under test can still run, so there is nothing for an
# atexit handler, a stray thread or a finaliser to overwrite.

require_cmd() {{ command -v "$1" >/dev/null 2>&1 || {{ log "ERROR: missing $1"; exit 127; }}; }}
require_cmd python3

# Reports are built somewhere the code under test is never told about, and
# never inside the suites' own TMPDIR.
GRADE_ROOT="$(mktemp -d 2>/dev/null || echo /tmp/grade.$$)"
mkdir -p "$GRADE_ROOT" 2>/dev/null || true
chmod 0711 "$GRADE_ROOT" 2>/dev/null || true
GRADE_DIR="$GRADE_ROOT/$(head -c 16 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo reports)"
mkdir -p "$GRADE_DIR" 2>/dev/null || GRADE_DIR="$GRADE_ROOT"
chmod 0700 "$GRADE_DIR" 2>/dev/null || true

# Somewhere writable for a suite that wants a home or a scratch file. The
# runner drops to an unprivileged user, so this has to be world writable.
SANDBOX="$(mktemp -d 2>/dev/null || echo /tmp/sandbox.$$)"
mkdir -p "$SANDBOX" 2>/dev/null || true
chmod 0777 "$SANDBOX" 2>/dev/null || true

BASE_XML="$GRADE_DIR/base.xml"
NEW_XML="$GRADE_DIR/new.xml"

# Submitted code runs as nobody wherever the kernel allows it. The drop is
# made by the runner itself, in the child it forks for the suite, so that the
# parent holding the run secret keeps a uid the suite cannot read across.
# Refusing outright is not an option: that would score an honest reference
# solution zero on a host that cannot drop at all.
DROP_UID=65534
export VERIFIER_DROP_UID="$DROP_UID"
if [ "$(id -u 2>/dev/null || echo 0)" = "0" ]; then
  log "suites run unprivileged: the runner drops its suite child to uid $DROP_UID"
else
  log "note: not root here, so the suite child runs as the current user"
fi

# The graded source paths reach the runner on a descriptor, never in argv.
SRC_FILE="$GRADE_DIR/sources"
: > "$SRC_FILE" 2>/dev/null || true
chmod 0600 "$SRC_FILE" 2>/dev/null || true

# Every process alive before a suite runs. Anything outside this set, and
# outside this script's own ancestry, was started by code under test and has
# no business still running when the reports are published.
PGID_FILE="$GRADE_DIR/pgid"
PRE_PIDS="$(ls /proc 2>/dev/null | tr '\n' ' ')"
export VERIFIER_PGID_FILE="$PGID_FILE"
chmod 0666 "$PGID_FILE" 2>/dev/null || true
: > "$PGID_FILE" 2>/dev/null || true
chmod 0666 "$PGID_FILE" 2>/dev/null || true

# One secret per run, handed to the runner on a descriptor it consumes and
# closes before /app can be imported. Every verdict line has to carry it, so
# a line written by anything else is not a verdict. It never appears in a
# command line, because /proc/<pid>/cmdline is world readable.
NONCE="$(head -c 32 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n')"
[ -n "$NONCE" ] || NONCE="fallback-$$-$(date +%s 2>/dev/null || echo 0)"
NONCE_FILE="$GRADE_DIR/nonce"
( umask 077; printf '%s\n' "$NONCE" > "$NONCE_FILE" ) 2>/dev/null || true

# The repository's own suite is graded from its base-commit content. HEAD in
# this container is the base commit and model.patch only touched the working
# tree, so a checkout restores every pass-to-pass source a submission may
# have edited. A checkout that cannot run is not fatal; the pins below still
# decide whether the held-back sources are the ones shipped.
P2P_FILES="{p2p_files}"
for _f in tests/__init__.py $P2P_FILES; do
  git -C /app checkout -q HEAD -- "$_f" 2>/dev/null || true
done
find /app -name '__pycache__' -type d -prune -exec rm -rf {{}} + 2>/dev/null || true

# The graded sources, pinned by content. A mismatch does not stop the run:
# it publishes reports in which every case failed, which a run audit can
# read, where an empty /logs/verifier cannot be told apart from a verifier
# that fell over.
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

# These run before any test does, whatever the runner, and none exists at
# the base commit. Nothing else in the tree can reach the report.
for _planted in /app/sitecustomize.py /app/usercustomize.py \
                /app/tests/sitecustomize.py /app/tests/usercustomize.py; do
  if [ -e "$_planted" ]; then
    log "INTEGRITY: $_planted runs before collection and was not there at the base"
    INTEGRITY=bad
  fi
done
for _pth in /app/*.pth /app/tests/*.pth; do
  if [ -e "$_pth" ]; then
    log "INTEGRITY: $_pth is a .pth file, which was not there at the base"
    INTEGRITY=bad
  fi
done

HELD_SOURCES="{held_sources}"
EXISTING=""
for _f in $P2P_FILES; do
  [ -f "/app/$_f" ] && EXISTING="$EXISTING /app/$_f"
done

# Both programs live in shell variables rather than on disk, so a process a
# suite leaves behind has no file to rewrite. `-I` keeps the working
# directory and every PYTHON* variable off the interpreter path.
RUNNER='
import os, sys

# Nothing has been read from a descriptor yet and nothing from /app has run.
# The pinned source paths arrive on fd 4 rather than in argv, because
# /proc/<pid>/cmdline is world readable and the id list is the one thing a
# forger needs before it can fabricate a sheet.
_buf = b""
while True:
    _chunk = os.read(4, 65536)
    if not _chunk:
        break
    _buf += _chunk
os.close(4)
sources = [p for p in _buf.decode("utf-8", "replace").split(chr(10)) if p]

EMIT_FD = 3
sys.dont_write_bytecode = True

import ast, hashlib, random, select, socket, types, unittest

# Everything below still happens BEFORE /app can be imported, so the
# references taken here belong to the framework as it shipped, not as
# anything in the tree may later have rearranged it.
FRAMEWORK = []

def watch(owner, name):
    fn = getattr(owner, name, None)
    if fn is not None:
        FRAMEWORK.append((owner, name, fn, getattr(fn, "__code__", None)))

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
watch(unittest.TestSuite, "addTests")
watch(unittest.TestLoader, "loadTestsFromName")
watch(unittest.TestLoader, "loadTestsFromTestCase")
UNITTEST_MODULE = sys.modules["unittest"]

def framework_intact():
    if sys.modules.get("unittest") is not UNITTEST_MODULE:
        return False
    for owner, name, fn, code in FRAMEWORK:
        now = getattr(owner, name, None)
        if now is not fn or getattr(now, "__code__", None) is not code:
            return False
    return True

def module_of(path):
    rel = path[5:] if path.startswith("/app/") else path
    return rel[:-3].replace("/", ".")

def declared(path):
    found = []
    tree = ast.parse(open(path, "rb").read())
    module = module_of(path)
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

# Django is brought up by hand because there is no manage.py wrapper here.
# Every module that has any say in the outcome is imported now, before /app
# joins the path, so a package planted in the repository cannot stand in for
# one: once the real `django` is bound its submodules resolve through its own
# __path__, wherever sys.path points afterwards.
os.environ["DJANGO_SETTINGS_MODULE"] = "SchwabOptionBot.settings"
os.environ.setdefault("SBOT_OFFLINE", "1")

import django
import django.test
from django.test.runner import DiscoverRunner
from django.test.utils import setup_test_environment, teardown_test_environment

# The graded cases subclass django.test.SimpleTestCase, whose assert methods
# are attributes of ITS class object. Watching unittest.TestCase alone leaves
# them writable: a submission can rebind SimpleTestCase.assertEqual and every
# assertion in the graded suite becomes a no-op while unittest looks intact.
for _cls_name in ("SimpleTestCase", "TransactionTestCase", "TestCase"):
    _cls = getattr(django.test, _cls_name, None)
    if _cls is None:
        continue
    for _name in dir(_cls):
        if _name.startswith("assert") or _name.startswith("fail") or _name in (
                "run", "subTest", "_pre_setup", "_post_teardown",
                "_callTestMethod", "setUp", "tearDown"):
            watch(_cls, _name)

GUARDED = [unittest, ast, types, django, django.test,
           sys.modules["django.test.runner"],
           sys.modules["django.test.utils"]]

def imports_intact():
    for module in GUARDED:
        origin = getattr(module, "__file__", "") or ""
        if origin.startswith("/app"):
            return False
    return True

# ----------------------------------------------------------------------
# The split.
#
# Submitted code has to execute somewhere, and wherever it executes it owns
# that address space: it can read any secret held there and write any
# descriptor open there. So the secret and the descriptor are not held there.
# This process forks. The parent keeps the run secret and the only handle on
# the report stream, never puts /app on its path and never imports a line of
# submitted code. The child runs the suite, and before it touches /app it
# closes the report stream, drops to an unprivileged uid and is left with one
# ordinary pipe to its parent. It never learns the secret: the parent reads
# the secret only after the fork, so it was never in the memory of the child
# to begin with, and the child cannot read what the parent holds, because
# the parent runs as root and the child does not.
#
# What is left is that the child can still put whatever it likes on that
# pipe. The control cases below are the answer to that. The parent invents
# them after the fork, so the child cannot know them in advance, and each one
# asserts against a value only the parent can compute: the child has to ask
# for it over a second descriptor and run the case to find out whether it
# passes. The parent knows which of them must fail. A child that reports a
# sheet it did not run reports those as passes too, and the whole run is
# refused.
# ----------------------------------------------------------------------

VR, VW = os.pipe()
CS, ES = socket.socketpair()
os.set_inheritable(VW, False)
os.set_inheritable(ES.fileno(), False)
CHILD = os.fork()

if CHILD > 0:
    # ---------------- the reporter: root, and /app never runs here --------
    os.close(VW)
    ES.close()
    NONCE = os.read(5, 128).decode("ascii", "replace").strip()
    os.close(5)

    def emit(text):
        os.write(EMIT_FD, (NONCE + " " + text + chr(10)).encode("ascii"))

    def refuse(why):
        sys.stderr.write("TAMPER: " + why + chr(10))
        sys.stderr.flush()
        emit("TAMPER")
        emit("END 0")
        os.close(EMIT_FD)
        try:
            os.kill(CHILD, 9)
        except OSError:
            pass
        sys.exit(9)

    if not imports_intact():
        refuse("a graded import resolved inside /app")

    rng = random.SystemRandom()
    TAG = "%016x" % rng.getrandbits(64)
    KEY = ("%032x" % rng.getrandbits(128)).encode("ascii")
    CONTROL_MODULE = "verifier_control_" + TAG
    CONTROL_CLASS = "Control_" + TAG
    CONTROLS = []
    for _i in range(6):
        _chal = "%016x" % rng.getrandbits(64)
        _true = hashlib.sha256(KEY + _chal.encode("ascii")).hexdigest()
        _passes = rng.getrandbits(1) == 1
        _want = _true if _passes else ("%064x" % rng.getrandbits(256))
        CONTROLS.append((
            "test_%s_%d" % (TAG, _i), _chal, _want,
            "pass" if _passes else "fail"))

    _q = chr(34)
    _src = ["import unittest", "", "class " + CONTROL_CLASS + "(unittest.TestCase):"]
    for _name, _chal, _want, _state in CONTROLS:
        _src.append("    def " + _name + "(self):")
        _src.append("        self.assertEqual(_answer(" + _q + _chal + _q + "), "
                    + _q + _want + _q + ")")
    _src.append("")
    CONTROL_SRC = chr(10).join(_src)

    CS.sendall((CONTROL_MODULE + chr(10) + CONTROL_SRC + chr(10)
                + "ENDOFCONTROLSOURCE" + chr(10)).encode("ascii"))

    asked = {{}}
    stream = b""
    pending = b""
    idle = 0
    reading = True
    talking = True
    while reading:
        watching = [VR]
        if talking:
            watching.append(CS.fileno())
        try:
            ready = select.select(watching, [], [], 5.0)[0]
        except OSError:
            break
        if not ready:
            idle += 1
            if idle > 240:
                sys.stderr.write("the executor went quiet" + chr(10))
                break
            continue
        idle = 0
        if talking and CS.fileno() in ready:
            try:
                heard = CS.recv(4096)
            except OSError:
                heard = b""
            if not heard:
                talking = False
            else:
                pending += heard
                while chr(10).encode("ascii") in pending:
                    one, _, pending = pending.partition(chr(10).encode("ascii"))
                    question = one.decode("ascii", "replace").strip()
                    if not question.startswith("ASK "):
                        continue
                    chal = question[4:]
                    asked[chal] = asked.get(chal, 0) + 1
                    if asked[chal] == 1:
                        answer = hashlib.sha256(KEY + chal.encode("ascii")).hexdigest()
                    else:
                        answer = "asked twice"
                    try:
                        CS.sendall((answer + chr(10)).encode("ascii"))
                    except OSError:
                        talking = False
                        break
        if VR in ready:
            try:
                heard = os.read(VR, 65536)
            except OSError:
                heard = b""
            if not heard:
                reading = False
            else:
                stream += heard
    os.close(VR)
    try:
        CS.close()
    except OSError:
        pass
    try:
        status = os.waitpid(CHILD, 0)[1]
    except OSError:
        status = -1

    seen = {{}}
    order = []
    ended = False
    promised = -1
    for line in stream.decode("utf-8", "replace").splitlines():
        if line == "TAMPER":
            refuse("the executor reported its own machinery had moved")
        if line.startswith("END "):
            try:
                promised = int(line[4:])
            except ValueError:
                refuse("the end marker does not carry a count")
            ended = True
            break
        if not line.startswith("V "):
            refuse("an unrecognised line arrived from the executor")
        parts = line.split(" ")
        if len(parts) != 3:
            refuse("a malformed verdict line")
        node_id, state = parts[1], parts[2]
        if state not in ("pass", "fail", "skip"):
            refuse("a verdict line names an unknown state")
        if node_id in seen:
            refuse("a case was claimed more than once")
        seen[node_id] = state
        order.append(node_id)
    if not ended:
        refuse("the executor stopped without an end marker")
    if promised != len(order):
        refuse("the stream carries a different count from the one it promised")
    if status != 0:
        refuse("the executor did not exit cleanly")

    for _name, _chal, _want, _state in CONTROLS:
        control_id = CONTROL_MODULE + "." + CONTROL_CLASS + "." + _name
        if seen.pop(control_id, None) != _state:
            refuse("a control case did not come back with the verdict it was built to give")
        if asked.get(_chal) != 1:
            refuse("a control case never asked its question")

    if set(seen) - expected:
        refuse("the executor reported cases the pinned sources do not declare")

    count = 0
    for node_id in order:
        if node_id in seen:
            emit("V " + node_id + " " + seen[node_id])
            count += 1
    emit("END " + str(count))
    os.close(EMIT_FD)
    sys.stderr.write("reported %d verdict(s) over %d control(s)%s"
                     % (count, len(CONTROLS), chr(10)))
    sys.stderr.flush()
    sys.exit(0)

# -------------------- the executor: /app runs here only -------------------
# The report stream is closed here and the run secret was never read into
# this process. All this side has is one pipe to its parent. The two
# descriptors that mattered are replaced by /dev/null rather than simply
# closed, so their numbers stay taken: a suite that goes looking for fd 3
# finds a sink, and cannot be handed one of them back by the next open().
_sink = os.open(os.devnull, os.O_WRONLY)
os.dup2(_sink, EMIT_FD)
os.dup2(_sink, 5)
os.close(_sink)
os.close(VR)
CS.close()

def say(text):
    os.write(VW, (text + chr(10)).encode("ascii"))

def stop(code):
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)

# A session of its own, so a process the suite leaves behind cannot outlive
# the run. The parent stays outside that session and is not swept up with it.
try:
    os.setsid()
except OSError:
    pass
else:
    _pgfile = os.environ.get("VERIFIER_PGID_FILE")
    if _pgfile:
        try:
            with open(_pgfile, "w") as _fh:
                _fh.write(str(os.getpgid(0)))
        except OSError:
            pass

_drop = os.environ.get("VERIFIER_DROP_UID")
if _drop and _drop.isdigit() and os.getuid() == 0:
    try:
        os.setgroups([])
        os.setgid(int(_drop))
        os.setuid(int(_drop))
    except OSError:
        pass
if os.getuid() == 0:
    print("note: the suite runs as root here; no unprivileged uid was available",
          file=sys.stderr)
else:
    print("suite runs as uid %d" % os.getuid(), file=sys.stderr)

_heard = b""
while b"ENDOFCONTROLSOURCE" + chr(10).encode("ascii") not in _heard:
    _part = ES.recv(65536)
    if not _part:
        break
    _heard += _part
_text = _heard.decode("ascii", "replace").split("ENDOFCONTROLSOURCE")[0]
CONTROL_MODULE, _, CONTROL_SRC = _text.partition(chr(10))
CONTROL_MODULE = CONTROL_MODULE.strip()

def _answer(chal):
    ES.sendall(("ASK " + chal + chr(10)).encode("ascii"))
    got = b""
    while not got.endswith(chr(10).encode("ascii")):
        part = ES.recv(4096)
        if not part:
            break
        got += part
    return got.decode("ascii", "replace").strip()

class Recorder(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.verdicts = []

    def _record(self, test, state):
        node_id = test.id()
        # A module the pinned sources declare cases for but which will not
        # import shows up as one synthetic case named after the module. That
        # is an unsolved submission, not a rogue emitter, so it is logged
        # and dropped; every case it should have carried is then missing
        # from the stream, and the parent fails each one by name.
        if node_id not in ALLOWED:
            print("undeclared case %s (%s)" % (node_id, state), file=sys.stderr)
            return
        self.verdicts.append((node_id, state))

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record(test, "pass")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record(test, "fail")

    def addError(self, test, err):
        super().addError(test, err)
        self._record(test, "fail")

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record(test, "skip")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._record(test, "fail")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._record(test, "fail")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self._record(test, "fail")

RECORDER = [(Recorder, n, getattr(Recorder, n),
             getattr(getattr(Recorder, n), "__code__", None))
            for n in ("_record", "addSuccess", "addFailure", "addError",
                      "addSkip", "addSubTest")]

def recorder_intact():
    for owner, name, fn, code in RECORDER:
        now = getattr(owner, name, None)
        if now is not fn or getattr(now, "__code__", None) is not code:
            return False
    return True

sys.path.insert(0, "/app")
django.setup()
setup_test_environment()
runner = DiscoverRunner(verbosity=0, interactive=False)
old_config = runner.setup_databases()

# The graded sources are loaded from the bytes that were pinned by digest,
# compiled here, and executed into module objects this process owns. Nothing
# is ever looked up by name in sys.modules, so submitted startup code, which
# has already run by now inside django.setup(), cannot pre-register a
# generated module under one of these names and have the run pick it up. The
# classes collected below come out of the namespace this exec filled, and
# every graded method has to carry a code object compiled from the pinned
# path.
loader = unittest.TestLoader()
suite = unittest.TestSuite()
ORIGINS = {{}}
planted = [module_of(path) for path in sources if module_of(path) in sys.modules]
if planted:
    print("TAMPER: %s already in sys.modules before loading" % ", ".join(planted),
          file=sys.stderr)
    say("TAMPER")
    stop(9)

CONTROL_PATH = "<control>"
_control = types.ModuleType(CONTROL_MODULE)
_control.__file__ = CONTROL_PATH
_control.__dict__["_answer"] = _answer
exec(compile(CONTROL_SRC, CONTROL_PATH, "exec"), _control.__dict__)
for _obj in list(vars(_control).values()):
    if (isinstance(_obj, type) and issubclass(_obj, unittest.TestCase)
            and getattr(_obj, "__module__", None) == CONTROL_MODULE):
        ORIGINS[_obj] = CONTROL_PATH
        suite.addTests(loader.loadTestsFromTestCase(_obj))

for path in sources:
    dotted = module_of(path)
    module = types.ModuleType(dotted)
    module.__file__ = path
    module.__package__ = dotted.rpartition(".")[0]
    try:
        exec(compile(open(path, "rb").read(), path, "exec"), module.__dict__)
    except Exception as exc:
        print("could not load %s: %r" % (dotted, exc), file=sys.stderr)
        continue
    for obj in list(vars(module).values()):
        if (isinstance(obj, type) and issubclass(obj, unittest.TestCase)
                and getattr(obj, "__module__", None) == dotted):
            ORIGINS[obj] = path
            suite.addTests(loader.loadTestsFromTestCase(obj))

# A class that arrived from anywhere but the pinned file cannot be graded.
ALLOWED = set(expected)
for cls, path in ORIGINS.items():
    for name in dir(cls):
        if not name.startswith("test"):
            continue
        code = getattr(getattr(cls, name, None), "__code__", None)
        if code is None or code.co_filename != path:
            print("TAMPER: %s.%s does not come from %s" % (cls.__name__, name, path),
                  file=sys.stderr)
            say("TAMPER")
            stop(9)
        if path == CONTROL_PATH:
            ALLOWED.add(cls.__module__ + "." + cls.__name__ + "." + name)

# The control source and the helper that answers its questions have done
# their job; what is left of them in this namespace is scrubbed, so reaching
# them means walking the suite object graph rather than reading a global.
CONTROL_SRC = "x" * len(CONTROL_SRC)
_heard = b""
_text = ""
del CONTROL_SRC, _answer

result = Recorder()
suite.run(result)

for _test, _trace in list(result.errors) + list(result.failures):
    if _test.id() not in ALLOWED:
        print("could not load %s:\n%s" % (_test.id(), _trace), file=sys.stderr)

try:
    runner.teardown_databases(old_config)
except Exception:
    pass
try:
    teardown_test_environment()
except Exception:
    pass

# Nothing has been reported yet. If the machinery moved under us, say so and
# report nothing else: the parent turns that into a full sheet of failures
# rather than into silence.
if not framework_intact() or not recorder_intact() or not imports_intact():
    print("TAMPER: test machinery was altered during the run", file=sys.stderr)
    say("TAMPER")
    stop(9)

count = 0
for node_id, state in result.verdicts:
    say("V " + node_id + " " + state)
    count += 1
say("END " + str(count))
os.close(VW)
print("ran %d case(s)" % count)
stop(0)
'

# The publisher never puts /app on its path. It reads the graded sources as
# text to learn which cases the pinned files declare, and it is the only
# thing in the verifier that writes XML. The XML is assembled as text: no
# XML library is imported anywhere a report is written, so a submission
# cannot fabricate one by patching a parser.
PUBLISHER='
import ast, os, sys

report = sys.argv[1]
sources = sys.argv[2:]
nonce = os.read(6, 128).decode("ascii", "replace").strip()
os.close(6)

def module_of(path):
    rel = path[5:] if path.startswith("/app/") else path
    return rel[:-3].replace("/", ".")

def declared(path):
    found = []
    tree = ast.parse(open(path, "rb").read())
    module = module_of(path)
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

def quote(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace(chr(34), "&quot;"))

def publish(verdicts, why=None):
    rows = []
    failures = 0
    for node_id in sorted(verdicts):
        classname, _, name = node_id.rpartition(".")
        body = ""
        state = verdicts[node_id]
        if state != "pass":
            reason = why or ("failed" if state == "fail" else state)
            body = "<failure message=\"" + quote(reason) + "\"/>"
            failures += 1
        rows.append("<testcase classname=\"%s\" name=\"%s\">%s</testcase>"
                    % (quote(classname), quote(name), body))
    document = ("<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                "<testsuite name=\"schwabbot\" tests=\"%d\" failures=\"%d\">%s"
                "</testsuite>" % (len(rows), failures, "".join(rows)))
    with open(report, "w", encoding="utf-8") as handle:
        handle.write(document)

def refuse(why):
    print("REFUSED: %s" % why, file=sys.stderr)
    publish({{node_id: "fail" for node_id in expected}}, why)
    sys.exit(9)

lines = sys.stdin.read().splitlines()
if not lines:
    refuse("the runner produced no verdict stream")

prefix = nonce + " "
seen = {{}}
count = 0
ended = False
for index, line in enumerate(lines):
    if not line.startswith(prefix):
        refuse("a line on the verdict stream is missing the run secret")
    body = line[len(prefix):]
    if body == "TAMPER":
        refuse("the runner reported its own machinery had moved")
    if body.startswith("END "):
        if index != len(lines) - 1:
            refuse("the verdict stream continues past its end marker")
        try:
            promised = int(body[4:])
        except ValueError:
            refuse("the end marker does not carry a count")
        if promised != count:
            refuse("the verdict stream carries a different count from the one it promised")
        ended = True
        break
    if not body.startswith("V "):
        refuse("an unrecognised line on the verdict stream")
    parts = body.split(" ")
    if len(parts) != 3:
        refuse("a malformed verdict line")
    node_id, state = parts[1], parts[2]
    if state not in ("pass", "fail", "skip"):
        refuse("a verdict line names an unknown state")
    if node_id in seen and seen[node_id] != state:
        state = "fail"
    seen[node_id] = state
    count += 1

if not ended:
    refuse("the verdict stream stops without an end marker")
if set(seen) - expected:
    refuse("the run reported cases the pinned sources do not declare")
for node_id in expected - set(seen):
    seen[node_id] = "did not report a result"
for node_id in list(seen):
    if seen[node_id] == "skip":
        seen[node_id] = "skipped"

publish(seen)
print("wrote %s with %d case(s)" % (report, len(seen)))
'

# The runner leads a session of its own, so ending that session ends every
# process the suite started, however it was started. Only a pgid the runner
# itself wrote is used, and it only writes one when setsid actually
# succeeded, so this can never name the group this script runs in.
end_session() {{
  [ -s "$PGID_FILE" ] || return 0
  _pg="$(tr -dc '0-9' < "$PGID_FILE" 2>/dev/null)"
  : > "$PGID_FILE" 2>/dev/null || true
  [ -n "$_pg" ] && [ "$_pg" != "0" ] || return 0
  kill -9 -"$_pg" 2>/dev/null
  return 0
}}

run_and_publish() {{
  _report="$1"; shift
  # Verdicts leave the reporter on fd 3, joined here to the publisher by a
  # pipe. A pipe is the point: bytes handed over cannot be taken back, so
  # nothing the interpreter does on its way out can revise a verdict already
  # read, and no report file exists for it to rewrite. The nonce reaches
  # both ends on a descriptor rather than in argv, and so does the list of
  # graded sources, because /proc/<pid>/cmdline is world readable.
  #
  # The runner is NOT wrapped in $DROP here. It forks: the parent keeps the
  # nonce and fd 3 and stays root, and the child drops to $DROP_UID itself
  # before it puts /app on its path. Dropping the whole process would put
  # the run secret in the same address space as the code under test.
  : > "$SRC_FILE"
  for _s in "$@"; do printf '%s\n' "$_s" >> "$SRC_FILE"; done
  (
    ( cd /app && HOME="$SANDBOX" TMPDIR="$SANDBOX" \
      python3 -I -c "$RUNNER" ) 3>&1 1>>"$RUN_LOG" 2>&1 \
      5<"$NONCE_FILE" 4<"$SRC_FILE"
  ) | (
    cd "$GRADE_DIR" && python3 -I -c "$PUBLISHER" "$_report" "$@" 6<"$NONCE_FILE"
  ) >>"$RUN_LOG" 2>&1
  _status="${{PIPESTATUS[0]}}:${{PIPESTATUS[1]}}"
  end_session
  [ "$_status" = "0:0" ]
}}

# Belt and braces for a process that called setsid() for itself and so
# escaped the group above: anything running now that was not running before
# the suites started, and is not an ancestor of this script, was started by
# code under test. Kernel threads have no readable exe and are left alone.
SWEEPER='
import os, signal, sys

def parent_of(pid):
    try:
        with open("/proc/%d/stat" % pid) as handle:
            return int(handle.read().rsplit(") ", 1)[1].split()[1])
    except Exception:
        return 0

keep = {{1}}
for token in sys.argv[1].split():
    if token.isdigit():
        keep.add(int(token))
walker = os.getpid()
while walker > 1 and walker not in keep:
    keep.add(walker)
    walker = parent_of(walker)

swept = 0
for entry in os.listdir("/proc"):
    if not entry.isdigit():
        continue
    pid = int(entry)
    if pid in keep or pid == os.getpid():
        continue
    try:
        os.readlink("/proc/%d/exe" % pid)
    except OSError:
        continue
    try:
        os.kill(pid, signal.SIGKILL)
        swept += 1
    except OSError:
        pass
print("swept %d process(es) the suites left behind" % swept)
'

set +e
# The suites always run, whatever the pins said, and every selection is its
# own interpreter, so nothing one suite does to its own process can reach
# the other.
log "running and publishing the graded suite"
run_and_publish "$NEW_XML" $HELD_SOURCES
if [ $? -ne 0 ]; then
  log "INTEGRITY: the graded suite did not finish cleanly"
  INTEGRITY=bad
fi
log "running and publishing the repository suite"
run_and_publish "$BASE_XML" $EXISTING
if [ $? -ne 0 ]; then
  log "INTEGRITY: the repository suite did not finish cleanly"
  INTEGRITY=bad
fi

# Re-check after the code under test has finished, so a suite that rewrote a
# graded source mid-run is caught as well as one that arrived changed.
{checks}

if [ "$INTEGRITY" != ok ]; then
  log "integrity check failed; publishing reports with every case failed"
  python3 -I - "$BASE_XML" "$NEW_XML" <<'FAILALL'
import re, sys
for path in sys.argv[1:]:
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        continue
    cases = re.findall(r"<testcase classname=\"([^\"]*)\" name=\"([^\"]*)\">", text)
    rows = ["<testcase classname=\"%s\" name=\"%s\"><failure message=\"withheld: the graded inputs changed during the run\"/></testcase>" % pair
            for pair in cases]
    document = ("<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                "<testsuite name=\"schwabbot\" tests=\"%d\" failures=\"%d\">%s</testsuite>"
                % (len(rows), len(rows), "".join(rows)))
    open(path, "w", encoding="utf-8").write(document)
FAILALL
fi

# Nothing the suites started may still be running when the reports reach
# their predictable, grader-visible paths: from here on the only writer is
# this script.
end_session
python3 -I -c "$SWEEPER" "$PRE_PIDS" >>"$RUN_LOG" 2>&1 || true

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
    pins = "\n".join(f'PIN_{i}="{PINS[name]}"' for i, name in enumerate(PINS))
    checks = "\n".join(f'check_pin "{name}" "$PIN_{i}"' for i, name in enumerate(PINS))
    block = BLOCK.format(
        start=START, end=END, pins=pins, checks=checks,
        held_sources=" ".join("/app/" + h for h in HELD),
        p2p_files=" ".join(P2P_FILES),
    )
    out = head + block + tail
    if OUT.exists():
        old = OUT.read_text()
        if START in old and END in old:
            oh, orest = old.split(START, 1)
            _, ot = orest.split(END, 1)
            assert oh == head and ot == tail, "existing test.sh differs outside the markers"
    OUT.write_text(out)
    OUT.chmod(0o755)
    print(f"wrote {OUT} ({len(out)} bytes), {len(P2P_FILES)} p2p files, {len(HELD)} held")
    return 0


if __name__ == "__main__":
    sys.exit(main())
