#!/usr/bin/env python3
"""Rebuild tests/config.json from the sources the verifier actually grades.

Ids are derived the same way the runner and the publisher derive them, by
walking the AST of each source file, so the three can never drift apart.
"""
import ast
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parents[1] / "work"
BASE_COMMIT = "7bc88a1c75c331045b5714ee4a411e0321efc5a1"

P2P_SOURCES = [
    "tests/test_offline.py",
    "tests/test_schwab_api.py",
    "tests/test_server_api.py",
    "tests/test_user_allow.py",
    "Users/tests.py",
]
F2P_SOURCES = [
    "tests/test_working_orders.py",
    "tests/test_order_concession.py",
]


def module_of(rel):
    return rel[:-3].replace("/", ".")


def declared(rel):
    found = []
    tree = ast.parse((WORK / rel).read_bytes())
    module = module_of(rel)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if item.name.startswith("test"):
                        found.append(f"{module}.{node.name}.{item.name}")
    return found


def main():
    p2p, f2p = [], []
    for rel in P2P_SOURCES:
        p2p.extend(declared(rel))
    for rel in F2P_SOURCES:
        f2p.extend(declared(rel))
    if len(set(p2p)) != len(p2p) or len(set(f2p)) != len(f2p):
        print("duplicate node id", file=sys.stderr)
        return 1
    if set(p2p) & set(f2p):
        print("an id is in both buckets", file=sys.stderr)
        return 1
    config = {
        "base_commit": BASE_COMMIT,
        "f2p_node_ids": sorted(f2p),
        "p2p_node_ids": sorted(p2p),
        "grade": {
            "format": "junit",
            "tool_label": "django-unittest",
            "reports": ["/logs/verifier/base.xml", "/logs/verifier/new.xml"],
        },
    }
    out = HERE / "tests" / "config.json"
    out.write_text(json.dumps(config, indent=1) + "\n")
    print(f"wrote {out}: {len(f2p)} f2p, {len(p2p)} p2p")
    return 0


if __name__ == "__main__":
    sys.exit(main())
