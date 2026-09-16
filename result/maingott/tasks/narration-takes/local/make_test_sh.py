#!/usr/bin/env python3
"""Generate tests/test.sh for narration-takes from the frozen frame.

Reads the frame as pulled from the draft (frame.sh, kept verbatim), replaces
only the block between the RUN TESTS markers, and asserts every byte outside
the markers is unchanged before writing. The digest pins are taken from the
trees on disk: the pass-to-pass sources and the suite's fixture module from
the pristine base checkout, the held-back files from the development tree.
"""

import hashlib
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
REPO = TASK.parent.parent / "repo"
DEV = TASK.parent.parent / "dev"

FRAME = (HERE / "frame.sh").read_text()
BEGIN = "# >>> RUN TESTS (task-specific) <<<\n"
END = "# >>> END RUN TESTS <<<\n"

# Every test file that does not need FFmpeg. The fourteen that do are left out
# on time, not on correctness: composing a Reel per test does not fit the
# verifier's budget, and tests/test_cli.py is red at the base commit in this
# image anyway.
P2P_FILES = """tests/test_analyzer.py tests/test_asset_cache.py tests/test_asset_identity.py tests/test_asset_manager.py tests/test_asset_validation.py tests/test_audit_gates.py tests/test_audition.py tests/test_brand_registry.py tests/test_captions.py tests/test_claims.py tests/test_config.py tests/test_costing.py tests/test_docx_reader.py tests/test_fact_registry.py tests/test_fact_selection.py tests/test_logging.py tests/test_models.py tests/test_mp4.py tests/test_openai_provider.py tests/test_openai_video_provider.py tests/test_package.py tests/test_planner.py tests/test_probe.py tests/test_prompts.py tests/test_providers.py tests/test_reel_validation.py tests/test_request_log.py tests/test_script_generator.py tests/test_storyboarder.py tests/test_storyboard_generator.py tests/test_storyboard_validation.py tests/test_utils.py tests/test_voice_generation.py tests/test_voice_identity.py tests/test_voice_provider.py tests/test_voice_validation.py tests/test_wav.py""".split()

# Not run as tests, but imported by every suite: the fixture module. It is
# restored from the base commit and digest-pinned alongside the graded files,
# because every pass-to-pass module draws its runs and settings from it.
SUPPORT_FILES = ["tests/conftest.py"]

NEW_FILES = [
    "tests/test_narration_takes.py",
    "tests/test_take_costing.py",
]


def sha_lines(root: pathlib.Path, files: list) -> str:
    lines = []
    for f in files:
        digest = hashlib.sha256((root / f).read_bytes()).hexdigest()
        lines.append(f"{digest}  {f}")
    return "\n".join(lines)


