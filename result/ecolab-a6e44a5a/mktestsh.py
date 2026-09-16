#!/usr/bin/env python3
"""Regenerate tests/test.sh from the frozen frame.

The frame is the file the platform handed us in the draft. Only the block
between the RUN TESTS markers is ours; this script rewrites that block and
asserts every byte outside the markers is unchanged.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / "frame" / "test.sh"
OUT = HERE / "tasks" / "event-effects" / "tests" / "test.sh"

START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"

BLOCK = r"""
set +e
mkdir -p /logs/verifier

# Both selections run under runner configurations written here rather than any
# read out of /app, so a committed config, alias or setup file cannot decide
# what a case reports. Plain objects, no imports: a config living outside the
# project cannot resolve the project's own packages, so the workspace aliases
# are spelled out against /app.
ALIASES="    '@biomeweaver/fixed-point': '/app/packages/fixed-point/src/index.ts',
    '@biomeweaver/capsule-source': '/app/packages/capsule-source/src/index.ts',
    '@biomeweaver/biome-model': '/app/packages/biome-model/src/index.ts',
    '@biomeweaver/calendar-engine': '/app/packages/calendar-engine/src/index.ts',
    '@biomeweaver/resource-engine': '/app/packages/resource-engine/src/index.ts',
    '@biomeweaver/population-engine': '/app/packages/population-engine/src/index.ts',
    '@biomeweaver/predation-engine': '/app/packages/predation-engine/src/index.ts',
    '@biomeweaver/tick-runtime': '/app/packages/tick-runtime/src/index.ts',
    '@biomeweaver/flow-explanations': '/app/packages/flow-explanations/src/index.ts',
    '@biomeweaver/run-store': '/app/packages/run-store/src/index.ts',
    '@biomeweaver/biome-reports': '/app/packages/biome-reports/src/index.ts',
    '@biomeweaver/cli': '/app/packages/biomeweaver-cli/src/index.ts',
    'biomeweaver': '/app/packages/biomeweaver/src/index.ts',"

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

GRADED_CONFIG=/tmp/biomeweaver-graded.config.ts
cat > "$GRADED_CONFIG" <<CONFIG
export default {
  root: '/app',
  resolve: {
    alias: {
$ALIASES
    },
  },
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    include: [
      '.verifier-canary/canary.test.ts',
      'packages/tick-runtime/src/fixed-events.test.ts',
      'packages/biome-model/src/event-validation.test.ts',
      'packages/biomeweaver-cli/src/event-commands.test.ts',
    ],
  },
}
CONFIG

SHIPPED_CONFIG=/tmp/biomeweaver-shipped.config.ts
cat > "$SHIPPED_CONFIG" <<CONFIG
export default {
  root: '/app',
  resolve: {
    alias: {
$ALIASES
    },
  },
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    include: [
      'packages/**/*.test.ts',
      'ecosystem-lab/**/*.biome.test.ts',
      'ecosystem-lab/properties/**/*.test.ts',
      'ecosystem-lab/cli/**/*.cli.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/tick-runtime/src/fixed-events.test.ts',
      'packages/biome-model/src/event-validation.test.ts',
      'packages/biomeweaver-cli/src/event-commands.test.ts',
    ],
  },
}
CONFIG

graded_status=1
if command -v npx >/dev/null 2>&1; then
  log "running the disturbance cases"
  run_log npx vitest run --config "$GRADED_CONFIG" \
    --reporter=basic --reporter=junit --outputFile.junit=/logs/verifier/new_junit.xml
  graded_status=$?
  log "disturbance cases exited $graded_status"

  log "running the shipped suite"
  run_log npx vitest run --config "$SHIPPED_CONFIG" \
    --reporter=basic --reporter=junit --outputFile.junit=/logs/verifier/base_junit.xml
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
body = ['<?xml version="1.0" encoding="UTF-8" ?>', f'<testsuites name="disturbances" tests="{len(ids)}">']
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
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + BLOCK + tail)
    OUT.chmod(0o755)

    written = OUT.read_text()
    if not written.startswith(head) or not written.endswith(tail):
        print("frame bytes moved", file=sys.stderr)
        return 1
    if written[: start + len(START)] != frame[: start + len(START)]:
        print("bytes above the marker moved", file=sys.stderr)
        return 1
    if written[written.index(END):] != frame[end:]:
        print("bytes below the marker moved", file=sys.stderr)
        return 1
    print("wrote %s (%d bytes), frame outside the markers unchanged" % (OUT, len(written)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
