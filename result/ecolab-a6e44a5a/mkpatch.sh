#!/bin/bash
# Regenerate solution.patch and test.patch from the work tree against the
# pristine base tree. Both are taken with the base tree clean, so nothing from
# an earlier run can leak into either patch.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="$here/base-tree"
work="$here/repo"
out="$here/tasks/event-effects"

solution_files=(
  docs/disturbances.md
  packages/biome-model/src/compile.ts
  packages/biome-model/src/decode.ts
  packages/biome-model/src/index.ts
  packages/biome-model/src/records.ts
  packages/biomeweaver-cli/src/router.ts
  packages/biomeweaver/src/index.ts
  packages/resource-engine/src/index.ts
  packages/resource-engine/src/modifiers.ts
  packages/resource-engine/src/modifiers.test.ts
  packages/resource-engine/src/renew.ts
  packages/tick-runtime/src/advance.ts
  packages/tick-runtime/src/events.ts
  packages/tick-runtime/src/events.test.ts
  packages/tick-runtime/src/index.ts
)

test_files=(
  packages/tick-runtime/src/fixed-events.test.ts
  packages/biome-model/src/event-validation.test.ts
  packages/biomeweaver-cli/src/event-commands.test.ts
)

cd "$base"
git reset -q --hard HEAD
git clean -fdq -e node_modules

for f in "${solution_files[@]}"; do
  mkdir -p "$(dirname "$f")"
  cp "$work/$f" "$f"
done
git add -A
git diff --cached > "$out/solution/solution.patch"
echo -n "solution: "
git diff --cached --numstat | awk '{a+=$1; r+=$2} END {printf "added=%d removed=%d churn=%d files=%d\n", a, r, a+r, NR}'
echo -n "  non-test: "
git diff --cached --numstat | awk '$3 !~ /\.test\.ts$/ {a+=$1; r+=$2; n+=1} END {printf "added=%d removed=%d churn=%d files=%d\n", a, r, a+r, n}'

git reset -q --hard HEAD
git clean -fdq -e node_modules
for f in "${test_files[@]}"; do
  mkdir -p "$(dirname "$f")"
  cp "$here/heldout/$(basename "$f")" "$f"
done
git add -A
git diff --cached > "$out/tests/test.patch"
echo -n "tests:    "
git diff --cached --numstat | awk '{a+=$1; r+=$2} END {printf "added=%d removed=%d files=%d\n", a, r, NR}'

git reset -q --hard HEAD
git clean -fdq -e node_modules
