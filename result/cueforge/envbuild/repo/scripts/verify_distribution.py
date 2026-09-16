#!/usr/bin/env python3
"""Sanity-check that the installed package imports and exposes the CLI."""

from __future__ import annotations

import importlib
import sys


def main() -> int:
    module = importlib.import_module("cueforge")
    for name in ("load_production", "compile_production", "rehearse"):
        if not hasattr(module, name):
            print(f"missing export {name}", file=sys.stderr)
            return 1
    importlib.import_module("cueforge.cli.main")
    print("distribution ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
