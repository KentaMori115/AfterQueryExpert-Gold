#!/bin/bash
# Rebuild solution/solution.patch and tests/test.patch from the two trees.
#
# repo-base/ is the snapshot as it arrived and repo/ is that tree with the work
# on top, so the diff between them is the change under review. The held-out
# suite goes in its own patch and out of the solution's.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$HERE/../../repo-base"
WORK_TREE="$HERE/../../repo"
SCRATCH="${SCRATCH:-/tmp/claude-0/-root-mindriftwork/74ab2514-8fb8-483c-afc5-91a24c0597bd/scratchpad/patches}"
HELD=("__tests__/partial-content.test.ts" "__tests__/byte-serving.test.ts")

rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/tree"
tar --warning=no-timestamp -cf - -C "$BASE" . | tar --warning=no-timestamp -x -C "$SCRATCH/tree"
git -C "$SCRATCH/tree" init -q
git -C "$SCRATCH/tree" add -A
git -C "$SCRATCH/tree" -c user.email=b@local -c user.name=base commit -qm base

tar --warning=no-timestamp --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude="*.tsbuildinfo" \
    -cf - -C "$WORK_TREE" . | tar --warning=no-timestamp -x -C "$SCRATCH/tree"

git -C "$SCRATCH/tree" add -A
excludes=()
for held in "${HELD[@]}"; do excludes+=(":(exclude)$held"); done
git -C "$SCRATCH/tree" diff --cached --binary -- . "${excludes[@]}" > "$HERE/solution/solution.patch"
git -C "$SCRATCH/tree" diff --cached --binary -- "${HELD[@]}" > "$HERE/tests/test.patch"

added() { grep -c '^+' "$1" | cat; }
echo "solution.patch $(wc -l < "$HERE/solution/solution.patch") lines, files: $(grep -c '^+++ ' "$HERE/solution/solution.patch")"
echo "test.patch     $(wc -l < "$HERE/tests/test.patch") lines, files: $(grep -c '^+++ ' "$HERE/tests/test.patch")"
