#!/usr/bin/env python3
"""Rebuild tests/test.sh from the platform frame plus this task's run block.

The frame outside the RUN TESTS markers is platform property: it is copied
byte for byte from tests/test.sh.frame and the result is checked against it.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
FRAME = HERE / "tests" / "test.sh.frame"
TARGET = HERE / "tests" / "test.sh"
HARNESS = HERE / "harness"
TASK_TOML = HERE / "task.toml"

OPEN_MARK = "# >>> RUN TESTS (task-specific) <<<"
CLOSE_MARK = "# >>> END RUN TESTS <<<"

# Every suite the repository ships. All 184 cases in them pass at the base
# commit and pass again with the feature in, so all 184 back the
# pass-to-pass ids.
BASE_SUITES = [
    "ecosystem-lab/cli/commands.cli.test.ts",
    "ecosystem-lab/complete-biomes/crystal-tundra.biome.test.ts",
    "ecosystem-lab/invalid-models/invalid.biome.test.ts",
    "ecosystem-lab/properties/conservation.test.ts",
    "ecosystem-lab/properties/determinism.test.ts",
    "ecosystem-lab/properties/locale.test.ts",
    "ecosystem-lab/properties/metamorphic.test.ts",
    "packages/biome-model/src/compile.test.ts",
    "packages/biome-model/src/decode.catalog.test.ts",
    "packages/biome-model/src/identifiers.test.ts",
    "packages/biome-model/src/species.catalog.test.ts",
    "packages/biome-reports/src/render.test.ts",
    "packages/biomeweaver-cli/src/commands.catalog.test.ts",
    "packages/biomeweaver-cli/src/options.test.ts",
    "packages/biomeweaver/src/baseline-guard.test.ts",
    "packages/calendar-engine/src/seasons.test.ts",
    "packages/capsule-source/src/diagnostics/diagnostic.test.ts",
    "packages/capsule-source/src/discovery/discover.test.ts",
    "packages/capsule-source/src/gather/fingerprint.test.ts",
    "packages/capsule-source/src/gather/gather.test.ts",
    "packages/capsule-source/src/json/parse-json.test.ts",
    "packages/capsule-source/src/yaml/parse-yaml.test.ts",
    "packages/fixed-point/src/arithmetic.test.ts",
    "packages/fixed-point/src/catalog.test.ts",
    "packages/fixed-point/src/coverage.test.ts",
    "packages/fixed-point/src/parse.test.ts",
    "packages/fixed-point/src/rounding.test.ts",
    "packages/flow-explanations/src/catalog.test.ts",
    "packages/flow-explanations/src/flow.test.ts",
    "packages/population-engine/src/cohorts.test.ts",
    "packages/population-engine/src/stages.test.ts",
    "packages/predation-engine/src/consume.test.ts",
    "packages/resource-engine/src/allocate.test.ts",
    "packages/resource-engine/src/renew.test.ts",
    "packages/run-store/src/store.test.ts",
    "packages/tick-runtime/src/advance.test.ts",
]

HELD_OUT_NEW = [
    "ecosystem-lab/crowding/seats.biome.test.ts",
    "ecosystem-lab/crowding/reporting.biome.test.ts",
]

# Files the repository's own runner would read to decide what runs and how it
# is reported. Nothing here drives this verifier, but a submission that edits
# one is a submission trying to, and restoring them costs nothing.
PINNED = [
    "vitest.shared.ts",
    "vitest.unit.config.ts",
    "vitest.biomes.config.ts",
    "vitest.properties.config.ts",
    "vitest.cli.config.ts",
    "tsconfig.json",
    "tsconfig.base.json",
    "package.json",
]

# The one runtime package the repository imports. capsule-source parses every
# authored record through it, so a graded run that cannot resolve it grades
# nothing; a copy taken before the run starts is what the harness resolves
# against, and /app's own copy is never consulted.
VENDORED = ["yaml"]


def base_sha():
    text = TASK_TOML.read_text()
    found = re.search(r'base_commit_hash\s*=\s*"([0-9a-f]{40})"', text)
    if not found:
        raise SystemExit("task.toml carries no base_commit_hash")
    return found.group(1)


def heredoc(name):
    body = (HARNESS / name).read_text()
    marker = "__" + name.split(".")[0].upper() + "__"
    assert marker not in body, name
    return f'cat > "$VERIFY_DIR/{name}" <<\'{marker}\'\n{body}{marker}\n'


def block():
    lines = []
    add = lines.append
    add("# Node 24 runs this workspace's TypeScript straight from source, so the")
    add("# graded suites are driven without dist/, without the installed package")
    add("# tree and without the repository's own test runner: nothing a submission")
    add("# adds under /app can stand in for the framework that decides what a case")
    add("# reports. The runner lives outside /app, reads a per-run token before any")
    add("# repository module loads, and reports each case on stdout; a python3")
    add("# publisher that never imports repository code turns that stream into the")
    add("# two reports config.json names.")
    add("#")
    add("# The token is the whole basis of that stream, so nothing puts it anywhere")
    add("# the graded child can look. It is written into a root-owned file under a")
    add("# directory the child cannot enter, never passing through a command line")
    add("# (/proc/<pid>/cmdline is world readable) or an environment. The child")
    add("# gets it as an already-open stdin and closes it; the publisher gets it as")
    add("# an already-open fd 3. /tests is shut to everyone but root while the")
    add("# suites run, so the id whitelist is not readable either.")
    add("set +e")
    add(f'BASE_SHA="{base_sha()}"')
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
    add("# The workspace imports one package, and the harness resolves it against a")
    add("# copy taken now, root owned, outside anything a submission can write. The")
    add("# copy is made after the tracked node_modules sweep above, so a smuggled")
    add("# tree is already gone when it happens. Where the image has no copy to")
    add("# take, resolution falls through and the suites say so themselves.")
    add('mkdir -p "$VERIFY_DIR/node_modules" 2>/dev/null')
    add("for _pkg in " + " ".join(f'"{p}"' for p in VENDORED) + "; do")
    add('  if [ -d "/app/node_modules/$_pkg" ]; then')
    add('    cp -a "/app/node_modules/$_pkg" "$VERIFY_DIR/node_modules/" 2>>"$RUN_LOG" || log "could not pin $_pkg"')
    add("  else")
    add('    log "no /app/node_modules/$_pkg to pin"')
    add("  fi")
    add("done")
    add('printf "export const pinned = true\\n" > "$VERIFY_DIR/anchor.mjs" 2>/dev/null')
    add('HARNESS_ANCHOR="$VERIFY_DIR/anchor.mjs"')
    add("export HARNESS_ANCHOR")
    add("")
    add('chmod 0444 "$VERIFY_DIR"/*.mjs "$VERIFY_DIR"/*.py 2>/dev/null')
    add('chmod -R a-w "$VERIFY_DIR/node_modules" 2>/dev/null')
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
