"""Run one selection of Django tests and stream a verdict per case.

The suite imports everything under /app before a single case runs, so the
framework that decides what a case reports must not come from there. The
interpreter starts isolated, imports unittest and django.test while /app is
still off sys.path, takes an identity snapshot of every decision point in
both, and only then makes the project importable. The snapshot is rechecked
at every verdict and once more at the end; a run that moved any of it sends
no END line and the publisher fails every declared id.

django.setup() has to run repository code before any test module can be
imported, so an import hook installed there could rewrite the graded modules
on their way in without touching a single guarded object. The graded sources
are therefore read and compiled up front, while the interpreter is still
clean, and the modules are built from those code objects afterwards. The
loader finds them already in sys.modules and never consults the import
machinery for them at all.

Verdicts leave on an inherited descriptor, never on stdout, so nothing a
suite prints can be mistaken for one, and the token that stamps them is read
from stdin before /app exists on the path.
"""

import os
import sys
import types


APP = "/app"


def decides(value):
    """Whether an attribute can change what the framework does.

    Functions, classes and descriptors decide; plain data does not, and both
    unittest and django.test legitimately write module level data while they
    run. The test reads the value's type rather than the value, because
    django.test holds lazy proxies that would go and import settings the
    moment anything asks them what they are, and settings live under /app.
    """
    try:
        if type(value) in (property, classmethod, staticmethod):
            return True
        return callable(value)
    except Exception:
        return False


def guarded_modules():
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name == "unittest" or name.startswith("unittest."):
            found[name] = mod
        elif name == "django.test" or name.startswith("django.test."):
            found[name] = mod
    return found


def import_machinery():
    """The finders and path hooks in force, in order, held by reference."""
    return tuple(sys.meta_path), tuple(sys.path_hooks)


def snapshot():
    """Every decision point of the loaded framework, held by reference."""
    modules = {}
    classes = {}
    for name, mod in guarded_modules().items():
        attrs = {k: v for k, v in vars(mod).items() if decides(v)}
        modules[name] = (mod, attrs)
        for key, value in attrs.items():
            if isinstance(value, type) and getattr(value, "__module__", None) == name:
                members = {k: v for k, v in vars(value).items() if decides(v)}
                classes[(name, key)] = (value, members)
    return modules, classes, import_machinery()


def drift(guard):
    """Decision points that are no longer the objects they were, or are new."""
    modules, classes, machinery = guard
    moved = set()
    if import_machinery() != machinery:
        moved.add(("import-machinery",))
    for name, (mod, attrs) in modules.items():
        if sys.modules.get(name) is not mod:
            moved.add(("swap", name))
        live = vars(mod)
        for key, value in attrs.items():
            if key not in live or live[key] is not value:
                moved.add(("mod", name, key))
        for key, value in live.items():
            if key not in attrs and decides(value):
                moved.add(("mod", name, key))
    for (name, key), (cls, members) in classes.items():
        live = vars(cls)
        for member, value in members.items():
            if member not in live or live[member] is not value:
                moved.add(("cls", name, key, member))
        for member, value in live.items():
            if member not in members and decides(value):
                moved.add(("cls", name, key, member))
    return moved


def import_framework():
    """Load unittest and django.test with /app nowhere on the path."""
    sys.path[:] = [p for p in sys.path if p and not p.startswith(APP)]
    import unittest  # noqa: F401
    import unittest.case  # noqa: F401
    import unittest.loader  # noqa: F401
    import unittest.result  # noqa: F401
    import unittest.runner  # noqa: F401
    import unittest.suite  # noqa: F401
    import django
    import django.test  # noqa: F401
    import django.test.client  # noqa: F401
    import django.test.runner  # noqa: F401
    import django.test.testcases  # noqa: F401
    import django.test.utils  # noqa: F401
    if django.__file__.startswith(APP):
        print("[runner] django resolved from the tree under test", flush=True)
        os._exit(3)
    print("[runner] django %s from %s" % (django.get_version(), django.__file__), flush=True)
    return django


