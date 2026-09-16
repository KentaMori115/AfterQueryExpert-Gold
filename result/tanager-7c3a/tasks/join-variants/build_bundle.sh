#!/bin/bash
# Rebuild every generated file from the work tree, in the order they depend on
# each other. The pinned digests in test.sh are taken from the same bytes
# test.patch installs, so the two must never be generated from different states
# of the tree; running this script is what keeps that true.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../repo" && pwd)"
cd "$HERE/build"

# Bring both branches up to the work tree before anything is generated. The
# patches, the pinned digests and the declared ids are all derived from these
# branches, so a branch left behind the work tree ships a bundle that disagrees
# with the suite that was actually run.
sync_branch() {
  local branch="$1"; shift
  git checkout -q "$branch"
  for spec in "$@"; do
    cp -a "$REPO/$spec" "$(dirname "$spec")/"
  done
  git add -A
  git diff --cached --quiet || git -c user.name=ref -c user.email=ref@local commit -q -m "sync $branch"
}
sync_branch solution src/.
sync_branch tests tests/join_forms.rs tests/join_using.rs
git checkout -q main

git diff main solution > "$HERE/solution/solution.patch"
# Only the two held-back files. The inherited suites are NOT in test.patch:
# they are unchanged from base, so a diff would be empty and name no path for
# grader.py to reset. test.sh checks them out from the base commit instead.
git diff main tests -- tests/join_forms.rs tests/join_using.rs > "$HERE/tests/test.patch"

cd "$HERE"
python3 make_config.py
python3 make_test_sh.py

rm -rf bundle && cp -r draft bundle
rm -f bundle/task.json
cp instruction.md bundle/instruction.md
cp solution/solution.patch bundle/solution/solution.patch
cp tests/test.patch bundle/tests/test.patch
cp tests/config.json bundle/tests/config.json
cp tests/test.sh bundle/tests/test.sh
python3 - <<'PY'
import pathlib
p = pathlib.Path('bundle/task.toml')
s = p.read_text()
s = s.replace('display_title = "<<EDIT-ME>> One-line title for this task"',
              'display_title = "Join the rest of the family: RIGHT, FULL, CROSS and USING"')
s = s.replace('display_description = "<<EDIT-ME>> One or two sentences describing the change."',
              'display_description = "Extend the join grammar past INNER and LEFT with RIGHT, FULL OUTER and CROSS joins, and add a USING constraint whose named columns collapse to one output column each."')
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
git -C "$HERE/build" archive main | tar -x -C "$CHECK"
( cd "$CHECK" && git init -q -b main && git -c user.name=c -c user.email=c@l add -A \
    && git -c user.name=c -c user.email=c@l commit -q -m base \
    && git apply --whitespace=nowarn "$HERE/bundle/tests/test.patch" )
python3 check_pins.py "$CHECK"
echo "bundle rebuilt"
