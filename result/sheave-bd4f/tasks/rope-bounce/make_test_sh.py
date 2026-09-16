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

# Every suite the repository ships. structure.test.ts stays in the run even
# though one of its cases cannot pass in this image: the environment deletes
# /app/package.json, and that one case reads it. The case is simply not on the
# pass-to-pass whitelist. Its other thirteen cases are, and they are the ones
# that hold the new module to the repository's own layout rules.
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
HELD_OUT_NEW = [
    "test/pit/hanging-rope.test.ts",
    "test/pit/stopped-wind.test.ts",
    "test/pit/three-collieries.test.ts",
    "test/pit/signing-off.test.ts",
]
BASE_SHA = "bb4eda665b5ba5e281155e94d4c72fee12ef2797"

# Files the repository's own runner would read to decide what runs and how it
# is reported. Nothing here drives this verifier, but a submission that edits
# one is a submission trying to, and restoring them costs nothing.
PINNED = ["vitest.config.ts", "tsconfig.json", "tsconfig.build.json"]


def heredoc(name):
    body = (HARNESS / name).read_text()
    marker = "__" + name.split(".")[0].upper() + "__"
    assert marker not in body, name
    return f'cat > "$VERIFY_DIR/{name}" <<\'{marker}\'\n{body}{marker}\n'


