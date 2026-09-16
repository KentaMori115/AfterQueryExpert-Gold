"""Run the command line: ``python -m layover``."""

from __future__ import annotations

import sys

from layover.cli.main import main

__all__ = ["main"]

if __name__ == "__main__":
    sys.exit(main())
