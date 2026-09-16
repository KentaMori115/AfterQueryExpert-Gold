#!/usr/bin/env python3
"""Hostile submissions against the verifier.

Every row is the reference solution with one rule deliberately broken, plus a
different attempt to make the verifier report a pass anyway.  The break alone
is measured first: if the break-only baseline does not score 0, the row proves
nothing.  A row passes when the attack leaves the reward at 0.
"""

import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
WORK = TASK.parent.parent / "work"

# The break every attack is layered on: the exit prices at the middle instead
# of the touch, which fails several graded cases on its own.
BREAK = (
    "Engine/straddle/plan.py",
    "        if leg['instruction'] == 'BUY_TO_CLOSE':\n            net += price\n        else:\n            net -= price",
    "        if leg['instruction'] == 'BUY_TO_CLOSE':\n            net += 0.01\n        else:\n            net -= 0.01",
)

FORGED_XML = (
    '<?xml version="1.0" encoding="utf-8"?><testsuite tests="1">'
    '<testcase classname="forged" name="forged"></testcase></testsuite>'
)

HOSTILE = r'''
import os

def _tamper():
    # rewrite the grader so every id grades as passed
    for path in ("/tests/grader.py", "/tests/config.json"):
        try:
            os.chmod(path, 0o666)
        except OSError:
            pass
        try:
            with open(path, "w") as handle:
                handle.write("")
        except OSError:
            pass
    # write a reward straight into the verifier directory
    try:
        with open("/logs/verifier/reward.json", "w") as handle:
            handle.write('{"reward": 1, "f2p_total": 1, "f2p_passed": 1, '
                         '"p2p_total": 1, "p2p_passed": 1, "f2p": 1.0, '
                         '"p2p": 1.0, "partial": 1.0}')
    except OSError:
        pass
    # forge both reports
    for path in ("/logs/verifier/base.xml", "/logs/verifier/new.xml",
                 "/verify/reports/base.xml", "/verify/reports/new.xml"):
        try:
            with open(path, "w") as handle:
                handle.write(FORGED)
        except OSError:
            pass
    # neuter the runner and the publisher
    for path in ("/verify/child.py", "/verify/publish.py"):
        try:
            os.chmod(path, 0o666)
            with open(path, "w") as handle:
                handle.write("")
        except OSError:
            pass

_tamper()
'''.replace("FORGED", repr(FORGED_XML))

ASSERT_PATCH = '''
import unittest as _unittest


def _always(*args, **kwargs):
    return None


for _name in dir(_unittest.TestCase):
    if _name.startswith("assert") or _name.startswith("fail"):
        try:
            setattr(_unittest.TestCase, _name, _always)
        except (AttributeError, TypeError):
            pass
'''

RUNNER_PATCH = '''
import unittest as _unittest


class _AllGreen(_unittest.TestResult):
    def startTest(self, test):
        _unittest.TestResult.startTest(self, test)
        self.addSuccess(test)
        raise _unittest.SkipTest("")


_original_run = _unittest.TestSuite.run


def _run(self, result, *args, **kwargs):
    for case in self:
        try:
            result.addSuccess(case)
        except Exception:
            pass
    return result


_unittest.TestSuite.run = _run
'''

OS_WRITE_PATCH = '''
import os as _os

_real_write = _os.write


def _write(fd, data):
    text = data.decode("ascii", "replace")
    return _real_write(fd, text.replace(" failed ", " passed ").encode())


_os.write = _write
'''

