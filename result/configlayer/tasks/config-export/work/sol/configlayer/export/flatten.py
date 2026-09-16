"""Shared machinery for the exporters: flattening and scalar rendering."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from configlayer.exceptions import ExportError

# Scalar types every exporter can render.
_SCALARS = (str, int, float, bool, type(None))

# A dotenv/INI key segment after normalisation: letters, digits and
# underscores, not starting with a digit.
_SEGMENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def flatten(config: Mapping[str, Any], *, parent: str = "") -> dict[str, Any]:
    """Flatten nested mappings into ``{dotted.path: leaf}`` pairs.

    Mapping values recurse; everything else — scalars and lists — is a
    leaf.  Insertion order is preserved; the exporters sort afterwards
    so their output is deterministic regardless of source ordering.

    Parameters
    ----------
    config:
        The nested configuration mapping.
    parent:
        Dotted prefix accumulated during recursion.

    Raises
    ------
    ExportError
        If a key is not a string or is empty.
    """
    flat: dict[str, Any] = {}
    for key, value in config.items():
        if not isinstance(key, str) or not key:
            raise ExportError(
                f"cannot export non-string key {key!r} under "
                f"{parent or '<root>'!r}"
            )
        path = f"{parent}.{key}" if parent else key
        if isinstance(value, Mapping):
            flat.update(flatten(value, parent=path))
        else:
            flat[path] = value
    return flat


def render_scalar(value: Any, path: str) -> str:
    """Render one scalar leaf as text, uniformly across exporters.

    Booleans render as ``true``/``false``, ``None`` as the empty string,
    numbers via ``str`` and strings as themselves.  Anything else — and
    any string containing a newline, which no line-oriented format can
    carry — raises :class:`ExportError` naming the dotted path.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        if "\n" in value or "\r" in value:
            raise ExportError(
                f"{path}: strings with line breaks cannot be exported "
                "to a line-oriented format"
            )
        return value
    raise ExportError(
        f"{path}: cannot render {type(value).__name__} as a scalar"
    )


def render_leaf(value: Any, path: str) -> str:
    """Render a leaf that may also be a list of scalars.

    Lists join their rendered elements with ``", "``; an element that is
    itself a list or mapping raises :class:`ExportError`.
    """
    if isinstance(value, list):
        parts = []
        for index, element in enumerate(value):
            if isinstance(element, (list, Mapping)):
                raise ExportError(
                    f"{path}[{index}]: nested collections cannot be "
                    "exported to a line-oriented format"
                )
            parts.append(render_scalar(element, f"{path}[{index}]"))
        return ", ".join(parts)
    return render_scalar(value, path)


def env_segment(segment: str, path: str) -> str:
    """Normalise one dotted-path segment into an environment-style token.

    The segment is uppercased and must then match
    ``[A-Z_][A-Z0-9_]*`` — anything else (dashes, spaces, a leading
    digit) raises :class:`ExportError` naming the dotted path.
    """
    upper = segment.upper()
    if not _SEGMENT_RE.match(upper):
        raise ExportError(
            f"{path}: key segment {segment!r} cannot become an "
            "environment variable name"
        )
    return upper