def block():
    lines = []
    add = lines.append
    add("# Node 24 runs this repository's TypeScript straight from source, so the")
    add("# graded suites are driven without the installed package tree and without")
    add("# the repository's own test runner: nothing a submission adds under /app")
    add("# can stand in for the framework that decides what a case reports. The")
    add("# runner lives outside /app, reads a per-run token before any repository")
    add("# module loads, and reports each case on stdout; a python3 publisher that")
    add("# never imports repository code turns that stream into the two reports")
    add("# config.json names.")
    add("#")
    add("# The token is the whole basis of that stream, so nothing puts it anywhere")
    add("# the graded child can look. It is written into a root-owned file under a")
    add("# directory the child cannot enter, never passing through a command line")
    add("# (/proc/<pid>/cmdline is world readable) or an environment. The child")
    add("# gets it as an already-open stdin and closes it; the publisher gets it as")
    add("# an already-open fd 3. /tests is shut to everyone but root while the")
    add("# suites run, so the id whitelist is not readable either.")
    add("set +e")
    add(f'BASE_SHA="{BASE_SHA}"')
    add('VERIFY_DIR=/verify')
    add('if ! mkdir -p "$VERIFY_DIR" 2>/dev/null; then')
    add('  VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"')
    add('  mkdir -p "$VERIFY_DIR" 2>/dev/null')
    add("fi")
    add('log "harness in $VERIFY_DIR"')
    add("")
    add("# The suites the repository ships, and the files its own runner is")
    add("# configured by, are restored from the base commit: an edited assertion")
    add("# never stands in for a passing build.")
    add("for _pinned in " + " ".join(f'"{p}"' for p in BASE_SUITES + PINNED) + "; do")
    add('  git -C /app checkout -q "$BASE_SHA" -- "$_pinned" 2>>"$RUN_LOG" || log "could not restore $_pinned"')
    add("done")
    add("")
    add("# node_modules is ignored, not refused: a submission can force-add a tree")
    add("# there and the grader will apply it. Nothing under it is wanted here, so")
    add("# whatever arrived tracked goes before the runner starts.")
    add('_smuggled="$(git -C /app ls-files -z node_modules 2>/dev/null | tr -dc "\\0" | wc -c | tr -d " ")"')
    add('if [ "${_smuggled:-0}" != "0" ]; then')
    add('  log "removing $_smuggled tracked files under node_modules"')
    add('  git -C /app ls-files -z node_modules 2>/dev/null | (cd /app && xargs -0 -r rm -f) 2>>"$RUN_LOG"')
    add("fi")
    add("")
    for name in ("shim.mjs", "hooks.mjs", "register.mjs", "run.mjs", "publish.py"):
        add(heredoc(name).rstrip("\n"))
        add("")
    add("# This repository declares no runtime dependencies and the harness imports")
    add("# no package, so there is no tree to pin resolution to and the anchor stays")
    add("# empty. Resolution never leaves /app and the harness directory.")
    add('HARNESS_ANCHOR=""')
    add("export HARNESS_ANCHOR")
    add("")
    add('chmod 0444 "$VERIFY_DIR"/*.mjs "$VERIFY_DIR"/*.py 2>/dev/null')
    add('chmod 0555 "$VERIFY_DIR" 2>/dev/null')
    add('chown -R root:root "$VERIFY_DIR" 2>/dev/null')
    add("")
    add("# Where the per-run tokens are written. Mode 0700 and root owned: the")
    add("# child can neither list it nor open what is in it, and holds a token only")
    add("# as a descriptor handed to it before privileges were dropped.")
    add('TOKEN_DIR="$VERIFY_DIR/run"')
    add('mkdir -p "$TOKEN_DIR" 2>/dev/null')
    add('chown root:root "$TOKEN_DIR" 2>/dev/null')
    add('chmod 0700 "$TOKEN_DIR" 2>/dev/null')
    add("")
    add('NODE_FLAGS="--experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON"')
    add('AS_NOBODY=""')
    add('if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then')
    add('  AS_NOBODY="setpriv --reuid=65534 --regid=65534 --clear-groups"')
    add("fi")
    add("")
    add("run_selection() {")
    add('  _bucket="$1"; _out="$2"; shift 2')
    add('  _tokf="$TOKEN_DIR/$_bucket"')
    add('  rm -f "$_tokf" 2>/dev/null')
    add('  ( umask 077; head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d " \\n" > "$_tokf" ) 2>/dev/null')
    add('  if [ ! -s "$_tokf" ]; then')
    add('    ( umask 077; { date +%s%N; echo "$$ $_bucket"; } 2>/dev/null | cksum | tr -d " \\n" > "$_tokf" ) 2>/dev/null')
    add("  fi")
    add('  chmod 0400 "$_tokf" 2>/dev/null')
    add("  # One descriptor for each end of the pipeline, and then the name goes.")
    add("  # What is left cannot be opened by path by anyone, so the token survives")
    add("  # even a run where privileges could not be dropped; the child closes its")
    add("  # copy before the first repository module loads.")
    add('  exec 7<"$_tokf" 8<"$_tokf" 2>/dev/null')
    add('  rm -f "$_tokf" 2>/dev/null')
    add('  echo "+ $_bucket selection: $*" >> "$RUN_LOG" 2>/dev/null')
    add('  HARNESS_APP=/app HARNESS_HOOKS="$VERIFY_DIR/hooks.mjs" HARNESS_SHIM="$VERIFY_DIR/shim.mjs" \\')
    add('    HARNESS_ANCHOR="$HARNESS_ANCHOR" \\')
    add('    timeout 900 $AS_NOBODY node $NODE_FLAGS --import "$VERIFY_DIR/register.mjs" "$VERIFY_DIR/run.mjs" "$@" \\')
    add('      <&8 8<&- 7<&- 2>>"$RUN_LOG" \\')
    add('    | python3 -I "$VERIFY_DIR/publish.py" --bucket "$_bucket" --out "$_out" 3<&7 7<&- 8<&- 2>&1 | tee -a "$RUN_LOG"')
    add('  exec 7<&- 8<&- 2>/dev/null')
    add("}")
    add("")
    add("cd /app || exit 6")
    add("")
    add("# The whitelist lives in /tests/config.json. The publisher reads it as")
    add("# root; nothing running out of /app has any business with it, so the")
    add("# directory is shut for the length of the run and opened again after.")
    add('TESTS_LOCKED=""')
    add('if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && [ -d /tests ]; then')
    add("  if chmod 0700 /tests 2>/dev/null; then TESTS_LOCKED=1; fi")
    add("fi")
    add("")
    add("run_selection base /logs/verifier/base_junit.xml " + " ".join(f'"{p}"' for p in BASE_SUITES))
    add("run_selection new /logs/verifier/new_junit.xml " + " ".join(f'"{p}"' for p in HELD_OUT_NEW))
    add("")
    add('[ -n "$TESTS_LOCKED" ] && chmod 0755 /tests 2>/dev/null')
    add('rm -rf "$TOKEN_DIR" 2>/dev/null')
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
