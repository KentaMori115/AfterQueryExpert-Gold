#!/bin/bash
# Regenerate solution.patch and test.patch from the work tree against the
# pristine base tree. Both are taken with the base tree clean, so nothing from
# an earlier run can leak into either patch.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="$here/base-tree"
work="$here/repo"
out="$here/tasks/reward-recall"

solution_files=(
  docs/api.md
  docs/architecture.md
  docs/cli.md
  docs/cookbook.md
  docs/handbook.md
  docs/reference.md
  docs/sdk.md
  src/api/routes/rewards.ts
  src/cli/commands/index.ts
  src/cli/commands/reward.ts
  src/cli/index.ts
  src/domain/rewards/prize-pool.ts
  src/engine/rewards/claims.ts
  src/engine/rewards/index.ts
  src/engine/rewards/recall.ts
  src/engine/rewards/reward-engine.ts
  src/engine/rewards/statement.ts
  src/engine/tournament/tournament-service.ts
  src/sdk/rewards.ts
)

test_files=(
  tests/engine/prize-desk.test.ts
  tests/engine/payout-surfaces.test.ts
)

cd "$base"
rm -f .gitattributes
git reset -q --hard HEAD
git clean -fdq -e node_modules

# git quotes the nearest unindented line above a hunk into the "@@ ... @@"
# text. For markdown that drags whole sentences of untouched prose into the
# patch, including one ciChecks rejects on sight, so the heuristic is silenced
# for .md while these diffs are taken.
printf '*.md diff=plainmd\n' > .gitattributes
plain_diff() {   # any extra flags come first, the pathspec has to stay last
  git -c diff.plainmd.xfuncname='$^' diff --cached "$@" -- . ':(exclude).gitattributes'
}

for f in "${solution_files[@]}"; do
  mkdir -p "$(dirname "$f")"
  cp "$work/$f" "$f"
done
git add -A
plain_diff > "$out/solution/solution.patch"
echo -n "solution: "
plain_diff --numstat | awk '{a+=$1; r+=$2} END {printf "added=%d removed=%d churn=%d files=%d\n", a, r, a+r, NR}'

git reset -q --hard HEAD
git clean -fdq -e node_modules
printf '*.md diff=plainmd\n' > .gitattributes
for f in "${test_files[@]}"; do
  mkdir -p "$(dirname "$f")"
  cp "$here/heldout/$(basename "$f")" "$f"
done
git add -A
plain_diff > "$out/tests/test.patch"
echo -n "tests:    "
plain_diff --numstat | awk '{a+=$1; r+=$2} END {printf "added=%d removed=%d files=%d\n", a, r, NR}'

git reset -q --hard HEAD
git clean -fdq -e node_modules
rm -f "$base/.gitattributes"
