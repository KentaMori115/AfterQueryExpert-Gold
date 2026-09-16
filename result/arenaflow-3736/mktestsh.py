#!/usr/bin/env python3
"""Regenerate tests/test.sh from the frozen frame.

The frame is the file the platform hands out in the draft. Only the block
between the RUN TESTS markers is ours; this script rewrites that block and
asserts every byte outside the markers is unchanged.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / "frame" / "test.sh"
OUT = HERE / "tasks" / "match-void-rescore" / "tests" / "test.sh"

START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"

BLOCK = r"""
set +e
mkdir -p /logs/verifier

# Both selections run under runner configurations written here rather than any
# read out of /app, so a committed vitest config, alias or setup file cannot
# decide what a case reports. Plain objects, no imports: the project resolves
# from /app, which is where the runner is installed.

# The shipped cases are the pass-to-pass evidence, and the submission owns the
# tree they live in: a build that breaks one of them can simply rewrite the
# case, and the report comes back clean. Put every test file the base commit
# carries back the way it was, after the patches have been applied. Files the
# submission added on top are left alone, so its own tests still run.
base_commit=$(python3 -c 'import json;print(json.load(open("/tests/config.json")).get("base_commit") or "")' 2>/dev/null)
if [ -n "$base_commit" ] && command -v git >/dev/null 2>&1 \
   && git -C /app cat-file -e "${base_commit}^{commit}" 2>/dev/null; then
  if git -C /app checkout "$base_commit" -- tests >>"$RUN_LOG" 2>&1; then
    log "restored $(git -C /app ls-tree -r --name-only "$base_commit" -- tests | wc -l) shipped test files from $base_commit"
    log "note: only files the base commit carries come back; a test file added later is not restorable"
  else
    log "WARNING: shipped test files could not be restored, they run as submitted"
  fi
else
  log "WARNING: no usable base commit or no git, shipped test files run as submitted"
fi

# A canary the runner has to report as failed. Submitted code shares the
# process with the runner and can neuter an assertion, stub the runner, or
# hand back a report nobody ran; a case that cannot pass and comes back
# passing, or missing, says the report is fiction.
mkdir -p /app/.verifier-canary
cat > /app/.verifier-canary/canary.test.ts <<'CANARY'
import { describe, expect, it } from "vitest";

describe("verifier canary", () => {
  it("never passes", () => {
    expect(1).toBe(2);
  });
});
CANARY

GRADED_CONFIG=/tmp/arenaflow-graded.config.ts
cat > "$GRADED_CONFIG" <<'CONFIG'
export default {
  root: '/app',
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    sequence: { shuffle: false },
    include: [
      '.verifier-canary/canary.test.ts',
      'tests/engine/withdrawn-results.test.ts',
      'tests/events/withdrawn-replay.test.ts',
    ],
  },
}
CONFIG

SHIPPED_CONFIG=/tmp/arenaflow-shipped.config.ts
cat > "$SHIPPED_CONFIG" <<'CONFIG'
export default {
  root: '/app',
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
      'tests/engine/withdrawn-results.test.ts',
      'tests/events/withdrawn-replay.test.ts',
    ],
  },
}
CONFIG

graded_status=1
if command -v npx >/dev/null 2>&1; then
  log "running the withdrawal cases"
  run_log npx vitest run --config "$GRADED_CONFIG" \
    --reporter=default --reporter=junit --outputFile.junit=/logs/verifier/new_junit.xml
  graded_status=$?
  log "withdrawal cases exited $graded_status"

  log "running the shipped suite"
  run_log npx vitest run --config "$SHIPPED_CONFIG" \
    --reporter=default --reporter=junit --outputFile.junit=/logs/verifier/base_junit.xml
  log "shipped suite exited $?"
else
  log "ERROR: npx is not on PATH, no case can run"
fi

# A run that ends badly while its report shows nothing wrong is a report that
# cannot be trusted: code under /app shares the process with the runner and can
# break it from the inside, leaving every case looking green. Publish every
# graded case as failed rather than read a report like that, and say why.
python3 - "$graded_status" <<'GUARD'
import json
import sys
import xml.etree.ElementTree as ET
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
        tree = ET.parse(report)
    except ET.ParseError as err:
        reason = f"report will not parse ({err})"
    else:
        cases = list(tree.iter("testcase"))
        bad = [c for c in cases if list(c.iter("failure")) or list(c.iter("error"))]
        canary = [c for c in cases if (c.get("name") or "").strip() == "verifier canary > never passes"]
        if not cases:
            reason = "report carries no cases"
        elif not canary:
            reason = "the canary case never reported"
        elif not any(list(c.iter("failure")) or list(c.iter("error")) for c in canary):
            reason = "the canary case came back passing"
        elif status != 0 and not bad:
            reason = f"run exited {status} with nothing marked failed"

if reason is None:
    sys.exit(0)

print(f"[verifier] graded report rejected: {reason}")
body = ['<?xml version="1.0" encoding="UTF-8" ?>', f'<testsuites name="withdrawals" tests="{len(ids)}">']
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
"""


def main() -> int:
    frame = FRAME.read_text()
    start = frame.index(START)
    end = frame.index(END)
    head = frame[: start + len(START)]
    tail = frame[end:]
    out = head + BLOCK + tail
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out)
    OUT.chmod(0o755)

    # the frame outside the markers must be byte identical
    written = OUT.read_text()
    assert written[: start + len(START)] == head, "bytes above the marker moved"
    assert written[written.index(END) :] == tail, "bytes below the marker moved"
    print(f"wrote {OUT} ({len(written)} bytes), frame outside the markers unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
