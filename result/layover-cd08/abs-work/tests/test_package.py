"""The rules every module in the package keeps to.

These are the house rules: a docstring on everything public, a sorted ``__all__``
that names what exists, no doctests, no clock or randomness anywhere in the
engine, and a layering table that a new import cannot quietly cross.
"""

import ast
import importlib
import inspect
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGE = os.path.join(ROOT, "layover")

LAYERS = {
    "errors": 0,
    "times": 1,
    "dates": 1,
    "geo": 1,
    "money": 1,
    "services": 2,
    "network": 2,
    "fares": 2,
    "feed": 3,
    "timetable": 3,
    "plan": 4,
    "document": 4,
    "report": 5,
    "validate": 6,
    "demo": 7,
    "session": 8,
    "cli": 9,
    "__main__": 10,
    "__root__": 11,
}

FORBIDDEN = (
    "time.time(",
    "time.monotonic(",
    "datetime.now(",
    ".utcnow(",
    "date.today(",
    "import random",
    "os.environ",
    "getenv(",
    "uuid4(",
)


def source_files():
    """Every source file of the package, sorted."""
    found = []
    for directory, subdirectories, names in os.walk(PACKAGE):
        subdirectories[:] = [name for name in subdirectories if name != "__pycache__"]
        for name in sorted(names):
            if name.endswith(".py"):
                found.append(os.path.join(directory, name))
    return sorted(found)


def module_name(path):
    """The importable name of a source file."""
    relative = os.path.relpath(path, ROOT)
    name = relative[:-3].replace(os.sep, ".")
    if name.endswith(".__init__"):
        name = name[: -len(".__init__")]
    return name


def top_package(name):
    """Which layer a module belongs to."""
    parts = name.split(".")
    if len(parts) == 1:
        return "__root__"
    if parts[1] == "__main__":
        return "__main__"
    return parts[1]


def read(path):
    """The text of a source file."""
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


FILES = source_files()
MODULES = [module_name(path) for path in FILES]


class ShapeTest(unittest.TestCase):
    def test_there_are_plenty_of_modules(self):
        self.assertGreater(len(FILES), 40)

    def test_every_module_imports(self):
        for name in MODULES:
            with self.subTest(module=name):
                importlib.import_module(name)

    def test_every_module_has_a_docstring(self):
        for name in MODULES:
            with self.subTest(module=name):
                module = importlib.import_module(name)
                self.assertTrue((module.__doc__ or "").strip(), "%s has no docstring" % name)

    def test_every_docstring_starts_with_a_capital(self):
        for name in MODULES:
            with self.subTest(module=name):
                text = (importlib.import_module(name).__doc__ or "").strip()
                self.assertTrue(
                    text[:1].isupper() or text.startswith("layover"), "%s: %r" % (name, text[:20])
                )

    def test_every_module_declares_what_it_exports(self):
        for name in MODULES:
            with self.subTest(module=name):
                module = importlib.import_module(name)
                self.assertTrue(hasattr(module, "__all__"), "%s has no __all__" % name)

    def test_every_export_list_is_sorted(self):
        for name in MODULES:
            with self.subTest(module=name):
                names = list(importlib.import_module(name).__all__)
                self.assertEqual(names, sorted(names), "%s exports out of order" % name)

    def test_no_export_list_repeats_itself(self):
        for name in MODULES:
            with self.subTest(module=name):
                names = list(importlib.import_module(name).__all__)
                self.assertEqual(len(names), len(set(names)))

    def test_every_exported_name_exists(self):
        for name in MODULES:
            module = importlib.import_module(name)
            for exported in module.__all__:
                with self.subTest(module=name, exported=exported):
                    self.assertTrue(hasattr(module, exported))

    def test_every_public_class_has_a_docstring(self):
        for name in MODULES:
            module = importlib.import_module(name)
            for member_name, member in vars(module).items():
                if member_name.startswith("_") or not inspect.isclass(member):
                    continue
                if member.__module__ != name:
                    continue
                with self.subTest(module=name, member=member_name):
                    self.assertTrue((member.__doc__ or "").strip())

    def test_every_public_function_has_a_docstring(self):
        for name in MODULES:
            module = importlib.import_module(name)
            for member_name, member in vars(module).items():
                if member_name.startswith("_") or not inspect.isfunction(member):
                    continue
                if member.__module__ != name:
                    continue
                with self.subTest(module=name, member=member_name):
                    self.assertTrue((member.__doc__ or "").strip())

    def test_every_public_method_has_a_docstring(self):
        for name in MODULES:
            module = importlib.import_module(name)
            for member_name, member in vars(module).items():
                if member_name.startswith("_") or not inspect.isclass(member):
                    continue
                if member.__module__ != name:
                    continue
                for method_name, method in vars(member).items():
                    if method_name.startswith("_"):
                        continue
                    if not (inspect.isfunction(method) or isinstance(method, property)):
                        continue
                    doc = method.__doc__ if not isinstance(method, property) else method.fget.__doc__
                    with self.subTest(module=name, member=member_name, method=method_name):
                        self.assertTrue((doc or "").strip())


