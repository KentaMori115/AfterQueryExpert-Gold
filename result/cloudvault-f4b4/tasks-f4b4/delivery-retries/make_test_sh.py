#!/usr/bin/env python3
"""Rebuild tests/test.sh from the platform frame plus this task's run block.

Everything outside the RUN TESTS markers is platform property: it is copied
byte for byte from tests/test.sh.frame, and the result is checked against it.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FRAME = HERE / "tests" / "test.sh.frame"
TARGET = HERE / "tests" / "test.sh"
HARNESS = HERE / "harness"

OPEN_MARK = "# >>> RUN TESTS (task-specific) <<<"
CLOSE_MARK = "# >>> END RUN TESTS <<<"

SUITES = [
    "__tests__/api-key.test.ts",
    "__tests__/file-utils.test.ts",
    "__tests__/image-processor.test.ts",
    "__tests__/share-manager.test.ts",
    "__tests__/share-utils.test.ts",
    "__tests__/stats.test.ts",
    "__tests__/version-trash.test.ts",
    "__tests__/webhook.test.ts",
    "__tests__/workspace-rbac.test.ts",
    "__tests__/delivery-sweep.test.ts",
    "__tests__/delivery-attempts.test.ts",
]


def heredoc(name, marker):
    body = (HARNESS / name).read_text()
    assert marker not in body, name
    return f'cat > "$VERIFY_DIR/{name}" <<\'{marker}\'\n{body}{marker}\n'


def block():
    lines = []
    add = lines.append
    add("# The image installs jest, ts-jest and the native packages the existing")
    add("# suites need, so the real runner drives both selections. What it does not")
    add("# provide is a report format the grader reads, and the repository's own")
    add("# jest.config.js, package.json and tsconfig.json are all committed files a")
    add("# submission may rewrite. So configuration, reporter and integrity guard")
    add("# all live outside /app, the run happens as an unprivileged user, and the")
    add("# result stream is signed with a token the parent reads from stdin before")
    add("# any worker exists. A python3 publisher holding the whitelist turns that")
    add("# stream into the two reports config.json names, failing every id the")
    add("# stream did not carry.")
    add("set +e")
    add("")
    add("VERIFY_DIR=/verify")
    add('mkdir -p "$VERIFY_DIR" 2>/dev/null || VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"')
    add('mkdir -p "$VERIFY_DIR" "$VERIFY_DIR/scratch" 2>/dev/null')
    add('chmod 0777 "$VERIFY_DIR/scratch" 2>/dev/null')
    add("")
    for name, marker in (
        ("guard.js", "__GUARD__"),
        ("reporter.js", "__REPORTER__"),
        ("jest.verifier.config.js", "__JESTCFG__"),
        ("publish.py", "__PUBLISH__"),
    ):
        add(heredoc(name, marker).rstrip("\n"))
        add("")
    add("# A submission can edit the existing suites, and those cases back the")
    add("# pass-to-pass ids, so put them back the way the base commit had them.")
    add('if command -v git >/dev/null 2>&1; then')
    add('  git -C /app config --global --add safe.directory /app 2>/dev/null')
    for suite in SUITES[:9]:
        add(f'  git -C /app checkout HEAD -- {suite} 2>/dev/null')
    add("fi")
    add("")
    add("# The generated config names the harness by absolute path; point it at")
    add("# wherever the harness actually landed.")
    add('sed -i "s#/verify/#$VERIFY_DIR/#g" "$VERIFY_DIR/jest.verifier.config.js" 2>/dev/null')
    add("")
    add("# Only the eleven graded files run. A suite the submission adds under")
    add("# __tests__ is neither run nor reported.")
    add('python3 - "$VERIFY_DIR/jest.verifier.config.js" <<\'__SUITES__\'')
    add("import sys")
    add("suites = [")
    for suite in SUITES:
        add(f'    "{suite}",')
    add("]")
    add('names = ",\\n        ".join(f\'"<rootDir>/{s}"\' for s in suites)')
    add("path = sys.argv[1]")
    add("body = open(path).read()")
    add('body = body.replace(\'testMatch: ["<rootDir>/__tests__/**/*.test.ts"],\',')
    add('                    f"testMatch: [\\n        {names},\\n    ],")')
    add("open(path, 'w').write(body)")
    add("__SUITES__")
    add("")
    add("chmod 0444 \"$VERIFY_DIR\"/*.js \"$VERIFY_DIR\"/publish.py 2>/dev/null")
    add("")
    add("# One token per run, readable by root alone. The jest parent reads it from")
    add("# stdin and signs the stream with it; a worker inherits the descriptor at")
    add("# EOF and gets nothing.")
    add('TOKEN="$( (head -c 24 /dev/urandom | od -An -tx1 | tr -d " \\n") 2>/dev/null )"')
    add('[ -n "$TOKEN" ] || TOKEN="fallback-$$-$(date +%s 2>/dev/null)"')
    add('printf "%s" "$TOKEN" > "$VERIFY_DIR/token"')
    add('chmod 0400 "$VERIFY_DIR/token" 2>/dev/null')
    add("")
    add("# Resolution must not walk into anything the submission shipped, so the")
    add("# in-tree copy of the package directory goes and the image's own tree is")
    add("# the only one on the path.")
    add("rm -rf /app/node_modules 2>/dev/null")
    add("")
    add('JEST_BIN=/opt/task-node_modules/jest-cli/bin/jest.js')
    add('[ -f "$JEST_BIN" ] || JEST_BIN="$(command -v jest 2>/dev/null)"')
    add("")
    add('RUNNER=""')
    add('if command -v setpriv >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then')
    add('  RUNNER="setpriv --reuid=65534 --regid=65534 --clear-groups"')
    add('  chown -R 65534:65534 "$VERIFY_DIR/scratch" 2>/dev/null')
    add("fi")
    add("")
    add('if [ -n "$JEST_BIN" ] && command -v node >/dev/null 2>&1; then')
    add('  log "running the graded suites as ${RUNNER:-root}"')
    add('  printf "%s" "$TOKEN" | timeout 900 env \\')
    add('      HOME="$VERIFY_DIR/scratch" TMPDIR="$VERIFY_DIR/scratch" \\')
    add('      VERIFY_RESULTS="$VERIFY_DIR/scratch/results.json" \\')
    add('      $RUNNER node "$JEST_BIN" \\')
    add('      --config "$VERIFY_DIR/jest.verifier.config.js" --ci --colors=false \\')
    add('      2>&1 | tee -a "$RUN_LOG"')
    add("else")
    add('  log "ERROR: no node or no jest in this image; every id will be published as failed"')
    add("fi")
    add("")
    add("# Reports are written whatever happened above, so an id that never ran is")
    add("# a failed id rather than a missing file.")
    add('python3 -I "$VERIFY_DIR/publish.py" /tests/config.json "$VERIFY_DIR/token" \\')
    add('    "$VERIFY_DIR/scratch/results.json" \\')
    add('    /logs/verifier/base_ctrf.json /logs/verifier/new_ctrf.json 2>&1 | tee -a "$RUN_LOG"')
    add("")
    add('rm -f "$VERIFY_DIR/token" 2>/dev/null')
    add("set -e")
    return "\n".join(lines) + "\n"


def main():
    frame = FRAME.read_text()
    head, rest = frame.split(OPEN_MARK, 1)
    _, tail = rest.split(CLOSE_MARK, 1)
    out = head + OPEN_MARK + "\n" + block() + CLOSE_MARK + tail
    TARGET.write_text(out)
    TARGET.chmod(0o755)

    # the frame outside the markers must survive byte for byte
    written = TARGET.read_text()
    w_head, w_rest = written.split(OPEN_MARK, 1)
    _, w_tail = w_rest.split(CLOSE_MARK, 1)
    if w_head != head or w_tail != tail:
        print("frame drift outside the RUN TESTS markers", file=sys.stderr)
        return 1
    print(f"wrote {TARGET} ({len(written)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
