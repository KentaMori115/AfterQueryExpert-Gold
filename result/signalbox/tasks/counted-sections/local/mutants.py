#!/usr/bin/env python3
"""Break the reference solution on purpose and check the graded suite notices.

Each row is one edit to a source file the solution added or changed, chosen to
be a plausible wrong reading of the request rather than a typo. A row passes
when at least one fail-to-pass case fails. A row that leaves the suite green is
a contract nothing enforces.
"""

import pathlib
import shutil
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parent / "work"
IMAGE = "signalbox-cs:v2"
GRADED = ["tests/unit/test_reset_grouping.py", "tests/tables/test_head_listing.py"]

MUTANTS = [
    (
        "a buffer stop gets a head like anything else",
        "src/signalbox/topology/counting.py",
        "if graph.node(node).kind is NodeKind.BOUNDARY:",
        "if graph.node(node).kind in (NodeKind.BOUNDARY, NodeKind.BUFFER):",
    ),
    (
        "no head where a counted section runs to the boundary",
        "src/signalbox/topology/counting.py",
        "                _remember(found, graph, node, port, section.name, edge)\n    return sorted",
        "                pass\n    return sorted",
    ),
    (
        "heads named for the node even at points",
        "src/signalbox/topology/counting.py",
        "    named = graph.node(node).kind in _LEGGED",
        "    named = False",
    ),
    (
        "heads always carry the leg, plain joins included",
        "src/signalbox/topology/counting.py",
        "    named = graph.node(node).kind in _LEGGED",
        "    named = True",
    ),
    (
        "a zone is named for its last section",
        "src/signalbox/topology/counting.py",
        "zones.append(ResetZone(name=members[0], sections=tuple(members)))",
        "zones.append(ResetZone(name=members[-1], sections=tuple(members)))",
    ),
    (
        "every counted section is its own zone",
        "src/signalbox/topology/counting.py",
        "                if other in joined:\n                    joined[section.name].add(other)\n                    joined[other].add(section.name)",
        "                if other in joined:\n                    pass",
    ),
    (
        "release ignores the zones and stays as it was",
        "src/signalbox/signalling/locking.py",
        "    piecemeal = sectional_release and _groups_in(held, zones) > 1",
        "    piecemeal = sectional_release and len(held) > 1",
    ),
    (
        "release looks at the route track and forgets the overlap",
        "src/signalbox/signalling/locking.py",
        "    held = subroutes + overlap_subroutes",
        "    held = subroutes",
    ),
    (
        "track circuits carry a zone and heads too",
        "src/signalbox/interchange/model.py",
        "    zone = counting.zone_of(name)\n    if zone is not None:",
        "    zone = counting.zone_of(name)\n    if True:",
    ),
    (
        "the rule reports every zone, however narrow",
        "src/signalbox/verify/checks/detection.py",
        "for zone in counting.wide_zones():",
        "for zone in counting.zones:",
    ),
    (
        "the locking table forgets its zones column",
        "src/signalbox/tables/locking_table.py",
        "                zones=entry.zones_held(),",
        "                zones=(),",
    ),
]


def run(tree: pathlib.Path) -> tuple[int, str]:
    proc = subprocess.run(
        ["docker", "run", "--rm", "--network", "none", "-v", f"{tree}:/app", "-w", "/app",
         IMAGE, "python", "-m", "pytest", "-p", "no:warnings", "-q", "--tb=no", *GRADED],
        capture_output=True, text=True,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def main() -> None:
    caught = 0
    for name, path, old, new in MUTANTS:
        with tempfile.TemporaryDirectory() as tmp:
            tree = pathlib.Path(tmp) / "work"
            shutil.copytree(WORK, tree, ignore=shutil.ignore_patterns(".git", "__pycache__"))
            target = tree / path
            text = target.read_text()
            if old not in text:
                print(f"  SKIP  {name}: anchor not found in {path}")
                continue
            target.write_text(text.replace(old, new, 1))
            rc, out = run(tree)
            verdict = "caught" if rc != 0 else "MISSED"
            caught += rc != 0
            tail = [line for line in out.splitlines() if "passed" in line or "failed" in line]
            print(f"  {verdict:6} {name}   {tail[-1] if tail else ''}")
    print(f"{caught} of {len(MUTANTS)} mutants caught")


if __name__ == "__main__":
    main()
