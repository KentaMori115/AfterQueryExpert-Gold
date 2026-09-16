#!/usr/bin/env python3
"""Generate tests/test.sh from the frozen frame.

The frame outside the RUN TESTS markers is the platform's, not ours. This
writes only the block between them and asserts every byte above and below is
unchanged before the file is replaced.

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
BASE=cbfb245b02c044e160ca8346fc17ce78eb374ddc
EXISTING="tests/catalog/calibre.test.ts tests/catalog/effect.test.ts \
tests/catalog/envelope.test.ts tests/catalog/hazard.test.ts \
tests/catalog/inventory.test.ts tests/catalog/lift.test.ts \
tests/catalog/magazine.test.ts tests/catalog/palette.test.ts \
tests/catalog/parse.test.ts tests/catalog/registry.test.ts \
tests/catalog/substitute.test.ts tests/catalog/timing.test.ts \
tests/catalog/validate.test.ts tests/cli/args.test.ts \
tests/cli/commands.test.ts tests/cli/command.test.ts \
tests/cli/completion.test.ts tests/cli/diffHazard.test.ts \
tests/cli/distance.test.ts tests/cli/label.test.ts tests/cli/lint.test.ts \
tests/cli/permitContinuity.test.ts tests/cli/planLayout.test.ts \
tests/cli/preview.test.ts tests/cli/sheetInventory.test.ts \
tests/compile.test.ts tests/core/codes.test.ts tests/core/collect.test.ts \
tests/core/csv.test.ts tests/core/diagnostic.test.ts tests/core/graph.test.ts \
tests/core/ids.test.ts tests/core/interval.test.ts tests/core/numeric.test.ts \
tests/core/result.test.ts tests/core/rng.test.ts tests/core/span.test.ts \
tests/core/text.test.ts tests/core/timecode.test.ts tests/core/units.test.ts \
tests/coverage.test.ts tests/endToEnd.test.ts tests/examples.test.ts \
tests/export/explain.test.ts tests/export/firingTable.test.ts \
tests/export/json.test.ts tests/export/pack.test.ts \
tests/export/permit.test.ts tests/export/sheets.test.ts \
tests/export/siteplan.test.ts tests/large.test.ts tests/rig/allocate.test.ts \
tests/rig/circuit.test.ts tests/rig/continuity.test.ts \
tests/rig/layout.test.ts tests/rig/module.test.ts tests/rig/parse.test.ts \
tests/rig/pin.test.ts tests/rig/redundancy.test.ts tests/rig/rig.test.ts \
tests/rig/wiring.test.ts tests/robust.test.ts tests/safety/crowd.test.ts \
tests/safety/distance.test.ts tests/safety/noise.test.ts \
tests/safety/rules.test.ts tests/safety/site.test.ts \
tests/safety/wind.test.ts tests/script/annotate.test.ts \
tests/script/ast.test.ts tests/script/expand.test.ts \
tests/script/format.test.ts tests/script/include.test.ts \
tests/script/lint.test.ts tests/script/parser.test.ts \
tests/script/renumber.test.ts tests/script/resolve.test.ts \
tests/script/token.test.ts tests/sim/preview.test.ts \
tests/sim/trajectory.test.ts tests/surface.test.ts \
tests/timeline/balance.test.ts tests/timeline/chain.test.ts \
tests/timeline/density.test.ts tests/timeline/diff.test.ts \
tests/timeline/load.test.ts tests/timeline/misfire.test.ts \
tests/timeline/quantise.test.ts tests/timeline/rehearsal.test.ts \
tests/timeline/schedule.test.ts tests/timeline/sync.test.ts \
tests/version.test.ts"
ADDED="tests/timeline/panelClock.test.ts tests/cli/morningAfter.test.ts"
BASE_REPORT=/logs/verifier/base_junit.xml
NEW_REPORT=/logs/verifier/new_junit.xml
MODEL_PATCH=/logs/artifacts/model.patch

# The suite imports the submitted src/ before a single case runs, so how the
# tests are found, loaded and asserted must come from the repository, not
# from the change: the whole test tree, the vitest, TypeScript, eslint and
# prettier configuration and the package manifest are restored from the base
# commit. The held-back files are new at the base, so the checkout leaves
# them be.
git checkout -q "$BASE" -- tests vitest.config.ts package.json package-lock.json \
  tsconfig.json tsconfig.build.json tsconfig.bench.json eslint.config.js \
  .prettierrc.json .prettierignore 2>/dev/null || \
  log "WARNING: could not restore the test tree and configuration from $BASE"
rm -rf dist dist-bench coverage

# Dependencies are the image's. A patch that ships its own copy of a package,
# a workspace file that would redefine the test run, a setup file under the
# test tree, or an npm config that injects node options is not a submission
# the suite can be trusted on: both reports stay empty, so every declared id
# grades as failed with the reason in this log.
refused=""
if [ -s "$MODEL_PATCH" ]; then
  for _p in $(python3 /tests/grader.py patch-paths "$MODEL_PATCH"); do
    case "$_p" in
      node_modules/*|*/node_modules/*|.npmrc|vitest.workspace.*|vite.config.*|vitest.config.*|tests/setup*|tests/support/*)
        refused="$refused $_p" ;;
    esac
  done
fi

report() {
  # default reporter to stdout so failures stay readable, junit to the graded
  # report; written to a private path first so nothing left running under
  # /app can find the report by name before grading reads it.
  local target="$1" files="$2" tmp
  tmp="$(mktemp /tmp/junit.XXXXXXXX)"
  run_log node node_modules/vitest/vitest.mjs run --config ./vitest.config.ts \
    --reporter=default --reporter=junit --outputFile="$tmp" $files
  pkill -9 -x node 2>/dev/null || true
  mv -f "$tmp" "$target" 2>/dev/null || : > "$target"
}

if [ -n "$refused" ]; then
  log "ERROR: model.patch touches$refused; every declared id will report failed"
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
