#!/usr/bin/env python3
"""Confirm test.sh pins exactly what test.patch installs.

Takes a directory holding the base tree with test.patch already applied, and
hashes every path the patch names. A file the patch MODIFIES cannot be checked
by rebuilding it from its `+` lines, which give the hunk rather than the file,
so the patch is applied for real and the result is what gets hashed.
"""

import hashlib
import pathlib
import re
import sys

check = pathlib.Path(sys.argv[1])
script = pathlib.Path("bundle/tests/test.sh").read_text()
patch = pathlib.Path("bundle/tests/test.patch").read_text()
paths = sorted(set(re.findall(r"^\+\+\+ b/(.+)$", patch, re.M)))
bad = 0
for rel in paths:
    digest = hashlib.sha256((check / rel).read_bytes()).hexdigest()
    if digest not in script:
        print(f"MISMATCH {rel}: test.patch installs {digest}, test.sh pins something else")
        bad += 1
if bad:
    raise SystemExit(1)
print(f"pins agree with test.patch for {len(paths)} graded files")
