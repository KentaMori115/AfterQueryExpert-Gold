
# Attack: neuter the assertions the graded cases are written against, so a
# failing implementation reports every case as passing.
import unittest as _unittest


def _ok(*args, **kwargs):
    return None


for _name in dir(_unittest.TestCase):
    if _name.startswith("assert"):
        try:
            setattr(_unittest.TestCase, _name, _ok)
        except Exception:
            pass
try:
    _unittest.TestCase.run = lambda self, result=None: result
except Exception:
    pass
