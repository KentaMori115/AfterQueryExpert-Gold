"""Write tests/config.json: the declared id set, taken from the binaries.

Names are read with `--list`, which runs no test, so the set is what each test
binary actually declares rather than what a run happened to print. The id shape
is the one grader.py derives for a junit report, `classname.name`, and the
converter in test.sh writes the target name as the classname.

Only targets under tests/ are graded. Unit tests inside src/** live in files a
solution edits, so they can be neither reset from base nor trusted, and doctest
ids carry a line number that any edit above them moves.
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1] / "repo"
OUT = HERE / "tests" / "config.json"
BASE = "928c0b74375a634051b81bae1e4032c9e4c86ac7"

F2P_TARGETS = ["join_forms", "join_using"]
P2P_TARGETS = [
    "joins",
    "multi_join",
    "optimizer_effects",
    "explain",
    "select_basic",
    "order_and_limit",
    "aggregation",
    "null_semantics",
    "errors",
    "ddl_and_dml",
]

LISTED = re.compile(r"^(\S+): test$", re.M)


def names(target: str) -> list[str]:
    proc = subprocess.run(
        ["cargo", "test", "--offline", "--locked", "--test", target, "--", "--list"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(f"listing {target} failed:\n{proc.stderr}", file=sys.stderr)
        raise SystemExit(1)
    found = LISTED.findall(proc.stdout)
    if not found:
        print(f"{target} declared no tests", file=sys.stderr)
        raise SystemExit(1)
    return sorted(found)


def ids(targets: list[str]) -> list[str]:
    out = []
    for target in targets:
        out.extend(f"{target}.{name}" for name in names(target))
    return out


def main() -> int:
    f2p = ids(F2P_TARGETS)
    p2p = ids(P2P_TARGETS)
    overlap = set(f2p) & set(p2p)
    if overlap:
        print(f"an id is in both buckets: {sorted(overlap)}", file=sys.stderr)
        return 1
    config = {
        "base_commit": BASE,
        "f2p_node_ids": f2p,
        "p2p_node_ids": p2p,
        "grade": {
            "format": "junit",
            "tool_label": "cargo-test",
            "reports": ["/logs/verifier/base.xml", "/logs/verifier/new.xml"],
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(config, indent=1) + "\n")
    print(f"wrote {OUT.name}: {len(f2p)} f2p over {len(F2P_TARGETS)} targets, "
          f"{len(p2p)} p2p over {len(P2P_TARGETS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
