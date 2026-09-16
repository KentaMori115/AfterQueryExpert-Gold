#!/bin/bash
# Regenerate solution.patch and test.patch from the work tree against the
# pristine base tree. Both are taken with the base tree clean, so nothing from
# an earlier run can leak into either patch.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="$here/base-tree"
work="$here/repo"
out="$here/tasks/match-void-rescore"

solution_files=(
  README.md
  docs/api.md
  docs/cli.md
  docs/cookbook.md
  docs/event-sourcing.md
  docs/handbook.md
  docs/reference.md
  docs/sdk.md
  src/api/routes/matches.ts
  src/cli/commands/index.ts
  src/cli/index.ts
  src/domain/matches/match.ts
  src/engine/corrections/index.ts
  src/engine/corrections/rescore.ts
  src/engine/corrections/void-match.ts
  src/engine/index.ts
  src/engine/reporting/report.ts
  src/engine/tournament/tournament-service.ts
  src/events/replay/projector.ts
  src/sdk/matches.ts
  tests/engine/corrections.test.ts
)

test_files=(
  tests/engine/withdrawn-results.test.ts
  tests/events/withdrawn-replay.test.ts
)

cd "$base"
# Markdown has no functions, and git's default hunk-header heuristic quotes the
# nearest unindented line above a hunk into the "@@ ... @@" text. Give .md files
# a driver whose xfuncname can never match so those headers stay bare.
printf '*.md diff=plainmd\n' > .gitattributes
git() { command git -c diff.plainmd.xfuncname='$^' "$@"; }
git reset -q --hard HEAD
git clean -fdq -e node_modules -e .gitattributes

for f in "${solution_files[@]}"; do
  mkdir -p "$(dirname "$f")"
  cp "$work/$f" "$f"
done
git add -A -- ':!.gitattributes'
git diff --cached > "$out/solution/solution.patch"
echo -n "solution: "
git diff --cached --numstat | awk '{a+=$1; r+=$2} END {printf "added=%d removed=%d churn=%d files=%d\n", a, r, a+r, NR}'
echo -n "  non-test: "
git diff --cached --numstat | awk '$3 !~ /\.test\.ts$/ {a+=$1; r+=$2; n+=1} END {printf "added=%d removed=%d churn=%d files=%d\n", a, r, a+r, n}'

git reset -q --hard HEAD
git clean -fdq -e node_modules -e .gitattributes
for f in "${test_files[@]}"; do
  mkdir -p "$(dirname "$f")"
  cp "$here/heldout/$(basename "$f")" "$f"
done
git add -A -- ':!.gitattributes'
git diff --cached > "$out/tests/test.patch"
echo -n "tests:    "
git diff --cached --numstat | awk '{a+=$1; r+=$2} END {printf "added=%d removed=%d files=%d\n", a, r, NR}'

git reset -q --hard HEAD
git clean -fdq -e node_modules -e .gitattributes
rm -f .gitattributes
