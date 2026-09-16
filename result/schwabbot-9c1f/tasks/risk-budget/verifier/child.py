"""Run one Django selection and stream a verdict per case.

Started by publish.py with the report's file descriptor and the dotted module
labels to run. Reads the run token from stdin before /app is importable, takes
an identity snapshot of unittest and django.test while only the interpreter's
own installation is on sys.path, and rechecks it at every verdict and at the
end. A run that altered the framework sends no END, and the publisher then
publishes every declared id as failed.
"""

import os
import sys


def decides(value):
    """Whether an attribute can change what the framework does.

    Read with `type`, never `isinstance`: django hands out lazy proxies whose
    `__class__` builds the settings, which is not something a snapshot may do.
    """
    try:
        return callable(value) or type(value) in (property, classmethod, staticmethod)
    except Exception:
        return False


def framework_modules():
    """Loaded modules whose decisions the verdicts rest on: unittest, whose
    assertions the cases are written against, and the django.test classes the
    cases inherit from."""
    watched = ("django.test", "django.test.testcases", "django.test.client",
               "django.test.runner")
    # unittest.signals only holds the ctrl-c handler the runner installs while
    # a suite runs, which decides nothing about a verdict.
    ignored = ("unittest.signals",)
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None or name in ignored:
            continue
        if name == "unittest" or name.startswith("unittest."):
            found[name] = mod
        elif name in watched:
            found[name] = mod
    return found


def framework_origin():
    """Watched modules that came from the tree under test rather than from the
    interpreter's own installation."""
    strays = []
    for name, mod in framework_modules().items():
        origin = getattr(mod, "__file__", None) or ""
        if origin.startswith("/app"):
            strays.append(name)
    return sorted(strays)


def snapshot_framework():
    """Every decision point of every watched module, and of every class they
    define, held by reference so identity can be rechecked."""
    modules = {}
    classes = {}
    for name, mod in framework_modules().items():
        attrs = {k: v for k, v in vars(mod).items() if decides(v)}
        modules[name] = (mod, attrs)
        for key, value in attrs.items():
            if type(value) is not type:
                continue
            if getattr(value, "__module__", None) != name:
                continue
            members = {k: v for k, v in vars(value).items() if decides(v)}
            classes[(name, key)] = (value, members)
    return modules, classes


def framework_drift(guard):
    """Every decision point that is not the object it was, or was added."""
    modules, classes = guard
    drift = set()
    for name, (mod, attrs) in modules.items():
        if sys.modules.get(name) is not mod:
            drift.add(("swap", name))
        live = vars(mod)
        for key, value in attrs.items():
            if key not in live or live[key] is not value:
                drift.add(("mod", name, key, type(live.get(key)).__name__))
        for key, value in live.items():
            if key not in attrs and decides(value):
                drift.add(("mod", name, key, type(value).__name__))
    for (name, key), (cls, members) in classes.items():
        live = vars(cls)
        for member, value in members.items():
            if member not in live or live[member] is not value:
                drift.add(("cls", name, key, member, type(live.get(member)).__name__))
        for member, value in live.items():
            if member not in members and decides(value):
                drift.add(("cls", name, key, member, type(value).__name__))
    return drift


