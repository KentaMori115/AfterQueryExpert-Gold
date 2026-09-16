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
    "lib/ops/billing/ledger.test.ts",
    "lib/ops/capacity/planner.test.ts",
    "lib/ops/clock.test.ts",
    "lib/ops/concurrency/etag.test.ts",
    "lib/ops/events/project.test.ts",
    "lib/ops/graph/dag.test.ts",
    "lib/ops/invoices/builder.test.ts",
    "lib/ops/jobs/queue.test.ts",
    "lib/ops/merge/document.test.ts",
    "lib/ops/query/parser.test.ts",
    "lib/ops/rate-limit/limiter.test.ts",
    "lib/ops/rbac/engine.test.ts",
    "lib/ops/routing/digest.test.ts",
    "lib/ops/schedule/rrule.test.ts",
    "lib/ops/timeseries/buckets.test.ts",
    "lib/ops/webhooks/delivery.test.ts",
    "lib/ops/workflow/machine.test.ts",
    "lib/paginate.test.ts",
]
HELD_OUT_BASE = ["checks/ledger-invariants.spec.ts"]
HELD_OUT_NEW = ["checks/close-books.spec.ts"]
BASE_SHA = "710f4235a38468a48b96cff885b1104ee4f9f05a"


def heredoc(path, name):
    body = (HARNESS / name).read_text()
    marker = "__" + name.split(".")[0].upper() + "__"
    assert marker not in body, name
    return f'cat > "$VERIFY_DIR/{name}" <<\'{marker}\'\n{body}{marker}\n'


def block():
    lines = []
    add = lines.append
    add("# Node 24 runs this repository's TypeScript without a build step, so the")
    add("# suites are driven straight from source: no package tree is installed in")
    add("# the image, and none is needed. The runner lives outside /app, reads a")
    add("# per-run token before any repository module loads, and reports each case")
    add("# on stdout; a python3 publisher that never imports repository code turns")
    add("# that stream into the two reports config.json names.")
    add("set +e")
    add(f'BASE_SHA="{BASE_SHA}"')
    add('VERIFY_DIR=/verify')
    add('if ! mkdir -p "$VERIFY_DIR" 2>/dev/null; then')
    add('  VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"')
    add('  mkdir -p "$VERIFY_DIR" 2>/dev/null')
    add('fi')
    add('log "harness in $VERIFY_DIR"')
    add("")
    add("# The graded suites the repository ships are restored from the base commit,")
    add("# so an edited assertion never stands in for a passing build.")
    add('for _suite in ' + " ".join(f'"{p}"' for p in BASE_SUITES) + '; do')
    add('  git -C /app checkout -q "$BASE_SHA" -- "$_suite" 2>>"$RUN_LOG" || log "could not restore $_suite"')
    add('done')
    add("")
    for name in ("shim.mjs", "hooks.mjs", "register.mjs", "run.mjs", "publish.py"):
        add(heredoc(HARNESS / name, name).rstrip("\n"))
        add("")
    add('chmod 0444 "$VERIFY_DIR"/* 2>/dev/null')
    add('chmod 0555 "$VERIFY_DIR" 2>/dev/null')
    add('chown -R root:root "$VERIFY_DIR" 2>/dev/null')
    add("")
    add('NODE_FLAGS="--experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON"')
    add('AS_NOBODY=""')
    add('if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then')
    add('  AS_NOBODY="setpriv --reuid=65534 --regid=65534 --clear-groups"')
    add('fi')
    add("")
    add("run_selection() {")
    add('  _bucket="$1"; _out="$2"; shift 2')
    add('  _token="$(head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d " \\n")"')
    add('  [ -n "$_token" ] || _token="run-$$-$_bucket"')
    add('  echo "+ $_bucket selection: $*" >> "$RUN_LOG" 2>/dev/null')
    add('  printf %s "$_token" | \\')
    add('    HARNESS_APP=/app HARNESS_HOOKS="$VERIFY_DIR/hooks.mjs" HARNESS_SHIM="$VERIFY_DIR/shim.mjs" \\')
    add('    timeout 900 $AS_NOBODY node $NODE_FLAGS --import "$VERIFY_DIR/register.mjs" "$VERIFY_DIR/run.mjs" "$@" \\')
    add('      2>>"$RUN_LOG" | python3 -I "$VERIFY_DIR/publish.py" --token "$_token" --bucket "$_bucket" --out "$_out" 2>&1 | tee -a "$RUN_LOG"')
    add("}")
    add("")
    add('cd /app || exit 6')
    add('run_selection base /logs/verifier/base_junit.xml ' + " ".join(f'"{p}"' for p in BASE_SUITES + HELD_OUT_BASE))
    add('run_selection new /logs/verifier/new_junit.xml ' + " ".join(f'"{p}"' for p in HELD_OUT_NEW))
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
