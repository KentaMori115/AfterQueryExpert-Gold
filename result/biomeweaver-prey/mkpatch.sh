#!/bin/bash
# Regenerate solution.patch and test.patch from the work tree against the
# pristine base tree. Both are taken with the base tree clean, so a stale copy
# from an earlier run can never leak into either one.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="$here/base-tree"
work="$here/repo"
out="$here/tasks/prey-competition"

solution_files=(
  packages/predation-engine/src/types.ts
  packages/predation-engine/src/response.ts
  packages/predation-engine/src/hunger.ts
  packages/predation-engine/src/claims.ts
  packages/predation-engine/src/rationing.ts
  packages/predation-engine/src/settle.ts
  packages/predation-engine/src/consume.ts
  packages/predation-engine/src/index.ts
  packages/biome-model/src/records.ts
  packages/biome-model/src/decode.ts
  packages/biome-model/src/compile.ts
  docs/predation.md
  docs/tick-phases.md
  docs/species-and-resources.md
)

test_files=(
  packages/predation-engine/src/rationing.test.ts
  packages/predation-engine/src/saturation.test.ts
)

mkdir -p "$out/solution" "$out/tests"

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