def load_package(name, folder):
    """Import a package from an exact folder under /app.

    Not by name: the interpreter's own site-packages ships a top level
    `tests` package, and /app is deliberately last on sys.path, so a plain
    import would load that one instead of the repository's.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        name,
        os.path.join(folder, "__init__.py"),
        submodule_search_locations=[folder],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_module(rel_path):
    """Import /app/<rel_path> under the dotted name its path spells."""
    import importlib
    import importlib.util

    name = rel_path[:-3].replace("/", ".") if rel_path.endswith(".py") else rel_path
    if name in sys.modules:
        # Nothing has loaded a graded module yet, so something under /app put
        # this here during startup, hoping to be graded in its place.
        print("[runner] %s was registered before it was loaded" % name, flush=True)
        os._exit(3)
    package, _, _leaf = name.rpartition(".")
    if package and package not in sys.modules:
        folder = os.path.join("/app", package.replace(".", "/"))
        if os.path.exists(os.path.join(folder, "__init__.py")):
            load_package(package, folder)
        else:
            importlib.import_module(package)
    spec = importlib.util.spec_from_file_location(name, os.path.join("/app", rel_path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    rel_paths = sys.argv[2:]
    # Bound now, before anything under /app can run: rebinding os.write or
    # os.getpid later changes nothing here, and a forked copy never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()

    import unittest  # noqa: F401
    import unittest.case  # noqa: F401
    import unittest.loader  # noqa: F401
    import unittest.result  # noqa: F401
    import unittest.runner  # noqa: F401
    import unittest.suite  # noqa: F401
    import unittest.util  # noqa: F401
    import django  # noqa: F401
    import django.test  # noqa: F401
    import django.test.client  # noqa: F401
    import django.test.runner  # noqa: F401
    import django.test.testcases  # noqa: F401
    from django.test.runner import DiscoverRunner

    print("[runner] django resolved from", django.__file__, flush=True)
    if framework_origin():
        print("[runner] framework loaded from /app: %s" % framework_origin(), flush=True)
        os._exit(3)
    guard = snapshot_framework()

    state = {"n": 0, "tampered": False, "live": False, "allowed": set()}

    class Recorder(unittest.TextTestResult):
        """A verdict per finished case, on the descriptor the publisher owns."""

        def report(self, test, outcome):
            if getpid() != owner or not state["live"]:
                return
            if framework_drift(guard) - state["allowed"]:
                state["tampered"] = True
                return
            case_id = test.id()
            cls, _, name = case_id.rpartition(".")
            line = "V %s %s %s\x1f%s\n" % (token, outcome, cls, name)
            write(fd, line.encode())
            state["n"] += 1

        def addSuccess(self, test):
            super().addSuccess(test)
            self.report(test, "passed")

        def addError(self, test, err):
            super().addError(test, err)
            self.report(test, "failed")

        def addFailure(self, test, err):
            super().addFailure(test, err)
            self.report(test, "failed")

        def addSubTest(self, test, subtest, err):
            super().addSubTest(test, subtest, err)
            if err is not None:
                self.report(test, "failed")

        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            self.report(test, "skipped")

        def addExpectedFailure(self, test, err):
            super().addExpectedFailure(test, err)
            self.report(test, "failed")

        def addUnexpectedSuccess(self, test):
            super().addUnexpectedSuccess(test)
            self.report(test, "failed")

    class Runner(DiscoverRunner):
        def get_resultclass(self):
            return Recorder

    # What the framework does to itself during a run, measured on a suite that
    # holds nothing from /app. Only drift beyond this is treated as tampering.
    calibration = Runner(verbosity=0, interactive=False, keepdb=False, parallel=1)

    class Calibration(unittest.TestCase):
        def test_passes(self):
            self.assertEqual(1, 1)

        def test_fails(self):
            self.assertEqual([1], [2])

        def test_raises(self):
            with self.assertRaises(ValueError):
                int("x")

    calibration.run_suite(unittest.TestLoader().loadTestsFromTestCase(Calibration))
    state["allowed"] = framework_drift(guard)
    print("[runner] framework guard: %d self-changes allowed" % len(state["allowed"]), flush=True)

    # /app goes on last, so django, unittest and the standard library always
    # resolve from the interpreter's own installation.
    sys.path.append("/app")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "SchwabOptionBot.settings")
    django.setup()
    drift = framework_drift(guard) - state["allowed"]
    if drift:
        print("[runner] framework altered while the project loaded: %s" % sorted(drift)[:8], flush=True)
        print("[runner] no END will be sent", flush=True)
        os._exit(3)

    runner = Runner(verbosity=1, interactive=False, keepdb=False, parallel=1)
    runner.setup_test_environment()
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    graded_paths = set()
    for rel_path in rel_paths:
        graded_paths.add(os.path.join("/app", rel_path))
        suite.addTests(loader.loadTestsFromModule(load_module(rel_path)))

    # Every case that will run has to be code from the pinned files themselves,
    # not something of the same name assembled elsewhere.
    for case in suite:
        for test in case if isinstance(case, unittest.TestSuite) else [case]:
            method = getattr(test, getattr(test, "_testMethodName", ""), None)
            origin = getattr(getattr(method, "__code__", None), "co_filename", None)
            if origin not in graded_paths:
                print("[runner] %s comes from %s, not from a graded file"
                      % (test.id(), origin), flush=True)
                os._exit(3)
    old_config = runner.setup_databases()
    state["live"] = True
    try:
        runner.run_suite(suite)
    finally:
        try:
            runner.teardown_databases(old_config)
            runner.teardown_test_environment()
        except Exception:
            pass

    if getpid() != owner:
        os._exit(0)
    drift = framework_drift(guard) - state["allowed"]
    if framework_origin():
        print("[runner] framework replaced from /app: %s" % framework_origin(), flush=True)
        os._exit(3)
    if state["tampered"] or drift:
        print("[runner] framework tampered with: %s" % sorted(drift)[:8], flush=True)
        print("[runner] no END will be sent", flush=True)
        os._exit(3)
    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    sys.exit(0)


main()