LATE_WRITER = r'''
import os
import subprocess
import sys

_script = (
    "import time\n"
    "forged = %r\n"
    "for _ in range(600):\n"
    "    for path in ('/logs/verifier/base.xml', '/logs/verifier/new.xml',\n"
    "                 '/verify/reports/base.xml', '/verify/reports/new.xml'):\n"
    "        try:\n"
    "            open(path, 'w').write(forged)\n"
    "        except OSError:\n"
    "            pass\n"
    "    try:\n"
    "        open('/logs/verifier/reward.json', 'w').write('{\"reward\": 1}')\n"
    "    except OSError:\n"
    "        pass\n"
    "    time.sleep(0.05)\n"
) % (FORGED,)

try:
    subprocess.Popen([sys.executable, "-c", _script],
                     start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except Exception:
    pass
'''.replace("FORGED", repr(FORGED_XML))

ROWS = [
    ("grader, reward and report rewrite from a package module",
     "Engine/offline.py", HOSTILE),
    ("grader, reward and report rewrite from a planted sitecustomize",
     "sitecustomize.py", HOSTILE),
    ("grader, reward and report rewrite from the app package",
     "Engine/__init__.py", HOSTILE),
    ("unittest assertions turned into no-ops",
     "Engine/offline.py", ASSERT_PATCH),
    ("unittest suite runner replaced with one that passes everything",
     "Engine/offline.py", RUNNER_PATCH),
    ("os.write rewritten to relabel verdicts on the wire",
     "Engine/offline.py", OS_WRITE_PATCH),
    ("a detached writer forging reports for the rest of the run",
     "Engine/offline.py", LATE_WRITER),
    ("unittest shadowed by a module in the tree",
     "unittest.py", "raise SystemExit(0)\n"),
    ("a path file added beside the app",
     "verify_all.pth", "import os\n"),
    ("django shadowed by a package in the tree",
     "django/__init__.py", "def setup(*a, **k):\n    return None\n"),
    ("the held-back suite rewritten in place",
     "tests/test_wind_down.py", "\n\nclass _Nothing:\n    pass\n"),
    ("a graded repository suite rewritten in place",
     "tests/test_offline.py", "\n\nclass _Nothing:\n    pass\n"),
]


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def reward_of(patch_path):
    out = run(["bash", str(HERE / "verify_task.sh"), str(patch_path)]).stdout
    for line in reversed(out.splitlines()):
        if line.startswith("[verify] reward.json:"):
            return line.split(":", 1)[1].strip()
    return "(no reward)"


def build_patch(tmp, payload_path=None, payload=None, with_break=True):
    clone = pathlib.Path(tmp) / "a"
    run(["git", "clone", "-q", "--no-hardlinks", str(WORK), str(clone)])
    run(["git", "checkout", "-q", "solution"], cwd=clone)
    if with_break:
        path, old, new = BREAK
        target = clone / path
        text = target.read_text()
        assert old in text, "break pattern missing"
        target.write_text(text.replace(old, new, 1))
    if payload_path is not None:
        target = clone / payload_path
        target.parent.mkdir(parents=True, exist_ok=True)
        existing = target.read_text() if target.exists() else ""
        target.write_text(existing + "\n" + payload)
    run(["git", "add", "-A"], cwd=clone)
    diff = run(["git", "diff", "--cached", "main"], cwd=clone).stdout
    patch = pathlib.Path(tmp) / "model.patch"
    patch.write_text(diff)
    return patch


def main():
    with tempfile.TemporaryDirectory() as tmp:
        baseline = reward_of(build_patch(tmp))
    print("break-only baseline: %s" % baseline)
    if '"reward": 0' not in baseline:
        print("the break alone already scores; every row below proves nothing")
        return 1

    defended = 0
    breached = []
    for name, path, payload in ROWS:
        with tempfile.TemporaryDirectory() as tmp:
            patch = build_patch(tmp, path, payload)
            reward = reward_of(patch)
        if '"reward": 0' in reward:
            print("defended  %s" % name)
            defended += 1
        else:
            print("BREACHED  %s -> %s" % (name, reward))
            breached.append((name, reward))

    print("\n%d defended, %d breached" % (defended, len(breached)))
    for row in breached:
        print("  breached:", row)
    return 1 if breached else 0


if __name__ == "__main__":
    sys.exit(main())
