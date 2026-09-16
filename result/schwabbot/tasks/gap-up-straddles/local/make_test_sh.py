#!/usr/bin/env python3
"""Generate tests/test.sh for gap-up-straddles from the frozen frame.

The frame is kept byte for byte outside the RUN TESTS markers; only the block
between them is ours.  Digest pins for the graded pass-to-pass sources and for
the held-back files are read out of the work repository, branches ``main`` and
``heldout``.
"""

import hashlib
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
WORK = TASK.parent.parent / "work"
HELDOUT_BRANCH = "heldout"

FRAME = (TASK / "frame.sh").read_text()
BEGIN = "# >>> RUN TESTS (task-specific) <<<\n"
END = "# >>> END RUN TESTS <<<\n"

P2P_FILES = [
    "tests/test_offline.py",
    "tests/test_schwab_api.py",
    "tests/test_server_api.py",
    "tests/test_user_allow.py",
    "Users/tests.py",
]

# Imported by the graded suites without holding cases of its own.
SUPPORT_FILES = ["tests/__init__.py"]

NEW_FILES = [
    "tests/test_wind_down.py",
    "tests/test_paper_targets.py",
]


def git_show(ref, path):
    return subprocess.run(
        ["git", "-C", str(WORK), "show", "%s:%s" % (ref, path)],
        check=True, capture_output=True,
    ).stdout


def sha_lines(ref, files):
    return "\n".join(
        "%s  %s" % (hashlib.sha256(git_show(ref, f)).hexdigest(), f)
        for f in files
    )


BLOCK = r'''# >>> RUN TESTS (task-specific) <<<
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

P2P_FILES="@P2P_FILES@"
SUPPORT_FILES="@SUPPORT_FILES@"
NEW_FILES="@NEW_FILES@"

cat > "$VDIR/child.py" <<'PYCHILD'
@CHILD@
PYCHILD

cat > "$VDIR/publish.py" <<'PYPUB'
@PUBLISH@
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
@P2P_SHA@
SHA_P2P
cat > "$VDIR/new.sha256" <<'SHA_NEW'
@NEW_SHA@
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
'''


def main():
    child = (HERE / "child.py").read_text().rstrip("\n")
    publish = (HERE / "publish.py").read_text().rstrip("\n")
    for name, text in (("child.py", child), ("publish.py", publish)):
        assert "PYCHILD" not in text and "PYPUB" not in text, name

    block = (
        BLOCK
        .replace("@P2P_FILES@", " ".join(P2P_FILES))
        .replace("@SUPPORT_FILES@", " ".join(SUPPORT_FILES))
        .replace("@NEW_FILES@", " ".join(NEW_FILES))
        .replace("@P2P_SHA@", sha_lines("main", P2P_FILES + SUPPORT_FILES))
        .replace("@NEW_SHA@", sha_lines(HELDOUT_BRANCH, NEW_FILES))
        .replace("@CHILD@", child)
        .replace("@PUBLISH@", publish)
    )

    begin = FRAME.index(BEGIN)
    end = FRAME.index(END) + len(END)
    head, tail = FRAME[:begin], FRAME[end:]

    out = head + block
    assert out.count(BEGIN) == 1 and out.count(END) == 1
    out = out + tail

    assert out[:begin] == FRAME[:begin]
    assert out[out.index(END) + len(END):] == FRAME[end:]

    (TASK / "tests").mkdir(exist_ok=True)
    (TASK / "tests" / "test.sh").write_text(out)
    print("wrote tests/test.sh (%d bytes)" % len(out))


if __name__ == "__main__":
    main()
