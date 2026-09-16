"""Single source of truth for the package version.

Both ``pyproject.toml`` and :mod:`veldt` read the version from here so that a
release only ever needs one line changed.
"""

from __future__ import annotations

__all__ = ["VERSION", "VERSION_INFO", "version_string"]

VERSION_INFO = (0, 1, 0)
VERSION = ".".join(str(part) for part in VERSION_INFO)


def version_string(include_name: bool = True) -> str:
    """Return a human readable version banner.

    Args:
        include_name: When true the package name is prefixed to the version.

    Returns:
        Either ``"veldt 0.1.0"`` or ``"0.1.0"``.
    """
    return f"veldt {VERSION}" if include_name else VERSION
