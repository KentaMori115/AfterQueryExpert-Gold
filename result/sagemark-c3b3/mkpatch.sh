#!/bin/bash
# Regenerate solution.patch and test.patch from the work tree, against the
# pristine base tree. Both patches are taken with the base tree clean, so a
# stale copy from an earlier run can never leak into either one.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="$here/base-tree"
work="$here/repo"
out="$here/tasks/bundle-restore"

solution_files=(
  src/core/io/bundle.ts
  src/core/io/idmap.ts
  src/core/io/restore.ts
  src/features/io/useRestore.ts
  src/features/io/pages/BackupPage.vue
)
for s in campaign character faction location session arc encounter relationship lore item quest timeline note tag holiday downtime; do
  solution_files+=("src/core/services/$s-service.ts")
done

test_files=(
  src/core/io/restore-graph.spec.ts
  src/core/io/restore-tally.spec.ts
  src/core/io/restore-modules.spec.ts
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
