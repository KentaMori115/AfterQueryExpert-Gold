"""Let the package be run as ``python -m signalbox``.

Handy when the entry point has not been installed, which is most of the time
during development.
"""

from __future__ import annotations

from .cli.main import app


def main() -> None:
    app()


if __name__ == "__main__":
    main()
