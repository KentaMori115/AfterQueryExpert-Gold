#!/usr/bin/env python3
"""Every name, attribute and literal a graded assertion touches must be
either in the base checkout or named by instruction.md.

Anything else is a contract the request never states, so a correct build with
a different internal shape would fail it. Docstrings are skipped; they are
prose, not a pin.
"""
import ast
import json
import pathlib
import re
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parents[1] / "work"
BASE = HERE.parents[1] / "repo"
INSTRUCTION = (HERE / "instruction.md").read_text()
HELD = ["tests/test_working_orders.py", "tests/test_order_concession.py"]
FRAMEWORK = set(dir(unittest.TestCase)) | {"SimpleTestCase", "TestCase"}
SYMBOL = re.compile(r"XSP\s+\d{6}[CP]\d{8}")


def docstrings(tree):
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                             ast.AsyncFunctionDef)):
            text = ast.get_docstring(node, clean=False)
            if text:
                out.add(text)
    return out


def json_strings(root):
    """Every string a base JSON file carries, key or value.

    Settings and fixtures are part of the base checkout just as much as the
    code is, so a literal a test takes from one of them is not invented.
    """
    found = set()

    def walk(node):
        if isinstance(node, str):
            found.add(node)
        elif isinstance(node, dict):
            for key, value in node.items():
                found.add(key)
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for path in root.rglob("*.json"):
        try:
            walk(json.loads(path.read_text()))
        except (ValueError, OSError):
            continue
    return found


def collect(root):
    names, strings = set(), set()
    for path in root.rglob("*.py"):
        try:
            tree = ast.parse(path.read_bytes())
        except SyntaxError:
            continue
        docs = docstrings(tree)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                names.add(node.id)
            elif isinstance(node, ast.arg):
                names.add(node.arg)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    names.add(alias.asname or alias.name.split(".")[0])
                    names.add(alias.name)
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                if node.value not in docs:
                    strings.add(node.value)
    return names, strings


def main():
    base_names, base_strings = collect(BASE)
    base_strings |= json_strings(BASE)
    problems = []
    for rel in HELD:
        tree = ast.parse((WORK / rel).read_bytes())
        docs = docstrings(tree)
        local = {n.name for n in ast.walk(tree)
                 if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        local |= {n.id for n in ast.walk(tree)
                  if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
        local |= {n.arg for n in ast.walk(tree) if isinstance(n, ast.arg)}
        # attributes the test file assigns on itself are its own fixtures,
        # not a contract it pins on the solution
        local |= {n.attr for n in ast.walk(tree)
                  if isinstance(n, ast.Attribute) and isinstance(n.ctx, ast.Store)}
        known = FRAMEWORK | base_names | local
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                if node.attr not in known and node.attr not in INSTRUCTION:
                    problems.append(f"{rel}: attribute .{node.attr}")
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if (alias.name not in INSTRUCTION and alias.name not in base_names
                            and alias.name not in FRAMEWORK):
                        problems.append(f"{rel}: imports {alias.name}")
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                text = node.value
                if text in docs or text in base_strings or text in INSTRUCTION:
                    continue
                if SYMBOL.fullmatch(text) or text.isdigit():
                    # option symbols come from the fixtures, and a bare
                    # numeral is test input rather than a name being pinned
                    continue
                problems.append(f"{rel}: string {text!r}")
    if problems:
        print("PROBLEMS:")
        for line in sorted(set(problems)):
            print(" -", line)
        return 1
    print("clean: the graded suite pins nothing the request does not name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
