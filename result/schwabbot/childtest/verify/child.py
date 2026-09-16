import os
import sys


def decides(value):
    """Whether an attribute can change what the framework does."""
    try:
        return callable(value) or isinstance(
            value, (property, classmethod, staticmethod))
    except Exception:
        return False


def framework_modules():
    """Every loaded module of the frameworks the verdicts rest on.

    ``unittest`` runs the cases and owns every assertion the graded suites
    make, and ``django.test`` owns the case classes they are written against.
    """
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name in ("unittest", "django.test") or name.startswith(
                ("unittest.", "django.test.")):
            found[name] = mod
    return found


def snapshot_framework():
    modules = {}
    classes = {}
    for name, mod in framework_modules().items():
        attrs = {k: v for k, v in vars(mod).items() if decides(v)}
        modules[name] = (mod, attrs)
        for key, value in attrs.items():
            if isinstance(value, type) and getattr(value, "__module__", None) == name:
                members = {k: v for k, v in vars(value).items() if decides(v)}
                classes[(name, key)] = (value, members)
    return modules, classes


def framework_drift(guard):
    modules, classes = guard
    drift = set()
    for name, (mod, attrs) in modules.items():
        if sys.modules.get(name) is not mod:
            drift.add(("swap", name))
            continue
        live = vars(mod)
        for key, value in attrs.items():
            if key not in live or live[key] is not value:
                drift.add(("mod", name, key))
        for key, value in live.items():
            if key not in attrs and decides(value):
                drift.add(("mod", name, key))
    for (name, key), (cls, members) in classes.items():
        live = vars(cls)
        for member, value in members.items():
            if member not in live or live[member] is not value:
                drift.add(("cls", name, key, member))
        for member, value in live.items():
            if member not in members and decides(value):
                drift.add(("cls", name, key, member))
    return drift


def bind_repo_tests_package():
    """Make ``tests`` mean the repository's own package and nothing else.

    A dependency in this image ships a top level ``tests`` package of its own,
    and /app is appended to the path rather than prepended, so the dotted name
    would otherwise resolve into site-packages.  Binding the repository's
    package under the name first settles it for every later import, and the
    graded ids keep the ``tests.<module>.<Class>.<method>`` shape the grading
    configuration declares.
    """
    import importlib.util

    path = "/app/tests/__init__.py"
    if not os.path.exists(path):
        return
    spec = importlib.util.spec_from_file_location(
        "tests", path, submodule_search_locations=["/app/tests"])
    module = importlib.util.module_from_spec(spec)
    sys.modules["tests"] = module
    spec.loader.exec_module(module)


def module_name(path):
    relative = path[len("/app/"):] if path.startswith("/app/") else path
    if relative.endswith(".py"):
        relative = relative[:-3]
    return relative.replace("/", ".")


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    sources = sys.argv[2:]

    # Bound before anything under /app can run.  Rebinding os.write later
    # changes nothing here, and a forked copy of this process never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()

    # /app goes on the path LAST, so the interpreter's own unittest and the
    # installed django always win over anything committed in the tree.
    sys.path.append("/app")

    import unittest
    import unittest.case  # noqa: F401
    import unittest.loader  # noqa: F401
    import unittest.mock  # noqa: F401
    import unittest.result  # noqa: F401
    import unittest.runner  # noqa: F401
    import unittest.suite  # noqa: F401
    import unittest.util  # noqa: F401
    import django
    import django.test  # noqa: F401
    import django.test.runner  # noqa: F401
    import django.test.testcases  # noqa: F401
    import django.test.utils  # noqa: F401

    print("[runner] unittest from", unittest.__file__, flush=True)
    print("[runner] django", django.get_version(), "from", django.__file__, flush=True)

    guard = snapshot_framework()
    points = (sum(len(a) for _, a in guard[0].values())
              + sum(len(m) for _, m in guard[1].values()))
    if framework_drift(guard):
        print("[runner] framework did not settle before the run", flush=True)
        os._exit(3)
    print("[runner] framework guard: %d decision points" % points, flush=True)

    # Everything below imports and runs code from /app.
    django.setup()
    from django.test.runner import DiscoverRunner
    from django.test.utils import setup_test_environment, teardown_test_environment

    setup_test_environment()
    runner = DiscoverRunner(verbosity=0, interactive=False)
    old_config = runner.setup_databases()

    bind_repo_tests_package()

    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for source in sources:
        name = module_name(source)
        try:
            suite.addTests(loader.loadTestsFromName(name))
        except Exception as exc:
            print("[runner] could not load %s: %s" % (name, exc), flush=True)

    state = {"n": 0, "tampered": False}

    def report(test, outcome):
        if getpid() != owner:
            return
        if framework_drift(guard):
            state["tampered"] = True
            return
        node_id = test.id()
        classname, _, name = node_id.rpartition(".")
        line = "V %s %s %s\x1f%s\n" % (token, outcome, classname, name)
        write(fd, line.encode())
        state["n"] += 1

    class Recorder(unittest.TestResult):
        def addSuccess(self, test):
            unittest.TestResult.addSuccess(self, test)
            report(test, "passed")

        def addFailure(self, test, err):
            unittest.TestResult.addFailure(self, test, err)
            report(test, "failed")

        def addError(self, test, err):
            unittest.TestResult.addError(self, test, err)
            report(test, "failed")

        def addSkip(self, test, reason):
            unittest.TestResult.addSkip(self, test, reason)
            report(test, "skipped")

        def addExpectedFailure(self, test, err):
            unittest.TestResult.addExpectedFailure(self, test, err)
            report(test, "failed")

        def addUnexpectedSuccess(self, test):
            unittest.TestResult.addUnexpectedSuccess(self, test)
            report(test, "failed")

        def addSubTest(self, test, subtest, err):
            unittest.TestResult.addSubTest(self, test, subtest, err)
            if err is not None:
                report(test, "failed")

    result = Recorder()
    suite.run(result)

    for failed, trace in list(result.failures) + list(result.errors):
        print("[runner] %s\n%s" % (failed, trace), flush=True)

    try:
        runner.teardown_databases(old_config)
        teardown_test_environment()
    except Exception:
        pass

    if getpid() != owner:
        os._exit(0)
    if state["tampered"] or framework_drift(guard):
        print("[runner] framework moved during the run; no END will be sent", flush=True)
        os._exit(3)

    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    print("[runner] emitted %d verdict(s)" % state["n"], flush=True)


main()
