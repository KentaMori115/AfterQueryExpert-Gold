"""Version metadata for the SlateQL engine.

The version string is consumed by the CLI (``slateql --version``), by the
packaging metadata, and by :func:`slateql.version.version_tuple` which some
compatibility checks use to gate behaviour on a minimum engine version.
"""

from __future__ import annotations

__all__ = ["VERSION", "version_tuple", "user_agent"]

VERSION = "0.6.0"


def version_tuple() -> tuple[int, ...]:
    """Return :data:`VERSION` split into a comparable tuple of integers.

    Pre-release suffixes (``-rc1``, ``+dev``) are stripped before parsing so
    that ``version_tuple() >= (0, 5)`` behaves the way callers expect.
    """

    head = VERSION.split("-", 1)[0].split("+", 1)[0]
    parts: list[int] = []
    for chunk in head.split("."):
        if not chunk.isdigit():
            break
        parts.append(int(chunk))
    return tuple(parts)


def user_agent() -> str:
    """Return a short identifier used when SlateQL annotates generated files."""

    return f"slateql/{VERSION}"
