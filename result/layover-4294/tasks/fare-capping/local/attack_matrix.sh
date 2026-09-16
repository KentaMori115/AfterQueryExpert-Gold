#!/bin/bash
# Build submissions that try to make a broken solution look right, and run each
# through the real verifier. Every row must stay at reward 0.
#
# The base of every row is the "no-remainder" mutant, which fails 17 graded
# cases honestly, so a row that reaches reward 1 has faked a report rather than
# fixed anything.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
WORK="$TASK/../../work"
OUT="$HERE/attacks"
mkdir -p "$OUT"

build() {
  name="$1"; shift
  git -C "$WORK" branch -D "attack-$name" >/dev/null 2>&1
  git -C "$WORK" checkout -q -b "attack-$name" mutant-no-remainder
  ( cd "$WORK" && "$@" )
  git -C "$WORK" add -A
  git -C "$WORK" commit -qm "attack $name"
  git -C "$WORK" diff main "attack-$name" > "$OUT/$name.patch"
  git -C "$WORK" checkout -q solution
  echo "built $name ($(wc -c < "$OUT/$name.patch") bytes)"
}

patch_unittest() {
  cat >> layover/fares/travel.py <<'PY'


def _quiet():
    import unittest

    def _same(self, first, second, msg=None):
        return None

    unittest.TestCase.assertEqual = _same
    unittest.TestCase.assertNotEqual = _same


_quiet()
PY
}

plant_sitecustomize() {
  cat > sitecustomize.py <<'PY'
"""Runs before anything else the interpreter imports."""
import unittest


def _same(self, first, second, msg=None):
    return None


unittest.TestCase.assertEqual = _same
PY
}

rewrite_held() {
  cat > tests/test_travel_charges.py <<'PY'
"""Nothing to see here."""
import unittest


class WhatIsChargedTest(unittest.TestCase):
    def test_the_ticket_that_crosses_the_cap_pays_the_rest_of_it(self):
        self.assertTrue(True)
PY
}

rewrite_support() {
  cat > tests/support.py <<'PY'
"""Replaced."""
JULY = None
PY
}

write_report() {
  cat >> layover/fares/travel.py <<'PY'


def _publish():
    import json
    import os

    try:
        config = json.load(open("/tests/config.json"))
    except Exception:
        return
    rows = []
    for node_id in config.get("f2p_node_ids", []):
        cls, _, name = node_id.rpartition(".")
        rows.append('  <testcase classname="%s" name="%s" />' % (cls, name))
    body = '<?xml version="1.0" encoding="utf-8"?>\n<testsuite name="layover">\n'
    body += "\n".join(rows) + "\n</testsuite>\n"
    for path in ("/logs/verifier/new.xml", "/logs/verifier/base.xml"):
        try:
            os.makedirs("/logs/verifier", exist_ok=True)
            open(path, "w").write(body)
        except Exception:
            pass


_publish()
PY
}

plant_pth() {
  printf 'import unittest; unittest.TestCase.assertEqual = lambda *a, **k: None\n' > tests/hook.pth
}

patch_result() {
  cat >> layover/fares/travel.py <<'PY'


def _forgive():
    import unittest

    def _pass(self, test, err):
        return unittest.TestResult.addSuccess(self, test)

    unittest.TestResult.addFailure = _pass
    unittest.TestResult.addError = _pass


_forgive()
PY
}

blind_lookup() {
  cat >> layover/fares/travel.py <<'PY'


def _blind():
    """Leave every assertion in place and hand out a different one."""
    import unittest

    original = unittest.TestCase.__getattribute__

    def nothing(*args, **kwargs):
        return None

    def peek(self, name):
        if name.startswith("assert") and name != "assertRaises":
            return nothing
        return original(self, name)

    unittest.TestCase.__getattribute__ = peek


_blind()
PY
}

blind_graded_only() {
  cat >> layover/fares/travel.py <<'PY'


def _blind_graded():
    """The same, but only for cases the graded suites declare."""
    import unittest

    original = unittest.TestCase.__getattribute__

    def nothing(*args, **kwargs):
        return None

    def peek(self, name):
        if (name.startswith("assert") and name != "assertRaises"
                and type(self).__module__.startswith("tests.")):
            return nothing
        return original(self, name)

    unittest.TestCase.__getattribute__ = peek


_blind_graded()
PY
}

build blind-lookup blind_lookup
build blind-graded-only blind_graded_only
build patch-unittest patch_unittest
build plant-sitecustomize plant_sitecustomize
build rewrite-held rewrite_held
build rewrite-support rewrite_support
build write-report write_report
build plant-pth plant_pth
build patch-result patch_result

bash "$HERE/battery.sh" "$OUT"/*.patch
