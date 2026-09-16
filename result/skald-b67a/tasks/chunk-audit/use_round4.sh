#!/bin/bash
# Swap in the sharpened request and drop the one case whose rule it no longer
# carries. Held ready rather than applied: the pipeline was still running when
# it was written, and a push cancels a run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
cp instruction.round4.md instruction.md
python3 - <<'PY'
import pathlib
p = pathlib.Path('build/tests/image_faults.rs')
s = p.read_text()
old = """#[test]
fn a_jump_onto_the_end_of_the_body_is_accepted() {
    // Falling off the end returns from the frame, so it is a place to land.
    let code = body(&[jump(OP_JMP, 1), vec![OP_NOP]]);
    assert!(flaws(&entry(code)).is_empty());
}

"""
assert old in s, "case already gone"
p.write_text(s.replace(old, ""))
PY
cd build
git add -A
git -c user.name=ref -c user.email=ref@local commit -q -m "tests: drop the body-length case"
git checkout -q heldout
git checkout both -- tests/image_faults.rs
git add -A
git -c user.name=ref -c user.email=ref@local commit -q -m "tests: drop the body-length case"
git checkout -q both
cd "$HERE"
bash build_bundle.sh
echo "round 4 bundle ready"
