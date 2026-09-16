#!/usr/bin/env python3
"""Generate tests/test.sh from the frozen frame.

Only the block between the RUN TESTS markers is ours. Everything outside them
is copied byte for byte from frame/test.sh and asserted identical afterwards,
so a frame edit can never slip in unnoticed.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / "frame" / "test.sh"
OUT = HERE / "tasks" / "reward-recall" / "tests" / "test.sh"

START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"

GRADED = [
    "tests/engine/prize-desk.test.ts",
    "tests/engine/payout-surfaces.test.ts",
]

BLOCK = r'''
set +e
mkdir -p /logs/verifier

BASE_COMMIT="$(python3 -I -c 'import json; print(json.load(open("/tests/config.json"))["base_commit"])' 2>/dev/null || echo "")"

# The held-back patch resets only the files it names, so every other test file
# keeps whatever the submission left in it and the pass-to-pass ids would be
# graded off the submission's own copy. Put them back the way the base commit
# had them. Restore, never refuse: a build that appended a case to an existing
# file is a reasonable build, and a missing git is not a reason to score zero.
if [ -n "$BASE_COMMIT" ] && command -v git >/dev/null 2>&1; then
  git config --global --add safe.directory /app >/dev/null 2>&1
  git -C /app ls-tree -r --name-only "$BASE_COMMIT" -- tests 2>/dev/null \
    | grep -E '^tests/.*[.]test[.]ts$' > /tmp/base-tests.txt
  while IFS= read -r _rel; do
    case "$_rel" in
__GRADED_CASES__
    esac
    git -C /app checkout "$BASE_COMMIT" -- "$_rel" >/dev/null 2>&1 || true
  done < /tmp/base-tests.txt
  log "restored $(wc -l < /tmp/base-tests.txt) shipped test files from the base commit"
else
  log "no git or no base commit: shipped test files run as they are on disk"
fi

# A case the runner has to report as failed. Submitted code shares the process
# with the runner and can neuter an assertion, stub the runner, or hand back a
# report nobody ran. A case that cannot pass and comes back passing, or
# missing, says the report is fiction.
mkdir -p /app/.verifier-canary
cat > /app/.verifier-canary/canary.test.ts <<'CANARY'
import { describe, expect, it } from "vitest";

describe("verifier canary", () => {
  it("never passes", () => {
    expect(1).toBe(2);
  });
});
CANARY

# Both selections run under runner configurations written here rather than any
# read out of /app, so a committed config or setup file cannot decide what a
# case reports. Plain objects, no imports.
GRADED_CONFIG=/tmp/arenaflow-graded.config.ts
cat > "$GRADED_CONFIG" <<'CONFIG'
export default {
  root: '/app',
  cacheDir: '/tmp/runner-cache',
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    sequence: { shuffle: false },
    include: [
      '.verifier-canary/canary.test.ts',
__GRADED_INCLUDE__
    ],
  },
}
CONFIG

SHIPPED_CONFIG=/tmp/arenaflow-shipped.config.ts
cat > "$SHIPPED_CONFIG" <<'CONFIG'
export default {
  root: '/app',
  cacheDir: '/tmp/runner-cache',
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    sequence: { shuffle: false },
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
__GRADED_INCLUDE__
    ],
  },
}
CONFIG

# Submitted code shares the runner's process, so a report left lying on disk
# can be rewritten after the run that produced it. Stream each report through
# a root-owned pipe instead and keep the FIRST document that comes out of it,
# with the runner itself dropped to an unprivileged user so it cannot reach
# the pipe's other end. Every step here degrades: no root, no setpriv, no
# mkfifo and the run still happens, just against a plain file.
CAPTURE_DIR=/verify-pipes
DROP=""
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then
  if command -v setpriv >/dev/null 2>&1 && id nobody >/dev/null 2>&1; then
    DROP="setpriv --reuid=nobody --regid=nogroup --clear-groups"
    mkdir -p /tmp/runner-home /tmp/runner-cache
    chmod 0777 /tmp/runner-home /tmp/runner-cache
  fi
fi
if mkdir -p "$CAPTURE_DIR" 2>/dev/null && chmod 0711 "$CAPTURE_DIR" 2>/dev/null; then
  :
else
  CAPTURE_DIR=""
fi

capture_pid=""
open_capture() {   # $1 = fifo name, $2 = destination
  [ -n "$CAPTURE_DIR" ] || { echo "$2"; return; }
  rm -f "$CAPTURE_DIR/$1"
  if ! mkfifo "$CAPTURE_DIR/$1" 2>/dev/null; then
    echo "$2"
    return
  fi
  # The runner opens its report file read/write, so a write-only pipe is
  # refused outright. The pipe carries nothing secret: what matters is that
  # root reads the first document out of it before anything can rewrite one.
  chmod 0666 "$CAPTURE_DIR/$1" 2>/dev/null || true
  python3 -I - "$CAPTURE_DIR/$1" "$2" >/dev/null 2>&1 <<'CAPTURE' &
import sys

source, destination = sys.argv[1], sys.argv[2]
chunks = []
with open(source, "rb") as pipe:
    for block in iter(lambda: pipe.read(65536), b""):
        chunks.append(block)
        joined = b"".join(chunks)
        if b"</testsuites>" in joined:
            break
body = b"".join(chunks)
cut = body.find(b"</testsuites>")
if cut != -1:
    body = body[: cut + len(b"</testsuites>")]
with open(destination, "wb") as out:
    out.write(body)
CAPTURE
  capture_pid=$!
  echo "$CAPTURE_DIR/$1"
}

run_suite() {   # $1 = label, $2 = config, $3 = fifo name, $4 = destination
  local target
  target="$(open_capture "$3" "$4")"
  log "running $1"
  # shellcheck disable=SC2086
  run_log env HOME=/tmp/runner-home $DROP npx vitest run --config "$2" \
    --reporter=basic --reporter=junit --outputFile.junit="$target"
  local status=$?
  if [ -n "$capture_pid" ]; then
    # The reader is holding an empty pipe if the runner never wrote; open the
    # write end once so it can finish either way.
    : > "$target" 2>/dev/null || true
    wait "$capture_pid" 2>/dev/null || true
    capture_pid=""
  fi
  log "$1 exited $status"
  return $status
}

graded_status=1
if command -v npx >/dev/null 2>&1; then
  chmod -R a+rX /app/tests /app/.verifier-canary 2>/dev/null || true
  run_suite "the payout cases" "$GRADED_CONFIG" new.fifo /logs/verifier/new_junit.xml
  graded_status=$?
  run_suite "the shipped suite" "$SHIPPED_CONFIG" base.fifo /logs/verifier/base_junit.xml
else
  log "ERROR: npx is not on PATH, no case can run"
fi

# A run that ends badly while its report shows nothing wrong is a report that
# cannot be trusted: code under /app shares the process with the runner and can
# break it from the inside, leaving every case looking green. Publish every
# graded case as failed rather than read a report like that, and say why.
python3 -I - "$graded_status" <<'GUARD'
import json
import sys
import xml.dom.minidom
from pathlib import Path
from xml.sax.saxutils import escape

status = int(sys.argv[1] or 0)
report = Path("/logs/verifier/new_junit.xml")
ids = json.loads(Path("/tests/config.json").read_text()).get("f2p_node_ids", [])

reason = None
if not report.exists() or report.stat().st_size == 0:
    reason = "no report was written"
else:
    try:
        doc = xml.dom.minidom.parse(str(report))
    except Exception as err:
        reason = f"report will not parse ({err})"
    else:
        cases = doc.getElementsByTagName("testcase")
        def broken(case):
            return bool(case.getElementsByTagName("failure") or case.getElementsByTagName("error"))
        bad = [c for c in cases if broken(c)]
        canary = [c for c in cases if (c.getAttribute("name") or "").strip() == "verifier canary > never passes"]
        if not cases:
            reason = "report carries no cases"
        elif not canary:
            reason = "the canary case never reported"
        elif not any(broken(c) for c in canary):
            reason = "the canary case came back passing"
        elif status != 0 and not bad:
            reason = f"run exited {status} with nothing marked failed"

if reason is None:
    sys.exit(0)

print(f"[verifier] graded report rejected: {reason}")
body = ['<?xml version="1.0" encoding="UTF-8" ?>', f'<testsuites name="payouts" tests="{len(ids)}">']
for node in ids:
    head, sep, name = node.partition(".test.ts.")
    classname = head + ".test.ts" if sep else head
    body.append(f'  <testcase classname="{escape(classname)}" name="{escape(name or node)}">')
    body.append(f'    <failure message="{escape(reason)}"></failure>')
    body.append("  </testcase>")
body.append("</testsuites>")
report.write_text("\n".join(body) + "\n")
GUARD
set -e
'''


def main() -> None:
    frame = FRAME.read_text()
    head, marker, rest = frame.partition(START)
    assert marker, "frame is missing the start marker"
    _body, end_marker, tail = rest.partition(END)
    assert end_marker, "frame is missing the end marker"

    graded_cases = "\n".join(f'      {path}) continue ;;' for path in GRADED)
    graded_include = "\n".join(f"      '{path}'," for path in GRADED)
    block = BLOCK.replace("__GRADED_CASES__", graded_cases).replace(
        "__GRADED_INCLUDE__", graded_include
    )

    OUT.write_text(head + START + block + END + tail)
    OUT.chmod(0o755)

    # The frame is frozen: prove the generated file only differs inside it.
    written = OUT.read_text()
    assert written.startswith(head + START), "bytes above the marker moved"
    assert written.endswith(END + tail), "bytes below the marker moved"
    print(f"wrote {OUT} ({len(written)} bytes), frame intact")


if __name__ == "__main__":
    main()
