#!/usr/bin/env python3
"""Regenerate tests/test.sh from the frozen frame.

The frame is the file the platform handed us in the draft. Only the block
between the RUN TESTS markers is ours; this script rewrites that block and
asserts every byte outside the markers is unchanged.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / 'frame' / 'test.sh'
OUT = HERE / 'tasks' / 'bundle-restore' / 'tests' / 'test.sh'

START = '# >>> RUN TESTS (task-specific) <<<'
END = '# >>> END RUN TESTS <<<'

BLOCK = r"""
set +e
mkdir -p /logs/verifier

# The graded selection runs under a runner configuration written here rather
# than one read out of /app, so a committed config or setup file cannot decide
# what a case reports. Plain object, no imports: a config outside the project
# cannot resolve the project's own packages.
VERIFY_CONFIG=/tmp/sagemark-verify.config.ts
cat > "$VERIFY_CONFIG" <<'CONFIG'
export default {
  root: '/app',
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    include: [
      'src/core/io/restore-graph.spec.ts',
      'src/core/io/restore-tally.spec.ts',
      'src/core/io/restore-modules.spec.ts',
    ],
  },
}
CONFIG

log "running the restore cases"
run_log npx vitest run --config "$VERIFY_CONFIG" \
  --reporter=basic --reporter=junit --outputFile.junit=/logs/verifier/new_junit.xml
graded_status=$?
log "restore cases exited $graded_status"

log "running the rest of the suite"
run_log npx vitest run \
  --pool=forks --reporter=basic --reporter=junit \
  --outputFile.junit=/logs/verifier/base_junit.xml
log "rest of the suite exited $?"

# A run that ends badly while its report shows nothing wrong is a report that
# cannot be trusted: code under /app can break the runner from inside the
# process and leave every case looking green. Publish every graded case as
# failed rather than read a report like that, and say so in the log.
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
        if status != 0 and not bad:
            reason = f"run exited {status} with nothing marked failed"
        elif not cases:
            reason = "report carries no cases"

if reason is None:
    sys.exit(0)

print(f"[verifier] graded report rejected: {reason}")
body = ['<?xml version="1.0" encoding="UTF-8" ?>', f'<testsuites name="restore" tests="{len(ids)}">']
for node in ids:
    head, sep, name = node.partition(".spec.ts.")
    classname = head + ".spec.ts" if sep else head
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
    head, rest = frame.split(START, 1)
    _, tail = rest.split(END, 1)
    OUT.write_text(head + START + BLOCK + END + tail)

    # the frame outside the markers must not have moved
    written = OUT.read_text()
    w_head, w_rest = written.split(START, 1)
    _, w_tail = w_rest.split(END, 1)
    if w_head != head or w_tail != tail:
        print('FRAME MOVED', file=sys.stderr)
        return 1
    print(f'wrote {OUT} ({len(written.splitlines())} lines), frame intact')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
