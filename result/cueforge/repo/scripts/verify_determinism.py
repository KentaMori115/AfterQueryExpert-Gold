#!/usr/bin/env python3
"""Re-run compile twice and require byte-identical canonical JSON."""

from __future__ import annotations

import sys
from pathlib import Path

from cueforge.api import compile_production, dumps_canonical, load_production

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = [
    ROOT / "examples" / "concert_two_looks.yaml",
    ROOT / "examples" / "harbor_rehearsal.yaml",
]


def main() -> int:
    for path in EXAMPLES:
        loaded = load_production(path)
        if not loaded.is_ok or loaded.value is None:
            print(f"load failed: {path}", file=sys.stderr)
            return 1
        first = compile_production(loaded.value)
        second = compile_production(loaded.value)
        if first.value is None or second.value is None:
            print(f"compile failed: {path}", file=sys.stderr)
            return 1
        left = dumps_canonical(first.value.semantic_dict())
        right = dumps_canonical(second.value.semantic_dict())
        if left != right:
            print(f"canonical mismatch: {path}", file=sys.stderr)
            return 1
        if not left.endswith("\n") or left.endswith("\n\n"):
            print(f"canonical newline contract failed: {path}", file=sys.stderr)
            return 1
    print("determinism ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
