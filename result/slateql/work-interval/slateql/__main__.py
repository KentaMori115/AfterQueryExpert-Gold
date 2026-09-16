"""Allows ``python -m slateql`` to run the command line interface."""

from __future__ import annotations

import sys

from .cli.main import main

if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