def precompile(labels):
    """Read and compile every graded module before anything from /app runs.

    A code object cannot be rewritten by an import hook that appears later,
    so this is the only moment the graded sources can be taken at their word:
    the interpreter has run nothing from the tree under test yet, builtins are
    the interpreter's own, and sys.meta_path is untouched.
    """
    packages = []
    units = []
    seen = set()
    for dotted in labels:
        package = dotted.rpartition(".")[0]
        if package == "tests" and package not in seen:
            seen.add(package)
            init = os.path.join(APP, "tests", "__init__.py")
            with open(init, "rb") as handle:
                packages.append((package, init, compile(handle.read(), init, "exec")))
        path = os.path.join(APP, dotted.replace(".", "/") + ".py")
        with open(path, "rb") as handle:
            units.append((dotted, path, compile(handle.read(), path, "exec")))
    return packages, units


def install(packages, units):
    """Build the graded modules from the code compiled up front.

    They go straight into sys.modules, so the loader finds them there and the
    import machinery is never asked to produce them. The Users package is the
    real one django.setup() built and is left alone; only its tests module is
    supplied from here.
    """
    for name, path, code in packages:
        module = types.ModuleType(name)
        module.__file__ = path
        module.__path__ = [os.path.dirname(path)]
        module.__package__ = name
        sys.modules[name] = module
        exec(code, module.__dict__)
    for dotted, path, code in units:
        package, _, leaf = dotted.rpartition(".")
        module = types.ModuleType(dotted)
        module.__file__ = path
        module.__package__ = package
        sys.modules[dotted] = module
        exec(code, module.__dict__)
        parent = sys.modules.get(package)
        if parent is not None:
            setattr(parent, leaf, module)


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    labels = sys.argv[2:]
    # Bound before anything under /app can run. Rebinding os.write later
    # changes nothing here, and a forked copy of this process never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()

    django = import_framework()
    import unittest
    from django.test.runner import DiscoverRunner
    from django.test.utils import setup_test_environment, teardown_test_environment

    graded = precompile(labels)
    guard = snapshot()
    baseline = len(guard[0]) + len(guard[1])
    print("[runner] framework guard over %d modules and classes, %d graded "
          "modules compiled up front"
          % (baseline, len(graded[0]) + len(graded[1])), flush=True)

    # Only now is the project importable. It goes on the front, the way
    # manage.py puts it there, because one of the installed dependencies
    # ships a top level "tests" package that would otherwise answer for the
    # repository's own. Nothing the framework needs can be shadowed by that:
    # unittest and django.test are already imported, already in sys.modules,
    # and every decision point in them is under the guard taken above.
    sys.path.insert(0, APP)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "SchwabOptionBot.settings")
    django.setup()
    install(*graded)

    state = {"n": 0, "tampered": False}

    class Streamer(unittest.TestResult):
        """One verdict per case, worst outcome wins within a case."""

        def __init__(self):
            super().__init__()
            self.current = None

        def startTest(self, test):
            super().startTest(test)
            self.current = "passed"

        def addError(self, test, err):
            super().addError(test, err)
            self.current = "failed"

        def addFailure(self, test, err):
            super().addFailure(test, err)
            self.current = "failed"

        def addSubTest(self, test, subtest, err):
            super().addSubTest(test, subtest, err)
            if err is not None:
                self.current = "failed"

        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            if self.current == "passed":
                self.current = "skipped"

        def addExpectedFailure(self, test, err):
            super().addExpectedFailure(test, err)
            self.current = "failed"

        def addUnexpectedSuccess(self, test):
            super().addUnexpectedSuccess(test)
            self.current = "failed"

        def stopTest(self, test):
            super().stopTest(test)
            if getpid() != owner:
                return
            if drift(guard):
                state["tampered"] = True
                self.current = None
                return
            outcome = self.current or "failed"
            self.current = None
            node = test.id()
            head, _, name = node.rpartition(".")
            line = "V %s %s %s\x1f%s\n" % (token, outcome, head, name)
            write(fd, line.encode())
            state["n"] += 1

    runner = DiscoverRunner(verbosity=0, interactive=False, parallel=1, keepdb=False)
    setup_test_environment()
    suite = runner.build_suite(labels)
    old_config = runner.setup_databases()
    result = Streamer()
    try:
        suite.run(result)
    finally:
        runner.teardown_databases(old_config)
        teardown_test_environment()

    if getpid() != owner:
        os._exit(0)
    if state["tampered"] or drift(guard):
        print("[runner] framework was altered during the run", flush=True)
        os._exit(3)
    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    sys.exit(0)


main()