class SourceTest(unittest.TestCase):
    def test_no_doctests_anywhere(self):
        for path in FILES:
            with self.subTest(path=os.path.relpath(path, ROOT)):
                self.assertNotIn(">>>", read(path))

    def test_no_star_imports(self):
        for path in FILES:
            with self.subTest(path=os.path.relpath(path, ROOT)):
                self.assertNotIn("import *", read(path))

    def test_nothing_reads_a_clock_or_the_environment(self):
        for path in FILES:
            text = read(path)
            for forbidden in FORBIDDEN:
                with self.subTest(path=os.path.relpath(path, ROOT), forbidden=forbidden):
                    self.assertNotIn(forbidden, text)

    def test_every_file_ends_with_a_newline(self):
        for path in FILES:
            with self.subTest(path=os.path.relpath(path, ROOT)):
                self.assertTrue(read(path).endswith("\n"))

    def test_no_tab_indentation(self):
        for path in FILES:
            with self.subTest(path=os.path.relpath(path, ROOT)):
                self.assertNotIn("\t", read(path))

    def test_no_line_is_absurdly_long(self):
        for path in FILES:
            for number, line in enumerate(read(path).splitlines(), start=1):
                if len(line) > 110:
                    self.fail("%s:%d is %d characters" % (path, number, len(line)))

    def test_every_module_uses_future_annotations(self):
        for path in FILES:
            if os.path.basename(path) == "__init__.py" and os.path.getsize(path) < 200:
                continue
            with self.subTest(path=os.path.relpath(path, ROOT)):
                self.assertIn("from __future__ import annotations", read(path))


class LayeringTest(unittest.TestCase):
    def imports_of(self, path):
        """Which packages a source file imports from inside layover."""
        found = set()
        for node in ast.walk(ast.parse(read(path))):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("layover"):
                found.add(top_package(node.module))
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("layover"):
                        found.add(top_package(alias.name))
        return found

    def test_every_package_is_in_the_table(self):
        for name in MODULES:
            with self.subTest(module=name):
                self.assertIn(top_package(name), LAYERS)

    def test_nothing_imports_across_or_up_a_layer(self):
        for path in FILES:
            owner = top_package(module_name(path))
            for imported in self.imports_of(path):
                if imported == owner:
                    continue
                with self.subTest(path=os.path.relpath(path, ROOT), imported=imported):
                    self.assertLess(
                        LAYERS[imported],
                        LAYERS[owner],
                        "%s imports %s, which is not below it" % (owner, imported),
                    )

    def test_the_errors_module_imports_nothing_of_ours(self):
        self.assertEqual(self.imports_of(os.path.join(PACKAGE, "errors.py")), set())

    def test_the_layer_numbers_are_distinct_enough(self):
        self.assertEqual(LAYERS["errors"], 0)
        self.assertGreater(LAYERS["cli"], LAYERS["session"])


class TestSuiteTest(unittest.TestCase):
    def test_every_test_module_has_a_docstring(self):
        directory = os.path.join(ROOT, "tests")
        for name in sorted(os.listdir(directory)):
            if not name.endswith(".py"):
                continue
            with self.subTest(name=name):
                module = importlib.import_module("tests.%s" % name[:-3])
                self.assertTrue((module.__doc__ or "").strip())

    def test_there_is_a_test_module_for_every_package(self):
        names = set(os.listdir(os.path.join(ROOT, "tests")))
        for package in ("network", "feed", "plan", "report", "validate", "document"):
            with self.subTest(package=package):
                self.assertTrue(
                    any(name.startswith("test_%s" % package) for name in names),
                    "nothing tests %s" % package,
                )


if __name__ == "__main__":
    unittest.main()
