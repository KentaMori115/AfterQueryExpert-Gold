#!/usr/bin/env python3
"""Build tests/config.json from real JUnit reports, never by hand.

Runs the repository suite on the base tree and the held-out suite on the
solved tree (both inside the published-image rebuild, so the ids are the
ones the verifier will see), derives every node id from the XML, pins the
held-out files and the files that steer the graded runs, and writes the
config the shared grader reads.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE / "work"
IMAGE = "cueforge-env:v1"
BASE_COMMIT = "474ce0944456bafbaa719a5e2304d56eaeccd768"

HELD = [
    "tests/locations/test_json_locations.py",
    "tests/locations/test_workspace_and_cli.py",
    "tests/locations/test_yaml_aliases.py",
    "tests/locations/test_yaml_locations.py",
]
P2P_FILES = sorted(
    str(p.relative_to(WORK / "base"))
    for p in (WORK / "base" / "tests").rglob("test_*.py")
)
PROTECTED_ABSENT = [
    "conftest.py", "pytest.py", "pytest.ini", "tox.ini", "setup.cfg",
    "sitecustomize.py", "usercustomize.py", "tests/conftest.py",
    "tests/locations/conftest.py",
]


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def junit_ids(tree: pathlib.Path, files: list[str]) -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "report.xml"
        cmd = [
            "docker", "run", "--rm", "--network", "none",
            "-v", f"{tree}:/app:ro", "-v", f"{tmp}:/out", "-w", "/app",
            IMAGE, "python", "-I", "-c",
            "import sys; sys.path[:0] = ['/app/src', '/app']; import pytest; "
            "sys.exit(pytest.main(['-p', 'no:cacheprovider', '-o', 'addopts=', "
            "'--noconftest', '-q', '--junitxml', '/out/report.xml'] + sys.argv[1:]))",
            *files,
        ]
        subprocess.run(cmd, check=False, capture_output=True)
        ids = []
        for case in ET.parse(out).iter("testcase"):
            ids.append(f"{case.get('classname')}.{case.get('name')}")
        return ids


def main() -> int:
    base, solved = WORK / "base", WORK / "dev"
    p2p = junit_ids(base, P2P_FILES)
    f2p = junit_ids(solved, HELD)
    assert len(set(p2p)) == len(p2p) and len(set(f2p)) == len(f2p), "duplicate ids"
    assert not set(p2p) & set(f2p), "f2p/p2p overlap"
    frozen = {}
    for rel in P2P_FILES + ["pyproject.toml"]:
        frozen[rel] = sha256(base / rel)
    for extra in ("test_lab", "examples"):
        for p in sorted((base / extra).rglob("*")):
            if p.is_file():
                frozen[str(p.relative_to(base))] = sha256(p)
    held = {rel: sha256(solved / rel) for rel in HELD}
    config = {
        "base_commit": BASE_COMMIT,
        "f2p_node_ids": sorted(f2p),
        "p2p_node_ids": sorted(p2p),
        "held_out_files": held,
        "frozen_files": dict(sorted(frozen.items())),
        "protected_absent": PROTECTED_ABSENT,
        "grade": {
            "format": "junit",
            "tool_label": "pytest-junitxml",
            "reports": ["/logs/verifier/base.xml", "/logs/verifier/new.xml"],
        },
    }
    (HERE / "tests" / "config.json").write_text(json.dumps(config, indent=1) + "\n")
    print(f"f2p {len(f2p)}  p2p {len(p2p)}  frozen {len(frozen)}  held {len(held)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
