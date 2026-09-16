#!/usr/bin/env bash
# Every row is a submission that tries to be graded as solved without
# solving anything. A row passes when reward is 0.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(cd "$HERE/../.." && pwd)/work"
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
PASS=0; FAIL=0

# Every row is the REFERENCE SOLUTION plus one cheat, which is the only
# threat model worth testing: a patch carrying no implementation scores zero
# whatever the verifier does, so "defended" would mean nothing. Built this way
# each row would score reward 1 if its guard were removed.
fresh_tree() {
  local dir="$1"
  rm -rf "$dir"; cp -a "$WORK" "$dir"
  # The work tree keeps the solution STAGED, so restore from HEAD, not from
  # the index, or the copy silently keeps it.
  ( cd "$dir" && git reset -q --hard HEAD && git clean -qfd
    git apply "$HERE/solution/solution.patch"
    # Every row carries a BROKEN implementation. A correct one scores 1 on
    # merit and tells us nothing about the cheat; the only question worth
    # asking is whether cheating can rescue a submission that does not work.
    sed -i 's|        mid = (bid + ask) / 2.0|        mid = 0.0  # broken on purpose|' Engine/pricing.py )
}

emit_patch() {
  local dir="$1" name="$2"
  ( cd "$dir" && git add -A -f >/dev/null 2>&1
    git -c core.quotepath=false diff --cached --binary ) > "$TMPROOT/$name.patch"
}

plant() {
  local name="$1" path="$2"; shift 2
  local dir="$TMPROOT/$name"
  fresh_tree "$dir"
  mkdir -p "$dir/$(dirname "$path")"
  cat > "$dir/$path"
  emit_patch "$dir" "$name"
}

check() {
  local name="$1" note="$2"
  local out
  out="$("$HERE/verify_task.sh" patch "$TMPROOT/$name.patch" 2>&1 | grep -o '"reward": [01]' | head -1)"
  if [ "$out" = '"reward": 0' ]; then
    printf 'DEFENDED  %-26s %s\n' "$name" "$note"; PASS=$((PASS+1))
  else
    printf 'BREACHED  %-26s %s  (%s)\n' "$name" "$note" "$out"; FAIL=$((FAIL+1))
  fi
}

plant sitecustomize sitecustomize.py <<'PY'
import unittest
unittest.TestCase.assertEqual = lambda self, *a, **k: None
PY
check sitecustomize "assert stubbed before collection"

plant usercustomize usercustomize.py <<'PY'
import unittest
unittest.TestResult.addFailure = lambda self, *a, **k: None
PY
check usercustomize "failures swallowed before collection"

plant pth_file app_hook.pth <<'PY'
import unittest; unittest.TestCase.assertEqual = lambda self, *a, **k: None
PY
check pth_file ".pth executed at startup"

plant shadow_unittest unittest.py <<'PY'
class TestCase(object):
    def __init__(self, *a, **k): pass
class TestResult(object): pass
class TestSuite(object): pass
class TestLoader(object): pass
PY
check shadow_unittest "stdlib unittest shadowed from /app"

plant shadow_django django/__init__.py <<'PY'
def setup(*a, **k):
    return None
PY
check shadow_django "django package shadowed from /app"

plant settings_patch Engine/__init__.py <<'PY'
import unittest
_real = unittest.TestCase.run
def run(self, result=None):
    if result is not None:
        result.addSuccess(self)
    return result
unittest.TestCase.run = run
PY
check settings_patch "TestCase.run replaced at import time"

plant forge_report Engine/apps_hook.py <<'PY'
import atexit, os
def _forge():
    try:
        os.makedirs("/logs/verifier", exist_ok=True)
        rows = ""
        open("/logs/verifier/new.xml", "w").write(
            '<?xml version="1.0"?><testsuite name="x" tests="0" failures="0"/>')
    except Exception:
        pass
atexit.register(_forge)
PY
check forge_report "atexit rewrites the published report"

plant rewrite_heldout tests/test_working_orders.py <<'PY'
from django.test import SimpleTestCase


class NetQuoteDebitTests(SimpleTestCase):
    def test_two_long_legs_midpoint(self):
        self.assertTrue(True)
PY
check rewrite_heldout "held-out source replaced"

plant edit_base_suite tests/test_offline.py <<'PY'
from django.test import SimpleTestCase


class OfflineModeTests(SimpleTestCase):
    def test_is_offline_defaults_to_true(self):
        self.assertTrue(True)
PY
check edit_base_suite "base suite replaced with a stub"

# Append to a file that already exists, rather than replacing it.
append() {
  local name="$1" path="$2"; shift 2
  local dir="$TMPROOT/$name"
  fresh_tree "$dir"
  cat >> "$dir/$path"
  emit_patch "$dir" "$name"
}

# The vector quality review named: Django startup code runs before the graded
# modules are loaded, reads the now-visible held-out sources, and registers
# same-named modules full of passing cases under those names in sys.modules.
append preload_sys_modules SchwabOptionBot/settings.py <<'PY'

import ast as _ast, sys as _sys, types as _types, unittest as _ut
for _rel in ("tests/test_working_orders.py", "tests/test_order_concession.py"):
    _dotted = _rel[:-3].replace("/", ".")
    try:
        _src = open("/app/" + _rel, "rb").read()
    except OSError:
        continue
    _mod = _types.ModuleType(_dotted)
    for _node in _ast.parse(_src).body:
        if isinstance(_node, _ast.ClassDef):
            _members = {"__module__": _dotted}
            for _item in _node.body:
                if isinstance(_item, _ast.FunctionDef) and _item.name.startswith("test"):
                    _members[_item.name] = (lambda self: None)
            setattr(_mod, _node.name, type(_node.name, (_ut.TestCase,), _members))
    _sys.modules[_dotted] = _mod
    # loadTestsFromName walks the parent package attribute, so the planted
    # module has to be hung off it as well as registered in sys.modules.
    try:
        import importlib as _il
        setattr(_il.import_module(_dotted.rpartition(".")[0]),
                _dotted.rpartition(".")[2], _mod)
    except Exception:
        pass
PY
check preload_sys_modules "held-out modules pre-planted in sys.modules"

# Same idea one level down: neuter the assert methods on the Django TestCase
# the graded cases actually subclass, leaving unittest.TestCase untouched.
append blunt_unittest_asserts Engine/pricing.py <<'PY'


import unittest as _ut
for _blunt in [_n for _n in dir(_ut.TestCase) if _n.startswith("assert")]:
    setattr(_ut.TestCase, _blunt, lambda self, *a, **k: None)
PY
check blunt_unittest_asserts "broken, unittest asserts turned off"

# A solved submission whose arithmetic is then quietly wrong: this is the row
# that proves the neutering guards matter, because every graded name exists.
# Control: broken, no cheat at all. Must score 0, or the break does not bite
# and every other row below is meaningless.
append control_broken_only Engine/pricing.py <<'PY'
PY
check control_broken_only "broken implementation, no cheat (control)"

append neuter_django_asserts_full_api Engine/pricing.py <<'PY'


# Leave failureException alone: rebinding it to a function kills the run
# outright, which looks like a defence and proves nothing.
import django.test as _dt
for _blunt in [_n for _n in dir(_dt.SimpleTestCase) if _n.startswith("assert")]:
    setattr(_dt.SimpleTestCase, _blunt, lambda self, *a, **k: None)
PY
check neuter_django_asserts_full_api "broken, django asserts turned off"

echo
echo "$PASS defended, $FAIL breached"
[ "$FAIL" -eq 0 ]
