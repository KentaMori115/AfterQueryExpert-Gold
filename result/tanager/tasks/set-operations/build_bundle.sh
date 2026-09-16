#!/bin/bash
# Rebuild every generated file from the work tree, in the order they depend on
# each other. The pinned digests in test.sh are taken from the same bytes
# test.patch installs, so the two must never be generated from different states
# of the tree; running this script is what keeps that true.
#
# The work tree carries four branches: main is the base commit, solution is the
# reference, heldout is the graded suite, and full is the merge of the two,
# which is the only one where a held-out target compiles and can therefore list
# its own case names.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(cd "$HERE/../../work" && pwd)"

git -C "$WORK" diff --quiet || { echo "work tree is dirty"; exit 1; }

mkdir -p "$HERE/solution" "$HERE/tests"
git -C "$WORK" diff main solution > "$HERE/solution/solution.patch"
# Every graded suite is in test.patch on purpose, the inherited ones included.
# grader.py's prepare resets every path the patch names back to the base commit
# before applying it, so a submission's edits to a graded suite are undone
# rather than graded, and an edit no longer has to be caught by a digest after
# the fact.
git -C "$WORK" diff main heldout -- tests > "$HERE/tests/test.patch"

git -C "$WORK" checkout -q full
python3 "$HERE/make_config.py"
git -C "$WORK" checkout -q heldout
python3 "$HERE/make_test_sh.py"

rm -rf "$HERE/bundle" && cp -r "$HERE/draft" "$HERE/bundle"
cp "$HERE/instruction.md" "$HERE/bundle/instruction.md"
cp "$HERE/solution/solution.patch" "$HERE/bundle/solution/solution.patch"
cp "$HERE/tests/test.patch" "$HERE/bundle/tests/test.patch"
cp "$HERE/tests/config.json" "$HERE/bundle/tests/config.json"
cp "$HERE/tests/test.sh" "$HERE/bundle/tests/test.sh"
python3 - <<'PY'
import pathlib
p = pathlib.Path('bundle/task.toml')
s = p.read_text()
s = s.replace('display_title = "<<EDIT-ME>> One-line title for this task"',
              'display_title = "Combine queries with UNION, INTERSECT and EXCEPT"')
s = s.replace('display_description = "<<EDIT-ME>> One or two sentences describing the change."',
              'display_description = "Add set operations over SELECT branches, in a deduplicating and an ALL spelling, with the trailing clauses governing the combined result. Limit pushdown learns to bound both branches of a concatenation by the limit plus the offset."')
p.write_text(s)
PY

# The pinned digests and the bytes test.patch installs have to be the same
# bytes. Applying the patch to a clean base tree and hashing the result is the
# only check that stays honest for a file the patch MODIFIES rather than
# creates: reconstructing one from its `+` lines gives the hunk, not the file.
# A mismatch reads as tampering at run time and fails every id, which is the
# most expensive way to discover a stale generation.
CHECK="$(mktemp -d)"
trap 'rm -rf "$CHECK"' EXIT
git -C "$WORK" archive main | tar -x -C "$CHECK"
( cd "$CHECK" && git init -q -b main && git -c user.name=c -c user.email=c@l add -A \
    && git -c user.name=c -c user.email=c@l commit -q -m base \
    && git apply --whitespace=nowarn "$HERE/bundle/tests/test.patch" )
cd "$HERE" && python3 check_pins.py "$CHECK"
echo "bundle rebuilt"
