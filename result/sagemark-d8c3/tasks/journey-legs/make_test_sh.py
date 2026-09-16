#!/usr/bin/env python3
"""Generate tests/test.sh from the frozen frame.

The frame outside the RUN TESTS markers is the platform's. This writes only the
block between them and asserts every byte above and below is unchanged.

    ./make_test_sh.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / "frame_test.sh"
TARGET = HERE / "tests" / "test.sh"
START = "# >>> RUN TESTS (task-specific) <<<\n"
END = "# >>> END RUN TESTS <<<\n"

BLOCK = r"""# >>> RUN TESTS (task-specific) <<<
BASE=00800e20bf11764d07d33a49ffd1f1798ed699ed
ADDED="src/core/rules/journey.spec.ts src/core/rules/supply.spec.ts"
BASE_REPORT=/logs/verifier/base_junit.xml
NEW_REPORT=/logs/verifier/new_junit.xml
MODEL_PATCH=/logs/artifacts/model.patch

# Specs sit beside the source in this repository, so the selection that backs
# the pass-to-pass ids is every spec the base tree carries, read from the base
# commit rather than from the submitted tree.
EXISTING="$(git ls-tree -r --name-only "$BASE" 2>/dev/null | grep '\.spec\.ts$' | tr '\n' ' ')"

# The suite imports the submitted src/ before a single case runs, so how the
# tests are found, loaded and asserted has to come from the repository and not
# from the change: every shipped spec, the vite, vitest and TypeScript
# configuration, the setup file the runner loads, and the package manifest are
# restored from the base commit. The held-back specs are new at the base, so
# the checkout leaves them alone.
git checkout -q "$BASE" -- '*.spec.ts' vitest.config.ts vite.config.ts src/test-setup.ts \
  package.json package-lock.json tsconfig.json tsconfig.app.json tsconfig.node.json \
  postcss.config.cjs tailwind.config.ts eslint.config.js .prettierrc.json index.html 2>/dev/null || \
  log "WARNING: could not restore the shipped specs and configuration from $BASE"
rm -rf dist coverage .vite node_modules/.vite node_modules/.vitest

# Dependencies are the image's. A patch that ships its own copy of a package, a
# workspace file that would redefine the run, the runner's setup file or an npm
# config that injects node options is not a submission the suite can be trusted
# on: both reports stay empty, so every declared id grades as failed with the
# reason in this log.
refused=""
if [ -s "$MODEL_PATCH" ]; then
  for _p in $(python3 /tests/grader.py patch-paths "$MODEL_PATCH"); do
    case "$_p" in
      node_modules/*|*/node_modules/*|.npmrc|vitest.workspace.*|vite.config.*|vitest.config.*|src/test-setup.*)
        refused="$refused $_p" ;;
    esac
  done
fi

report() {
  # default reporter to stdout so a failure stays readable, junit to the graded
  # report; written to a private path first so nothing left running under /app
  # can find the report by name before grading reads it.
  local target="$1" files="$2" tmp
  tmp="$(mktemp /tmp/junit.XXXXXXXX)"
  run_log node node_modules/vitest/vitest.mjs run --config ./vitest.config.ts \
    --pool=forks --reporter=default --reporter=junit --outputFile="$tmp" $files
  pkill -9 -x node 2>/dev/null || true
  mv -f "$tmp" "$target" 2>/dev/null || : > "$target"
}

if [ -n "$refused" ]; then
  log "ERROR: model.patch touches$refused; every declared id will report failed"
  : > "$BASE_REPORT"
  : > "$NEW_REPORT"
elif [ -z "$EXISTING" ]; then
  log "ERROR: no specs found at $BASE; every declared id will report failed"
  : > "$BASE_REPORT"
  : > "$NEW_REPORT"
elif [ ! -f node_modules/vitest/vitest.mjs ]; then
  log "ERROR: node_modules/vitest is missing from the image; every declared id will report failed"
  : > "$BASE_REPORT"
  : > "$NEW_REPORT"
else
  report "$BASE_REPORT" "$EXISTING"
  report "$NEW_REPORT" "$ADDED"
fi
# >>> END RUN TESTS <<<
"""


def split(text: str) -> tuple[str, str]:
    start = text.index(START)
    end = text.index(END) + len(END)
    return text[:start], text[end:]


def main() -> int:
    if not FRAME.exists():
        print(f"missing frame: {FRAME}")
        return 1
    head, tail = split(FRAME.read_text())
    generated = head + BLOCK + tail
    if TARGET.exists():
        current_head, current_tail = split(TARGET.read_text())
        if (current_head, current_tail) != (head, tail):
            print("REFUSING: tests/test.sh has drifted outside the RUN TESTS markers")
            return 1
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(generated)
    TARGET.chmod(0o755)
    written_head, written_tail = split(TARGET.read_text())
    assert (written_head, written_tail) == (head, tail), "frame moved while writing"
    print(f"wrote {TARGET} ({len(generated)} bytes); frame byte-identical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
