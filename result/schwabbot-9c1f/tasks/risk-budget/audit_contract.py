#!/usr/bin/env python3
"""Every name and literal the held-back cases touch must come from somewhere.

Either the base checkout already has it, or instruction.md names it. Anything
else is a contract the request never states, and a correct build with another
internal shape would fail on it.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parent.parent / "repo"
HELD_OUT = HERE / "held-out" / "tests"
INSTRUCTION = (HERE / "instruction.md").read_text()

BASE_TEXT = "\n".join(
    path.read_text(errors="replace")
    for path in BASE.rglob("*")
    if path.is_file() and path.suffix in {".py", ".html", ".js", ".json", ".txt", ".md", ".toml", ".cfg"}
)

# Names any python test file uses whatever the project is.
STDLIB = {
    "json", "datetime", "timezone", "self", "super", "print", "len", "sorted", "set",
    "list", "dict", "str", "int", "float", "bool", "range", "type", "object", "None",
    "True", "False", "Exception", "classmethod", "staticmethod", "property",
}


def names(tree: ast.AST) -> set[str]:
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            found.add(node.attr)
        elif isinstance(node, ast.Name):
            found.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            found.add(node.name)
        elif isinstance(node, ast.keyword) and node.arg:
            found.add(node.arg)
        elif isinstance(node, ast.alias):
            found.add(node.asname or node.name.rpartition(".")[2])
    return found


def literals(tree: ast.AST) -> set[str]:
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.add(node.value)
    return found


def defined_here(tree: ast.AST) -> set[str]:
    """Names the file makes up for itself: classes, helpers, locals, arguments."""
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            found.add(node.name)
            args = getattr(node, "args", None)
            if args is not None:
                for arg in list(args.args) + list(args.kwonlyargs):
                    found.add(arg.arg)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            found.add(node.id)
        elif isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store):
            found.add(node.attr)
    return found


def docstrings(tree: ast.AST) -> set[str]:
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            text = ast.get_docstring(node, clean=False)
            if text:
                found.add(text)
    return found


def known(token: str, local: set[str]) -> bool:
    if token in local or token in STDLIB:
        return True
    if token.startswith("test_") or token.startswith("assert") or token.startswith("_"):
        return True
    if token in INSTRUCTION:
        return True
    return token in BASE_TEXT


def main() -> int:
    problems = 0
    for path in sorted(HELD_OUT.glob("test_*.py")):
        tree = ast.parse(path.read_text())
        local = defined_here(tree) | docstrings(tree)
        unknown_names = sorted(token for token in names(tree) if not known(token, local))
        unknown_text = sorted(
            value for value in literals(tree)
            if value.strip() and len(value) > 2 and not known(value, local)
        )
        if unknown_names or unknown_text:
            problems += 1
            print(f"{path.name}:")
            for token in unknown_names:
                print(f"   name not in base or instruction: {token}")
            for value in unknown_text:
                print(f"   literal not in base or instruction: {value!r}")
        else:
            print(f"{path.name}: every name and literal traced")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
