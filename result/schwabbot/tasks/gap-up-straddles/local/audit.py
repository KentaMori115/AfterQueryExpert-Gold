#!/usr/bin/env python3
"""Bidirectional audit of the graded suites against the request.

Four questions, asked mechanically because asking them by eye has been wrong
before:

1. every name the graded suites touch is either in the base checkout or named
   by instruction.md;
2. every string literal they compare against is likewise;
3. every graded case is reachable from a sentence of the request;
4. the request names nothing the graded suites leave unchecked.

Three and four still need a person for the wording, so the script prints the
two lists side by side rather than guessing.
"""

import ast
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
WORK = TASK.parent.parent / "work"
BASE = TASK.parent.parent / "repo"
HELD = ["tests/test_wind_down.py", "tests/test_paper_targets.py"]

INSTRUCTION = (TASK / "instruction.md").read_text()

# Python's own vocabulary, and the test framework's, are not contracts.
BUILTIN = set(dir(__builtins__)) | set(dir(ast)) | {
    'self', 'setUp', 'assertEqual', 'assertNotEqual', 'assertTrue',
    'assertFalse', 'assertIsNone', 'assertIsNotNone', 'assertIn', 'assertNotIn',
    'SimpleTestCase', 'TestCase', 'django', 'test', 'keys', 'items', 'values',
    'append', 'update', 'clear', 'range', 'sorted', 'len', 'set', 'list',
    'dict', 'str', 'int', 'float', 'bool', 'None', 'True', 'False', 'offline',
    'Engine', 'straddle', '__init__', 'format', 'get', 'pop', 'split', 'join',
    'startswith', 'endswith', 'strip',
}


def base_text():
    chunks = []
    for path in sorted(BASE.rglob("*.py")):
        chunks.append(path.read_text(errors="replace"))
    for path in sorted(BASE.glob("*.txt")):
        chunks.append(path.read_text(errors="replace"))
    return "\n".join(chunks)


def held_source(path):
    return subprocess.run(
        ["git", "-C", str(WORK), "show", "heldout:%s" % path],
        check=True, capture_output=True, text=True,
    ).stdout


def main():
    corpus = base_text()
    unknown_names = []
    unknown_strings = []
    cases = []

    for path in HELD:
        tree = ast.parse(held_source(path))
        module = "tests." + path.split("/")[-1][:-3]
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for item in node.body:
                    if isinstance(item, ast.FunctionDef) and item.name.startswith("test"):
                        cases.append("%s.%s.%s" % (module, node.name, item.name))
            if isinstance(node, ast.Attribute):
                if node.attr not in BUILTIN and node.attr not in corpus \
                        and node.attr not in INSTRUCTION:
                    unknown_names.append((path, node.attr))
            if isinstance(node, ast.Name):
                if node.id not in BUILTIN and node.id not in corpus \
                        and node.id not in INSTRUCTION:
                    unknown_names.append((path, node.id))
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                text = node.value
                if not text or text.startswith("\n") or len(text) > 90:
                    continue
                if text not in corpus and text not in INSTRUCTION:
                    unknown_strings.append((path, text))

    print("graded cases: %d" % len(cases))
    print()
    print("names the base checkout and the request both leave unmentioned:")
    for row in sorted(set(unknown_names)):
        print("   %s  %s" % row)
    if not unknown_names:
        print("   (none)")
    print()
    print("strings the base checkout and the request both leave unmentioned:")
    for row in sorted(set(unknown_strings)):
        print("   %s  %r" % row)
    if not unknown_strings:
        print("   (none)")
    print()
    print("request sentences:")
    for sentence in INSTRUCTION.replace("\n", " ").split(". "):
        sentence = sentence.strip()
        if sentence:
            print("   - %s" % sentence)
    return 1 if (unknown_names or unknown_strings) else 0


if __name__ == "__main__":
    sys.exit(main())