BLOCK = r'''# >>> RUN TESTS (task-specific) <<<
# Two pytest selections: the repository's own suite (pass-to-pass) and the
# held-back narration tests (fail-to-pass). Reports are not written by the
# process that runs submitted code: a parent that never imports /app mints a
# per-run token, hands it to a pytest child on stdin, hears one verdict line
# per case back on a dedicated descriptor, and writes the XML only after the
# child has exited, so no report file exists while /app code can run. Both
# interpreters run isolated (-I); the child takes the tree under test off
# sys.path entirely while it imports the framework and puts it back last
# afterwards, so pytest and the standard library always resolve from the
# interpreter's own installation and never from anything the submission
# shipped. The
# child takes an identity snapshot of every loaded pytest and pluggy module
# and class before /app is importable and rechecks it at every verdict and
# at the end; a run that altered the framework sends no END and the publisher
# then publishes every declared id as failed, as it does for any id the run
# never reported. The
# child runs as an unprivileged user (nobody, via setpriv) whenever this
# script is root, so nothing imported from /app can write to /app, /tests,
# /verify or /logs, or signal the root-owned publisher. The graded
# pass-to-pass sources and the suite's fixture module are restored to their
# base-commit content and digest-checked, every other conftest.py is removed
# along with stale bytecode, and no process started by a suite survives into
# grading. The held-back modules are copied into the root-only verifier
# directory once their digests match, and between the two suites everything
# the second suite reads is swept, restored from those copies or the base
# commit, and digest-checked again against digests this shell holds in
# memory, so code that ran during the first suite cannot leave a rewritten
# module behind for the second.
unset PYTHONPATH
unset PYTEST_ADDOPTS
export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1

# Only root reads the verifier's own directory from here on. Knowing which ids
# are graded is the difference between forging a report and having to
# reproduce a whole run, and nothing the suites do needs that list.
chmod -R go-rwx /tests 2>/dev/null || true

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
KEEP="$VDIR/keep"
mkdir -p "$RPTDIR" "$KEEP" 2>/dev/null || true
printf '[pytest]\naddopts =\n' > "$VDIR/pytest.ini"

# The suites need somewhere to write: pytest's tmp_path fixture, and the
# calibration session the child runs before /app is importable. This is the
# only directory the child can write, and neither the publisher nor grading
# ever reads it.
SUITE_TMP="$VDIR/tmp"
mkdir -p "$SUITE_TMP" 2>/dev/null || SUITE_TMP=$(mktemp -d)
chmod 1777 "$SUITE_TMP" 2>/dev/null || true

# Drop privileges for the child. Submitted code executes inside it, so it must
# not be able to reach the verifier's own files, the reports, or the checkout
# it is graded against. When setpriv or the account is missing the block runs
# the child as the current user rather than refusing to run at all, and says
# so in the log.
RUNAS=""
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  RUN_UID=$(id -u nobody 2>/dev/null || echo 65534)
  RUN_GID=$(id -g nogroup 2>/dev/null || id -g nobody 2>/dev/null || echo 65534)
  if setpriv --reuid="$RUN_UID" --regid="$RUN_GID" --clear-groups true >/dev/null 2>&1; then
    RUNAS="setpriv --reuid=$RUN_UID --regid=$RUN_GID --clear-groups"
    log "pytest child runs as uid $RUN_UID gid $RUN_GID"
  fi
fi
if [ -z "$RUNAS" ]; then
  log "no setpriv; the publisher drops the pytest child to nobody itself"
fi
export RUNAS SUITE_TMP

P2P_FILES="@P2P_FILES@"
SUPPORT_FILES="@SUPPORT_FILES@"
NEW_FILES="@NEW_FILES@"

# The pytest child: runs the suite in-process and streams verdicts.
cat > "$VDIR/child.py" <<'PYCHILD'
import os
import sys


def to_pair(nodeid):
    path, _, rest = nodeid.partition("::")
    if path.startswith("/app/"):
        path = path[len("/app/"):]
    mod = path[:-3] if path.endswith(".py") else path
    mod = mod.replace("/", ".")
    parts = rest.split("::") if rest else []
    name = parts[-1] if parts else ""
    cls = ".".join([mod] + parts[:-1])
    return cls, name


def framework_modules():
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name == "pytest" or name == "pluggy" or name.startswith(("_pytest.", "pluggy.")):
            found[name] = mod
    return found


def decides(value):
    """Whether an attribute can change what the framework does: a function, a
    class or a descriptor. Plain data (flags, caches, counters) is not a
    decision point and pytest legitimately writes some of it while it runs."""
    return callable(value) or isinstance(value, (property, classmethod, staticmethod))


def snapshot_framework():
    """Every decision point of every loaded pytest/pluggy module, and of every
    class they define, held by reference so identity can be rechecked."""
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
    """Every decision point that is not the object it was, or was added,
    as a set of hashable descriptions."""
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


def calibrate(guard, ini, pytest):
    """What pytest does to itself during a session, measured on a session
    that runs nothing from /app: a two-test file written here. Only drift
    beyond this set is treated as tampering in the real run."""
    import tempfile
    folder = tempfile.mkdtemp(prefix="calib-")
    with open(os.path.join(folder, "test_calibration.py"), "w") as fh:
        fh.write("def test_passes():\n    assert 1 == 1\n\n\ndef test_fails():\n    assert [1] == [2]\n")
    allowed = set()

    class Observer:
        def pytest_runtest_logreport(self, report):
            allowed.update(framework_drift(guard))

    pytest.main(
        ["-q", "-p", "no:cacheprovider", "-c", ini, "--rootdir=" + folder, folder],
        plugins=[Observer()],
    )
    allowed.update(framework_drift(guard))
    return allowed


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    ini = sys.argv[2]
    files = sys.argv[3:]
    # Bound now, before anything under /app can run: rebinding os.write or
    # os.getpid later changes nothing here, and a forked copy of this process
    # never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()
    # The image puts /app/src on sys.path through a .pth file, so the tree
    # under test is already importable and already last. Take it off anyway
    # while the framework is imported: pytest must come from the interpreter's
    # own installation, never from anything the submission shipped.
    stdlib = [p for p in sys.path if not p.startswith("/app")]
    under_test = [p for p in sys.path if p.startswith("/app")]
    sys.path[:] = stdlib
    import pytest
    import pluggy  # noqa: F401
    import _pytest.reports  # noqa: F401
    import _pytest.runner  # noqa: F401
    import _pytest.python  # noqa: F401
    import _pytest.main  # noqa: F401
    import _pytest.nodes  # noqa: F401
    import _pytest.outcomes  # noqa: F401
    import _pytest.skipping  # noqa: F401
    import _pytest.unittest  # noqa: F401
    import _pytest.fixtures  # noqa: F401
    import _pytest.assertion  # noqa: F401
    import _pytest.assertion.rewrite  # noqa: F401
    import _pytest.capture  # noqa: F401
    import _pytest.terminal  # noqa: F401
    if pytest.__file__.startswith("/app"):
        print("[runner] pytest resolved from the tree under test; no END will be sent", flush=True)
        os._exit(3)
    print("[runner] pytest resolved from", pytest.__file__, flush=True)
    guard = snapshot_framework()
    # Only now does the code under test become importable, and only behind
    # everything the interpreter ships.
    sys.path.extend(under_test)
    sys.path.append("/app")
    allowed = calibrate(guard, ini, pytest)
    if framework_drift(guard):
        # A calibration session must leave the framework as it found it.
        print("[runner] framework did not settle after calibration; no END will be sent", flush=True)
        os._exit(3)
    print("[runner] framework guard: %d decision points, %d self-changes allowed"
          % (sum(len(a) for _, a in guard[0].values()) + sum(len(m) for _, m in guard[1].values()), len(allowed)),
          flush=True)
    state = {"n": 0, "tampered": False}

    class Recorder:
        def pytest_runtest_logreport(self, report):
            if getpid() != owner:
                return
            if framework_drift(guard) - allowed:
                state["tampered"] = True
                return
            fields = vars(report)
            when = fields.get("when")
            verdict = fields.get("outcome")
            if when == "call":
                if verdict == "passed":
                    outcome = "passed"
                elif verdict == "skipped":
                    outcome = "skipped"
                else:
                    outcome = "failed"
            elif verdict != "passed":
                outcome = "skipped" if verdict == "skipped" else "failed"
            else:
                return
            cls, name = to_pair(fields.get("nodeid", ""))
            line = "V %s %s %s\x1f%s\n" % (token, outcome, cls, name)
            write(fd, line.encode())
            state["n"] += 1

    rc = pytest.main(
        ["-q", "-p", "no:cacheprovider", "-c", ini, "--rootdir=/app"] + files,
        plugins=[Recorder()],
    )
    if getpid() != owner:
        os._exit(0)
    if state["tampered"] or framework_drift(guard):
        # The framework was altered while the suite ran, or was left altered.
        # Without END the publisher refuses the stream and every declared id
        # grades failed.
        print("[runner] framework tampered with; no END will be sent", flush=True)
        os._exit(3)
    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    sys.exit(int(rc))


main()
PYCHILD

# The publisher: never imports /app code, owns the token and the XML.
cat > "$VDIR/publish.py" <<'PYPUB'
import json
import os
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
    vdir, ini, xml_path = sys.argv[1], sys.argv[2], sys.argv[3]
    files = sys.argv[4:]
    token = os.urandom(16).hex()
    r_fd, w_fd = os.pipe()
    # RUNAS drops the child to an unprivileged user; scratch is the only place
    # it may write. -B keeps it from leaving bytecode behind, and -I means the
    # environment below cannot steer the interpreter, only the suites. When
    # the shell found no setpriv, this process drops the child itself, so the
    # code under test never runs as root: the held-back modules are read by
    # pytest only after the fixture module has imported the package, and a
    # root child could rewrite them in that window.
    runas = os.environ.get("RUNAS", "").split()
    scratch = os.environ.get("SUITE_TMP", "/tmp")
    drop = None
    if not runas and os.geteuid() == 0:
        try:
            import pwd
            _pw = pwd.getpwnam("nobody")
            _uid, _gid = _pw.pw_uid, _pw.pw_gid
        except Exception:
            _uid, _gid = 65534, 65534

        def drop(uid=_uid, gid=_gid):
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
            if os.getuid() != uid or os.geteuid() != uid:
                os._exit(97)

        print("[publish] no setpriv; publisher drops the child to uid %d gid %d itself"
              % (_uid, _gid), flush=True)
    try:
        child = subprocess.Popen(
            runas
            + [sys.executable, "-I", "-B", os.path.join(vdir, "child.py"), str(w_fd), ini]
            + files,
            stdin=subprocess.PIPE,
            pass_fds=(w_fd,),
            preexec_fn=drop,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "TMPDIR": scratch,
                 "HOME": scratch, "LC_ALL": "C.UTF-8"},
        )
    except Exception as exc:
        # Fail closed: a child that cannot be started unprivileged does not
        # run; with nothing on the pipe the stream below is refused and every
        # declared id is published as failed.
        print("[publish] refused: could not start the child unprivileged (%s); "
              "every declared id is published as failed" % exc, flush=True)
        child = None
    os.close(w_fd)
    if child is not None:
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
    rc = child.wait() if child is not None else 98

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
PYPUB
chmod 0444 "$VDIR/child.py" "$VDIR/publish.py" 2>/dev/null || true

# The digests live in this shell's memory, not in a file anything else can
# reach: the graded pass-to-pass sources plus the fixture module at the base
# commit, and the held-back modules as shipped.
P2P_SHA=$(cat <<'SHA_P2P'
@P2P_SHA@
SHA_P2P
)
NEW_SHA=$(cat <<'SHA_NEW'
@NEW_SHA@
SHA_NEW
)

# Every conftest.py goes, along with stale bytecode; tests/conftest.py is then
# restored from the base commit and digest-checked, and the repository root
# one stays gone: it prepends /app to sys.path, which is the one thing the
# child is careful not to do. -c above already pins configuration to the
# verifier's own ini. HEAD in this container is the base commit; model.patch
# and test.patch touch the working tree only.
clean_tree() {
  find /app -name 'conftest.py' -delete 2>/dev/null || true
  find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
  find /app -name '*.pyc' -delete 2>/dev/null || true
  for f in $P2P_FILES $SUPPORT_FILES; do
    git -C /app checkout HEAD -- "$f" 2>/dev/null || true
  done
}
p2p_matches() { printf '%s\n' "$P2P_SHA" | (cd /app && sha256sum -c - >/dev/null 2>&1); }
new_matches() { printf '%s\n' "$NEW_SHA" | (cd /app && sha256sum -c - >/dev/null 2>&1); }
log_mismatch() { printf '%s\n' "$1" | (cd /app && sha256sum -c - 2>&1 | grep -v ': OK$' | head -20) >> "$RUN_LOG" 2>/dev/null || true; }

clean_tree
P2P_OK=1
if ! p2p_matches; then
  P2P_OK=0
  log "ERROR: pass-to-pass sources (or the fixture module) do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
  log_mismatch "$P2P_SHA"
fi
NEW_OK=1
if new_matches; then
  # Keep a root-only copy of the held-back modules as shipped, to restore
  # from before their suite runs.
  for f in $NEW_FILES; do
    mkdir -p "$KEEP/$(dirname "$f")" 2>/dev/null || true
    cp "/app/$f" "$KEEP/$f" 2>/dev/null || true
  done
else
  NEW_OK=0
  log "ERROR: held-back test sources are not the ones shipped; their suite will not run and every fail-to-pass id will be published as failed"
  log_mismatch "$NEW_SHA"
fi

# Everything the verifier runs is now in place: make it read only to anyone
# but root, so the unprivileged child cannot rewrite its own script, the
# kept copies, or a report.
chmod 0444 "$VDIR/pytest.ini" 2>/dev/null || true
chmod -R go-rwx "$KEEP" 2>/dev/null || true
chmod 0700 "$RPTDIR" "$KEEP" 2>/dev/null || true
chmod 0555 "$VDIR" 2>/dev/null || true

# Process snapshot before the suites, for the sweeps.
proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE=$(proc_list)

# Sweep: end anything that appeared since the snapshot and is still running,
# so no process spawned by code under test survives into the next suite or
# into grading. The chain of this script's own ancestors is exempt.
SELF_CHAIN=" $$ "
_p=$PPID
while [ -n "${_p:-}" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ]; do
  SELF_CHAIN="$SELF_CHAIN$_p "
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null)
done
sweep() {
  for _pid in $(proc_list); do
    echo "$PROC_BEFORE" | grep -qx "$_pid" && continue
    case "$SELF_CHAIN" in *" $_pid "*) continue ;; esac
    kill -9 "$_pid" 2>/dev/null || true
  done
}

run_suite() {
  _xml="$1"; shift
  _paths=""
  for _f in "$@"; do _paths="$_paths /app/$_f"; done
  echo "+ pytest -> $_xml ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    setsid timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$VDIR/pytest.ini" "$_xml" $_paths >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$VDIR/pytest.ini" "$_xml" $_paths >> "$RUN_LOG" 2>&1
    _rc=$?
  fi
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
}

set +e
if [ "$P2P_OK" = 1 ]; then
  run_suite "$RPTDIR/base.xml" $P2P_FILES
fi

# Between the suites: nothing from the first may still be running, and
# everything the second reads is put back and checked again. Code that ran
# inside the first suite had /app open; the held-back modules come back from
# the root-only copies and the fixture module from the base commit, and both
# are digest-checked against the digests this shell already holds. A
# mismatch that survives the restore refuses the suite.
sweep
if [ "$NEW_OK" = 1 ]; then
  clean_tree
  for f in $NEW_FILES; do
    cp "$KEEP/$f" "/app/$f" 2>/dev/null || true
  done
  if ! new_matches; then
    NEW_OK=0
    log "ERROR: held-back test sources were altered during the pass-to-pass suite and could not be restored; their suite will not run and every fail-to-pass id will be published as failed"
    log_mismatch "$NEW_SHA"
  elif ! p2p_matches; then
    NEW_OK=0
    log "ERROR: the fixture module or pass-to-pass sources were altered during their suite and could not be restored; the held-back suite will not run and every fail-to-pass id will be published as failed"
    log_mismatch "$P2P_SHA"
  else
    echo "+ held-back modules and fixture module re-checked before their suite: OK" >> "$RUN_LOG" 2>/dev/null || true
  fi
fi
if [ "$NEW_OK" = 1 ]; then
  # every held-back file is digest-pinned above; only the test modules run
  NEW_RUN=""
  for _f in $NEW_FILES; do case "${_f##*/}" in test_*.py) NEW_RUN="$NEW_RUN $_f" ;; esac; done
  run_suite "$RPTDIR/new.xml" $NEW_RUN
fi
sweep

# Publish the reports read-only, only after the sweep.
[ -f "$RPTDIR/base.xml" ] && cp "$RPTDIR/base.xml" /logs/verifier/base.xml
[ -f "$RPTDIR/new.xml" ] && cp "$RPTDIR/new.xml" /logs/verifier/new.xml
chmod 0444 /logs/verifier/base.xml /logs/verifier/new.xml 2>/dev/null || true
# >>> END RUN TESTS <<<
'''


def main() -> None:
    p2p_sha = sha_lines(REPO, P2P_FILES + SUPPORT_FILES)
    new_sha = sha_lines(DEV, NEW_FILES)
    block = (
        BLOCK
        .replace("@P2P_FILES@", " ".join(P2P_FILES))
        .replace("@SUPPORT_FILES@", " ".join(SUPPORT_FILES))
        .replace("@NEW_FILES@", " ".join(NEW_FILES))
        .replace("@P2P_SHA@", p2p_sha)
        .replace("@NEW_SHA@", new_sha)
    )

    begin = FRAME.index(BEGIN)
    end = FRAME.index(END) + len(END)
    head, tail = FRAME[:begin], FRAME[end:]

    out = head + block
    assert out.count(BEGIN) == 1 and out.count(END) == 1
    out = out + tail

    # Frame integrity: everything outside the markers is byte-identical.
    assert out[:begin] == FRAME[:begin]
    assert out[out.index(END) + len(END):] == FRAME[end:]

    (TASK / "tests" / "test.sh").write_text(out)
    print(f"wrote tests/test.sh ({len(out)} bytes), block {out.index(END)+len(END)-begin} bytes")


if __name__ == "__main__":
    main()
