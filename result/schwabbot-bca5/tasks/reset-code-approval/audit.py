#!/usr/bin/env python3
"""What the graded suite reaches for, and where it is allowed to come from.

Every attribute, import and string literal the held-back tests touch has to
be something the base checkout already has, or something instruction.md
names. Anything else is a contract the request never states, so a correct
build with different internals would fail it.

    ./audit.py
"""

import ast
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent / "repo"
HELDOUT = sorted((HERE / "heldout").glob("*.py"))
INSTRUCTION = (HERE / "instruction.md").read_text()

BASE_SOURCE = "\n".join(
    p.read_text(errors="replace")
    for p in REPO.rglob("*.py")
)
BASE_SOURCE += "\n".join(
    p.read_text(errors="replace") for p in REPO.rglob("*.html")
)

# Names the standard library, Django and the test file itself provide.
IGNORE_PREFIX = (
    "assert", "test_", "self", "_", "setUp", "tearDown",
)
KNOWN = {
    "TestCase", "SimpleTestCase", "Client", "User", "timezone", "timedelta",
    "datetime", "json", "pytz", "utc", "localize", "astimezone", "hour",
    "objects", "create", "create_user", "get", "filter", "count", "id",
    "check_password", "refresh_from_db", "post", "force_login", "is_valid",
    "status_code", "rpartition", "date", "weekday", "strftime", "now",
    "update", "delete", "first", "all", "exists", "read_text", "items",
    "append", "keys", "values", "split", "join", "str", "int", "len",
    "range", "print", "set", "list", "dict", "tuple", "sorted", "min", "max",
}


def defined_here(tree):
    """Names the test file gives itself: helpers, fixtures, constants."""
    own = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            own.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            own.add(node.id)
        elif isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store):
            own.add(node.attr)
    return own


def own_literals(tree, own):
    """Values the test file makes up: passwords, usernames, codes."""
    made_up = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            if isinstance(node.value.value, str):
                made_up.add(node.value.value)
    return made_up


def touched_names(path):
    tree = ast.parse(path.read_text())
    attrs, imports, strings = set(), set(), set()
    own = defined_here(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            if node.attr not in own:
                attrs.add(node.attr)
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                imports.add((node.module or "", alias.name))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(("", alias.name))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            strings.add(node.value)
    return attrs, imports, strings - own_literals(tree, own)


def known(name):
    if name in KNOWN or name.startswith(IGNORE_PREFIX):
        return True
    if re.search(r"\b%s\b" % re.escape(name), BASE_SOURCE):
        return "base"
    if re.search(r"\b%s\b" % re.escape(name), INSTRUCTION):
        return "instruction"
    return False


def main():
    problems = []
    for path in HELDOUT:
        attrs, imports, strings = touched_names(path)
        for name in sorted(attrs):
            if known(name) is False:
                problems.append("%s: attribute %r" % (path.name, name))
        for module, name in sorted(imports):
            for part in list(filter(None, module.split("."))) + [name]:
                if known(part) is False:
                    problems.append("%s: import %s.%s" % (path.name, module, name))
        for text in sorted(strings):
            stripped = text.strip()
            # Only two kinds of literal can be a contract on the build: a URL
            # the suite drives, and a form field it posts. Fixture values the
            # suite invents are its own business.
            if stripped.startswith("/"):
                for segment in [s for s in stripped.split("/") if s]:
                    if known(segment) is False:
                        problems.append("%s: url segment %r in %r"
                                        % (path.name, segment, text))
            elif re.fullmatch(r"[a-z][a-z0-9_]*", stripped) and len(stripped) > 3:
                if known(stripped) is False:
                    problems.append("%s: name %r" % (path.name, stripped))
    if problems:
        print("\n".join(problems))
        print("\n%d unexplained references" % len(problems))
        return 1
    print("every name and literal the held-back suite touches is in the base "
          "checkout or named in instruction.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
