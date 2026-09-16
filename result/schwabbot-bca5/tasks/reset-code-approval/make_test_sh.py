#!/usr/bin/env python3
"""Rebuild tests/test.sh from the platform frame plus this task's run block.

Everything outside the RUN TESTS markers belongs to the platform. It is copied
byte for byte from frame_test.sh and the result is checked against it before
the file is replaced.

    ./make_test_sh.py
"""

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FRAME = HERE / "frame_test.sh"
TARGET = HERE / "tests" / "test.sh"
HARNESS = HERE / "harness"

OPEN_MARK = "# >>> RUN TESTS (task-specific) <<<"
CLOSE_MARK = "# >>> END RUN TESTS <<<"

BASE_SHA = "7bc88a1c75c331045b5714ee4a411e0321efc5a1"

# The suites the repository ships, restored from the base commit so an edited
# assertion never stands in for a passing build.
GRADED_SOURCES = [
    "tests/__init__.py",
    "tests/test_offline.py",
    "tests/test_schwab_api.py",
    "tests/test_server_api.py",
    "tests/test_user_allow.py",
    "Users/tests.py",
    "AdminCustom/tests.py",
    "BotList/tests.py",
    "Engine/tests.py",
]

BASE_LABELS = [
    "tests.test_offline",
    "tests.test_schwab_api",
    "tests.test_server_api",
    "tests.test_user_allow",
    "Users.tests",
    "AdminCustom.tests",
    "BotList.tests",
    "Engine.tests",
]

NEW_LABELS = [
    "tests.test_reset_gate",
    "tests.test_reset_clock",
]


def heredoc(name):
    body = (HARNESS / name).read_text()
    marker = "__" + name.split(".")[0].upper() + "__"
    assert marker not in body, name
    return 'cat > "$VDIR/%s" <<\'%s\'\n%s%s\n' % (name, marker, body, marker)


def block():
    lines = []
    add = lines.append
    add("# The image ships no pytest, so the two selections are driven through")
    add("# Django's own runner by a child that lives outside /app: it reads a")
    add("# per-run token on stdin, imports unittest and django.test while /app is")
    add("# still off sys.path, snapshots every decision point in both, and streams")
    add("# one verdict per case on an inherited descriptor. A root publisher that")
    add("# never imports repository code turns that stream into the two reports")
    add("# config.json names, and publishes every declared id, failing the ones no")
    add("# verdict arrived for. The child runs as nobody wherever this script is")
    add("# root, so nothing a suite imports can reach the reports, the checkout it")
    add("# is graded against, or the list of ids that are graded.")
    add("set +e")
    add("unset PYTHONPATH")
    add('BASE_SHA="%s"' % BASE_SHA)
    add("")
    add("# Knowing which ids are graded is the difference between forging a report")
    add("# and reproducing a whole run, and no suite needs that list.")
    add("chmod -R go-rwx /tests 2>/dev/null || true")
    add("")
    add("VDIR=/verify")
    add('if ! mkdir -p "$VDIR" 2>/dev/null; then')
    add('  VDIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"')
    add('  mkdir -p "$VDIR" 2>/dev/null')
    add("fi")
    add('log "harness in $VDIR"')
    add("")
    add("# The graded suites come back from the base commit, and stale bytecode")
    add("# goes, so nothing a submission left behind decides an outcome.")
    add("for _src in " + " ".join('"%s"' % p for p in GRADED_SOURCES) + "; do")
    add('  git -C /app checkout -q "$BASE_SHA" -- "$_src" 2>>"$RUN_LOG" || log "could not restore $_src"')
    add("done")
    add('find /app -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null')
    add("")
    for name in ("child.py", "publish.py"):
        add(heredoc(name).rstrip("\n"))
        add("")
    add('SCRATCH="$VDIR/tmp"')
    add('mkdir -p "$SCRATCH" 2>/dev/null')
    add('chown -R root:root "$VDIR" 2>/dev/null')
    add('chmod 0444 "$VDIR"/*.py 2>/dev/null')
    add('chmod 0555 "$VDIR" 2>/dev/null')
    add('chmod 1777 "$SCRATCH" 2>/dev/null')
    add("")
    add("# Drop the child. Submitted code runs inside it, so it must not reach the")
    add("# verifier's files. With no setpriv the publisher drops it instead, and")
    add("# either way the block runs rather than refusing to run.")
    add('RUNAS=""')
    add('if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then')
    add('  _uid=$(id -u nobody 2>/dev/null || echo 65534)')
    add('  _gid=$(id -g nogroup 2>/dev/null || id -g nobody 2>/dev/null || echo 65534)')
    add('  if setpriv --reuid="$_uid" --regid="$_gid" --clear-groups true >/dev/null 2>&1; then')
    add('    RUNAS="setpriv --reuid=$_uid --regid=$_gid --clear-groups"')
    add('    log "suite child runs as uid $_uid gid $_gid"')
    add("  fi")
    add("fi")
    add("export RUNAS")
    add("")
    add("run_selection() {")
    add('  _out="$1"; shift')
    add('  echo "+ selection $_out: $*" >> "$RUN_LOG" 2>/dev/null')
    add('  timeout 700 python3 -I "$VDIR/publish.py" "$VDIR" "$SCRATCH" "$_out" "$@" 2>&1 | tee -a "$RUN_LOG"')
    add("}")
    add("")
    add('cd /app || exit 6')
    add("run_selection /logs/verifier/base.xml " + " ".join(BASE_LABELS))
    add("run_selection /logs/verifier/new.xml " + " ".join(NEW_LABELS))
    add("set -e")
    return "\n".join(lines) + "\n"


def main():
    frame = FRAME.read_text()
    head, _, rest = frame.partition(OPEN_MARK)
    _, _, tail = rest.partition(CLOSE_MARK)
    if not head or not tail:
        print("frame markers missing", file=sys.stderr)
        return 1
    built = head + OPEN_MARK + "\n" + block() + CLOSE_MARK + tail
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(built)
    TARGET.chmod(0o755)

    check_head, _, check_rest = TARGET.read_text().partition(OPEN_MARK)
    _, _, check_tail = check_rest.partition(CLOSE_MARK)
    assert check_head == head, "frame prologue moved"
    assert check_tail == tail, "frame epilogue moved"
    print("wrote %s (%d bytes), frame byte-identical" % (TARGET, len(built)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
