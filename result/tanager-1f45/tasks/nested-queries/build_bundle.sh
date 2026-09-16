#!/bin/bash
# Rebuild every generated file from the work tree, in the order they depend on
# each other. The pinned digests in test.sh are taken from the same bytes
# test.patch installs, so the two must never be generated from different states
# of the tree; running this script is what keeps that true.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/build"

git add -A
git diff --cached --quiet || git -c user.name=ref -c user.email=ref@local commit -q -m "work"

git diff main solution > "$HERE/solution/solution.patch"
# Only the held-back files are installed by the patch. The inherited suites are
# unchanged from the base commit, so a patch cannot carry them; what protects
# them is the content pin in test.sh, which fails every id if one moves.
git diff main heldout -- tests/nested_reads.rs tests/enclosing_scope.rs \
                        tests/select_basic.rs tests/null_semantics.rs \
                        tests/order_and_limit.rs tests/aggregation.rs \
                        tests/expressions.rs tests/joins.rs \
                        tests/determinism.rs tests/optimizer_effects.rs \
                        tests/explain.rs > "$HERE/tests/test.patch"
cd "$HERE"
python3 make_config.py
python3 make_test_sh.py

rm -rf bundle && cp -r draft bundle
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
              'display_title = "Let a query read another query"')
s = s.replace('display_description = "<<EDIT-ME>> One or two sentences describing the change."',
              'display_description = "Support a parenthesized SELECT as a value, EXISTS, and IN over a query, including one that reads a column of the query enclosing it."')
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
