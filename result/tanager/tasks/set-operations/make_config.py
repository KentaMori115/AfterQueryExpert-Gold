#!/usr/bin/env python3
"""Build tests/config.json from what the graded binaries themselves declare.

The id set is taken from `--list` rather than typed out, because a name that
drifts by one character publishes as a permanent failure and nothing else in
the pipeline would say why. Listing runs no test, so this reads the binary's
own table of contents.

Run against the work tree checked out on a branch that carries BOTH the
solution and the held-out suites, since the held-out targets do not compile at
the base commit and a target that does not compile lists nothing.
"""

import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE.parents[1] / "work"
BASE = "928c0b74375a634051b81bae1e4032c9e4c86ac7"

PKG = "tanager"
F2P = [(PKG, "branch_pairing"), (PKG, "bounded_branches")]
P2P = [
    (PKG, name)
    for name in (
        "aggregation",
        "ddl_and_dml",
        "determinism",
        "errors",
        "explain",
        "joins",
        "null_semantics",
        "optimizer_effects",
        "order_and_limit",
        "parser_api",
        "select_basic",
    )
]


def ids(package: str, target: str) -> list[str]:
    listing = subprocess.run(
        ["cargo", "test", "-q", "-p", package, "--test", target, "--offline", "--", "--list"],
        cwd=BUILD, capture_output=True, text=True, check=True,
    ).stdout
    names = [line[: -len(": test")] for line in listing.splitlines() if line.endswith(": test")]
    if not names:
        raise SystemExit(f"{package}/{target} listed no tests")
    return [f"{target}.{name}" for name in names]


def main() -> int:
    f2p = [node for package, target in F2P for node in ids(package, target)]
    p2p = [node for package, target in P2P for node in ids(package, target)]
    overlap = set(f2p) & set(p2p)
    if overlap:
        raise SystemExit(f"an id cannot be both f2p and p2p: {sorted(overlap)}")
    config = {
        "base_commit": BASE,
        "f2p_node_ids": sorted(f2p),
        "p2p_node_ids": sorted(p2p),
        "grade": {
            "format": "junit",
            "tool_label": "cargo",
            "reports": ["/logs/verifier/base.xml", "/logs/verifier/new.xml"],
        },
    }
    out = HERE / "tests" / "config.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(config, indent=1) + "\n")
    print(f"wrote {out.relative_to(HERE)}: {len(f2p)} f2p, {len(p2p)} p2p")
    return 0


if __name__ == "__main__":
    sys.exit(main())
