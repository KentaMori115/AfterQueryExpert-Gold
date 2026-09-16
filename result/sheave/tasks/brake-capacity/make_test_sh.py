#!/usr/bin/env python3
"""Rebuild tests/test.sh from the platform frame plus this task's run block.

The frame outside the RUN TESTS markers is platform property: it is copied
byte for byte from tests/test.sh.frame and the result is checked against it.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FRAME = HERE / "tests" / "test.sh.frame"
TARGET = HERE / "tests" / "test.sh"
HARNESS = HERE / "harness"

OPEN_MARK = "# >>> RUN TESTS (task-specific) <<<"
CLOSE_MARK = "# >>> END RUN TESTS <<<"

BASE_SUITES = [
    "test/cage.test.ts",
    "test/cli.test.ts",
    "test/costing.test.ts",
    "test/cycle.test.ts",
    "test/design.test.ts",
    "test/drum.test.ts",
    "test/errors.test.ts",
    "test/examples.test.ts",
    "test/power.test.ts",
    "test/report.test.ts",
    "test/rope.test.ts",
    "test/safety.test.ts",
    "test/shaft.test.ts",
    "test/structure.test.ts",
    "test/units.test.ts",
    "test/winder.test.ts",
]
BASE_FIXTURES = [
    "examples/bolsover.winder",
    "examples/wheal-jane.winder",
    "examples/zollverein.winder",
]
HELD_OUT_NEW = ["test/holding.test.ts", "test/lowering.test.ts"]
BASE_SHA = "bb4eda665b5ba5e281155e94d4c72fee12ef2797"


def heredoc(name):
    body = (HARNESS / name).read_text()
    marker = "__" + name.split(".")[0].upper() + "__"
    assert marker not in body, name
    return f'cat > "$VERIFY_DIR/{name}" <<\'{marker}\'\n{body}{marker}\n'


def block():
    lines = []
    add = lines.append
    add("# Node 24 reads this repository's TypeScript without a build step, so the")
    add("# suites run straight from source. The runner lives outside /app, takes a")
    add("# per-run token off stdin before a line of repository code is loaded, and")
    add("# reports each case on stdout; a python3 publisher that never imports")
    add("# anything from /app turns that stream into the two reports config.json")
    add("# names, and publishes every declared id whatever the child did.")
    add("set +e")
    add(f'BASE_SHA="{BASE_SHA}"')
    add("VERIFY_DIR=/verify")
    add('if ! mkdir -p "$VERIFY_DIR" 2>/dev/null; then')
    add('  VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"')
    add('  mkdir -p "$VERIFY_DIR" 2>/dev/null')
    add("fi")
    add('log "harness in $VERIFY_DIR"')
    add("")
    add("# The suites the repository ships back the pass-to-pass ids, so they are")
    add("# put back to the base commit first, and so are the three installations")
    add("# they read: an edited assertion never stands in for a passing build, and")
    add("# an edited example never turns a shipped assertion into a different one.")
    add("for _suite in " + " ".join(f'"{p}"' for p in BASE_SUITES + BASE_FIXTURES) + "; do")
    add('  git -C /app checkout -q "$BASE_SHA" -- "$_suite" 2>>"$RUN_LOG" || log "could not restore $_suite"')
    add("done")
    add("")
    add("# Nothing under /app decides anything here, and a package tree committed")
    add("# into the repository would be loaded ahead of the image's own, so any")
    add("# tracked file below node_modules is dropped before the runner starts.")
    add('git -C /app ls-files -z node_modules 2>/dev/null | xargs -0 -r rm -f 2>>"$RUN_LOG"')
    add("")
    for name in ("shim.mjs", "hooks.mjs", "register.mjs", "run.mjs", "publish.py"):
        add(heredoc(name).rstrip("\n"))
        add("")
    add('chmod 0444 "$VERIFY_DIR"/* 2>/dev/null')
    add('chmod 0555 "$VERIFY_DIR" 2>/dev/null')
    add('chown -R root:root "$VERIFY_DIR" 2>/dev/null')
    add("")
    add('NODE_FLAGS="--experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON"')
    add('AS_NOBODY=""')
    add('if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then')
    add('  AS_NOBODY="setpriv --reuid=65534 --regid=65534 --clear-groups"')
    add('  log "running the suites as nobody"')
    add("else")
    add('  log "no setpriv or not root: the suites run in place"')
    add("fi")
    add("")
    add("run_selection() {")
    add('  _bucket="$1"; _out="$2"; shift 2')
    add('  _token="$(head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d " \\n")"')
    add('  [ -n "$_token" ] || _token="run-$$-$_bucket"')
    add('  echo "+ $_bucket selection: $*" >> "$RUN_LOG" 2>/dev/null')
    add("  printf %s \"$_token\" | \\")
    add('    HARNESS_APP=/app HARNESS_HOOKS="$VERIFY_DIR/hooks.mjs" HARNESS_SHIM="$VERIFY_DIR/shim.mjs" \\')
    add('    timeout 900 $AS_NOBODY node $NODE_FLAGS --import "$VERIFY_DIR/register.mjs" "$VERIFY_DIR/run.mjs" "$@" \\')
    add('      2>>"$RUN_LOG" | python3 -I "$VERIFY_DIR/publish.py" --token "$_token" --bucket "$_bucket" --out "$_out" 2>&1 | tee -a "$RUN_LOG"')
    add("}")
    add("")
    add("cd /app || exit 6")
    add("run_selection base /logs/verifier/base_junit.xml " + " ".join(f'"{p}"' for p in BASE_SUITES))
    add("run_selection new /logs/verifier/new_junit.xml " + " ".join(f'"{p}"' for p in HELD_OUT_NEW))
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
    TARGET.write_text(built)
    TARGET.chmod(0o755)

    check_head, _, check_rest = built.partition(OPEN_MARK)
    _, _, check_tail = check_rest.partition(CLOSE_MARK)
    assert check_head == head, "frame prologue moved"
    assert check_tail == tail, "frame epilogue moved"
    print(f"wrote {TARGET} ({len(built)} bytes), frame intact")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
